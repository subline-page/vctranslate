import * as DataStore from "@api/DataStore";

/**
 * WHAT THIS INSTALL HAS PAID FOR, as the relay last said it (v2 /v1/status).
 *
 * There is no free tier. An install is one of three things:
 *  - "none": nothing is translated; the activation notice is shown;
 *  - "automatic": ≈ Google on every message and surface, decoders, and five
 *    ✦ previews a day from ⚡ in the hover toolbar;
 *  - "ai": the above plus ✦ on everything (relay, under the saved code).
 *
 * The relay is the authority and states `tokenExpiresAt` (7 days out) on every
 * good answer. The answer is kept on disk, so Automatic keeps working offline
 * until that moment and no longer; after it, the install counts as "none"
 * until the relay answers again. The plugin asks at start and every 24 hours,
 * so an online install never gets near the edge.
 *
 * Free of Discord and settings, so the rules can be read and tested alone.
 */

export type Level = "none" | "automatic" | "ai";

export interface Entitlement {
    automatic: boolean;
    ai: boolean;
    /** When the AI subscription's current period ends (epoch ms), if the relay said. */
    aiUntil?: number;
    /** The relay's signed entitlement token. Kept, never shown, never logged. */
    token?: string;
    /** Automatic (and AI) count only until this moment (epoch ms). */
    tokenExpiresAt: number;
    /** When the relay last answered (epoch ms). */
    checkedAt: number;
    /**
     * WHO the answer was for: a fingerprint of the saved code and the install
     * id it was asked with (see holderFor). An answer about a code the reader
     * has since cleared, or about another install id (Subline uninstalled and
     * installed again makes a new one, while Discord keeps this store), says
     * nothing about this install, so it counts as "none" until the relay
     * answers for the new pair. Absent on answers stored by older builds.
     */
    holder?: string;
    /**
     * API 3: whether this install's account was linked to a Discord account
     * when the relay answered. False is the relay's "link first" (nothing is
     * owned until then); absent is "not stated" (an older relay or build).
     */
    linked?: boolean;
    /**
     * API 3, not linked, and this computer had the plan before 0.2.8 (a prior
     * payer): the plan works as stated, and the Link bar asks to link. Never
     * a block. Absent otherwise.
     */
    mustLink?: boolean;
    /**
     * API 3, not linked: a purchase was started from this install before
     * 0.2.8 and may still land. It joins the account the link names, so that
     * link asks the account confirm first. Absent otherwise.
     */
    pendingPurchase?: boolean;
}

/**
 * The install id from before keeps its answer here (the key older builds
 * wrote): every Discord account shares it until a confirmed link binds that
 * id to one account (account.ts). An account on an id of its own has its
 * own key beside it (index.tsx, through setEntitlementKey), so one account
 * never reads, or overwrites, another's answer.
 */
export const ENTITLEMENT_KEY = "VcTranslate_entitlement";
/** How often a running install asks the relay again. */
export const ENTITLEMENT_REFRESH_MS = 24 * 60 * 60_000;

let current: Entitlement | null = null;
/** Where the current account's answer lives (see ENTITLEMENT_KEY). */
let storageKey = ENTITLEMENT_KEY;
/** The fingerprint of the code and install id in use now, once known. */
let currentHolder: string | null = null;

/**
 * A short fingerprint of a code and an install id (FNV-1a, 32 bit, twice with
 * different seeds). Not a secret and not a check against tampering: it only
 * tells two credentials apart, and it keeps the code itself out of this store.
 */
export function holderFor(code: string, installId: string): string {
    const input = code + "\n" + installId;
    const fnv = (seed: number) => {
        let h = seed >>> 0;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(16).padStart(8, "0");
    };
    return fnv(2166136261) + fnv(84696351);
}

/** Say which code and install id are in use now (index.tsx, at start and on every code change). */
export function setCurrentHolder(holder: string | null): void {
    currentHolder = holder;
    notify();
}

