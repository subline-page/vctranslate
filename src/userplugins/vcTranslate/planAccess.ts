/**
 * THE PLAN STATE THE RELAY STATES (0.2.9, AI only): the `access` object of a
 * /v1/status answer (relay/README.md "AI only (0.2.9)"). The ✦ button, its
 * hover text, the plan panel and the two once-a-period messages all read it.
 *
 * Free of Discord, of storage and of the network, so the main process
 * (native.ts), the browser add-on and the renderer can all parse it the same
 * way. Anything malformed is dropped, never trusted: a bad `access` is the
 * same as none, and the plugin then reads the 0.2.8 fields alone.
 */

export type AccessState = "not_started" | "on" | "ended" | "subscribed" | "buyer" | "pending" | "off";
export type PeriodKind = "new" | "promo";

export interface PlanAccess {
    state: AccessState;
    /** Which period: the 7 days of a new account, or a promo's 30 days. */
    kind?: PeriodKind;
    /** 7 or 30, with `kind`. */
    periodDays?: number;
    /**
     * When the period started (epoch ms, always on the relay's clock: the
     * renderer keeps it as the period's id and never moves it).
     */
    startedAt?: number;
    /** When it ends (epoch ms, on the relay's clock until the renderer moves it). */
    endsAt?: number;
    /** Whole days left, rounded up (1 on the last day). Only while on. */
    daysLeft?: number;
    /** Today's ⚡ (cap 5 while ✦ is off, else 0). */
    boosts: { used: number; cap: number; left: number };
    /** The hidden daily ceiling is reached (or no period may start from this address today). */
    paused: boolean;
    /** An AI purchase is on its way. */
    paymentPending: boolean;
    /** The next UTC midnight (epoch ms). */
    resetsAt?: number;
    /** The computer is not linked to a Discord account. */
    linkNeeded?: boolean;
    /** A buyer by a server code redeemed on 0.2.8 (AI for good), not a purchase. */
    via?: "promo";
}

/** A new account's days when the relay leaves the number out. */
export const NEW_DAYS_FALLBACK = 7;

const STATES: readonly AccessState[] = ["not_started", "on", "ended", "subscribed", "buyer", "pending", "off"];

const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const count = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

/** A stated `access`, field by field. Null for anything without a known state. */
export function accessFrom(raw: unknown): PlanAccess | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.state !== "string" || !STATES.includes(o.state as AccessState)) return null;
    const b = (o.boosts && typeof o.boosts === "object" ? o.boosts : {}) as Record<string, unknown>;
    const cap = count(b.cap) ?? 0;
    const used = Math.min(count(b.used) ?? 0, cap);
    const left = Math.min(count(b.left) ?? cap, Math.max(0, cap - used));
    const out: PlanAccess = {
        state: o.state as AccessState,
        boosts: { used, cap, left },
        paused: o.paused === true,
        paymentPending: o.paymentPending === true
    };
    if (o.kind === "new" || o.kind === "promo") {
        out.kind = o.kind;
        // The relay says how long (7 for a new account since 2026-10-25, 30 for a code).
        const days = count(o.periodDays);
        out.periodDays = days !== undefined && days >= 1 && days <= 366 ? days : o.kind === "new" ? NEW_DAYS_FALLBACK : 30;
    }
    if (time(o.startedAt)) out.startedAt = o.startedAt;
    if (time(o.endsAt)) out.endsAt = o.endsAt;
    const days = count(o.daysLeft);
    if (days !== undefined && days >= 1 && days <= 366) out.daysLeft = days;
    if (time(o.resetsAt)) out.resetsAt = o.resetsAt;
    if (o.linkNeeded === true) out.linkNeeded = true;
    if (o.via === "promo") out.via = "promo";
    return out;
}

/** What a typed-code check says the code would give (`check.gives`). */
export type CheckGives = "subscribed" | "buyer" | "promo" | "none";

export function checkGivesFrom(raw: unknown): CheckGives | undefined {
    return raw === "subscribed" || raw === "buyer" || raw === "promo" || raw === "none" ? raw : undefined;
}