export function getCurrentHolder(): string | null {
    return currentHolder;
}
const listeners = new Set<() => void>();

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A stored or received value, checked field by field. Anything malformed is null. */
export function parseEntitlement(raw: unknown): Entitlement | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.automatic !== "boolean" || typeof o.ai !== "boolean") return null;
    if (!finite(o.tokenExpiresAt) || o.tokenExpiresAt <= 0) return null;
    const out: Entitlement = {
        automatic: o.automatic,
        ai: o.ai,
        tokenExpiresAt: o.tokenExpiresAt,
        checkedAt: finite(o.checkedAt) ? o.checkedAt : 0
    };
    if (finite(o.aiUntil) && o.aiUntil > 0) out.aiUntil = o.aiUntil;
    if (typeof o.token === "string" && o.token.length <= 4096) out.token = o.token;
    if (typeof o.holder === "string" && o.holder.length <= 64) out.holder = o.holder;
    if (typeof o.linked === "boolean") out.linked = o.linked;
    if (o.mustLink === true) out.mustLink = true;
    if (o.pendingPurchase === true) out.pendingPurchase = true;
    return out;
}

/**
 * Point at another account's store (a Discord account switch). What is in
 * memory belongs to the previous account, so it is dropped at once; the
 * caller then reads the new store with loadEntitlement.
 */
export function setEntitlementKey(key: string): void {
    if (key === storageKey) return;
    storageKey = key;
    current = null;
    notify();
}

/** Read what the last session stored. A bad or missing value is "none". */
export async function loadEntitlement(): Promise<void> {
    const key = storageKey;
    let read: Entitlement | null;
    try {
        read = parseEntitlement(await DataStore.get<unknown>(key));
    } catch {
        read = null;
    }
    // Switched again while reading: this answer is not the current account's.
    if (key !== storageKey) return;
    current = read;
    notify();
}

/** Record the relay's answer (in memory and on disk). */
export function setEntitlement(next: Entitlement | null): void {
    current = next;
    void DataStore.set(storageKey, next ?? undefined).catch(() => { });
    notify();
}

export function getEntitlement(): Entitlement | null {
    return current;
}

/**
 * What this install may do right now. Automatic and AI both lapse at
 * `tokenExpiresAt`; AI also lapses at `aiUntil` when the relay stated one.
 * An account the relay marks AI counts as Automatic too (AI is sold only on
 * top of Automatic, and older AI codes are grandfathered).
 */
export function entitlementLevel(now: number = Date.now()): Level {
    const e = current;
    if (e === null || now >= e.tokenExpiresAt) return "none";
    // An answer about a different code or install id is not about this one.
    if (e.holder !== undefined && currentHolder !== null && e.holder !== currentHolder) return "none";
    const aiLive = e.ai && (e.aiUntil === undefined || now < e.aiUntil);
    if (aiLive) return "ai";
    return e.automatic ? "automatic" : "none";
}

/**
 * Whether the relay last said this install's account is linked to a Discord
 * account: "unlinked" (link first, nothing is owned), "linked", or "unknown"
 * (no answer yet, an older relay, or an answer about another code or install).
 * Unlike the level, it does not lapse at tokenExpiresAt: it is a fact about
 * the account, not a permission.
 */
export function linkState(): "linked" | "unlinked" | "unknown" {
    const e = current;
    if (e === null || e.linked === undefined) return "unknown";
    if (e.holder !== undefined && currentHolder !== null && e.holder !== currentHolder) return "unknown";
    return e.linked ? "linked" : "unlinked";
}

/**
 * A prior payer still to link (0.2.8): the relay answered the plan as usual,
 * with `mustLink`. Translation keeps working; the Link bar shows. False for
 * an answer about another code or install, as linkState says "unknown" then.
 */
export function mustLink(): boolean {
    const e = current;
    if (e === null || e.mustLink !== true || e.linked !== false) return false;
    if (e.holder !== undefined && currentHolder !== null && e.holder !== currentHolder) return false;
    return true;
}

/**
 * The relay said a purchase was started from this install before 0.2.8 and
 * has not landed (`pendingPurchase`), while it is not linked. Its plan will
 * join whichever account links this install: the Link asks the account
 * confirm first, and is never made silently (0.2.8 spec, decisions 2 and 3).
 * False for an answer about another code or install, as mustLink.
 */
export function purchaseStartedHere(): boolean {
    const e = current;
    if (e === null || e.pendingPurchase !== true || e.linked !== false) return false;
    if (e.holder !== undefined && currentHolder !== null && e.holder !== currentHolder) return false;
    return true;
}

export function subscribeEntitlement(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function notify(): void {
    for (const fn of [...listeners]) {
        try { fn(); } catch { /* a listener's failure is its own */ }
    }
}

/** Test-only: forget the in-memory state (disk is the DataStore stub's business). */
export function __resetEntitlement(): void {
    current = null;
    currentHolder = null;
    storageKey = ENTITLEMENT_KEY;
    listeners.clear();
}
