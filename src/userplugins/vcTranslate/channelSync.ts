import { applyRemoteChannels, channelSnapshot, matchWaiting, settleDirty } from "./channels";
import type { ChannelSyncEntry, RelayChannelsResult } from "./engines/relay";

/**
 * THE 🌐 CHOICES FOLLOW THE DISCORD ACCOUNT (2026-10-16).
 *
 * The same plugin runs in the desktop app and in the browser add-on, and each
 * keeps its own lists (channels.ts). For a LINKED account the relay keeps a
 * copy (relay/src/channels.ts), and this module keeps the two in step:
 *
 *  - WHEN. After the first status answer that says linked (begin), on
 *    Discord's window coming back into focus at most every FOCUS_EVERY_MS,
 *    and PUSH_DEBOUNCE_MS after a click here. A failed sync is tried again on
 *    RETRY_LADDER_MS, then waits for the next focus, click or status.
 *  - HOW. Every sync reads the relay's list first (GET), takes in what is
 *    newer there, then sends what is newer here (POST, at most PER_POST per
 *    call). Last write wins per channel by its time; the same time settles
 *    the same way everywhere (channels.ts entryWins, the relay's rule).
 *  - PRIVACY. The relay sees only hashes: the first 16 hex of
 *    SHA-256(salt + ":" + channelId), with the account's salt from GET.
 *    An entry for a channel this computer cannot name yet waits until that
 *    channel is opened (channelOpened).
 *  - CLOCKS. Times are the relay's: each answer's `now` gives the skew, and
 *    a time sent is never later than the relay's now as best known, so a
 *    clock running ahead cannot make a change win for good.
 *  - NEVER WORSE THAN BEFORE. Not linked (409 not_linked), relay down, a
 *    timeout, a private browser window: the lists here work exactly as
 *    before, and changes made here stay dirty (in the DataStore) until a
 *    sync takes them. Nothing here ever throws into Discord.
 *
 * One sync at a time; an account switch ends the session (end), and an
 * answer for the account before changes nothing (channels.ts checks the
 * owner of every write).
 */

export const PUSH_DEBOUNCE_MS = 2_000;
export const FOCUS_EVERY_MS = 10 * 60_000;
export const RETRY_LADDER_MS = [30_000, 2 * 60_000, 10 * 60_000] as const;
export const PER_POST = 50;

export interface ChannelSyncDeps {
    /** GET (no json) or POST (json) /v1/channels for the current account's install. Should never reject. */
    call(json?: string): Promise<RelayChannelsResult>;
    /** Channel ids Discord knows here that a remote entry may be about (the open channel, the DMs). */
    candidates(): string[];
    /** Channels whose state a remote entry changed (redraw, catch up). */
    applied(ids: string[]): void;
    /** A short line for the debug log; never an id. */
    log(line: string): void;
}

/** The first 16 hex of SHA-256(salt + ":" + channelId). */
export async function channelHash(salt: string, channelId: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${channelId}`));
    return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

interface Session {
    account: string;
    deps: ChannelSyncDeps;
    /** A sync is running; `again`: another was asked for meanwhile. */
    running: boolean;
    again: boolean;
    lastSyncAt: number;
    retryStep: number;
    timer: ReturnType<typeof setTimeout> | null;
    debounce: ReturnType<typeof setTimeout> | null;
    /** salt + "\n" + id -> hash. */
    hashes: Map<string, string>;
}

let session: Session | null = null;

/** Whether a session is running for `account`. */
export function channelSyncActive(account: string): boolean {
    return session !== null && session.account === account;
}

/**
 * The relay says `account`'s install is linked: sync now, unless a session
 * for it is already running (then nothing: focus and clicks drive it).
 */
export function beginChannelSync(account: string, deps: ChannelSyncDeps): void {
    if (session !== null && session.account === account) return;
    endChannelSync();
    session = {
        account, deps, running: false, again: false, lastSyncAt: 0, retryStep: 0, timer: null, debounce: null, hashes: new Map()
    };
    void syncNow(session);
}

/** Stop syncing (an account switch, not linked any more, stop()). Changes made here stay dirty. */
export function endChannelSync(): void {
    const s = session;
    session = null;
    if (s === null) return;
    if (s.timer !== null) clearTimeout(s.timer);
    if (s.debounce !== null) clearTimeout(s.debounce);
}

/** Discord's window came back into focus: sync if the last one is FOCUS_EVERY_MS old. */
export function channelSyncFocus(): void {
    const s = session;
    if (s === null || Date.now() - s.lastSyncAt < FOCUS_EVERY_MS) return;
    void syncNow(s);
}

/** A click changed a channel here: push it PUSH_DEBOUNCE_MS after the last click. */
export function channelChangedHere(): void {
    const s = session;
    if (s === null) return;
    if (s.debounce !== null) clearTimeout(s.debounce);
    s.debounce = setTimeout(() => {
        s.debounce = null;
        if (session === s) void syncNow(s);
    }, PUSH_DEBOUNCE_MS);
}

/** A channel was opened: take in a remote entry that was waiting for it. */
export async function channelOpened(channelId: string): Promise<void> {
    const s = session;
    if (s === null) return;
    const snap = channelSnapshot(s.account);
    if (snap === null || snap.salt === "" || snap.remote.size === 0) return;
    try {
        const h = await hashOf(s, snap.salt, channelId);
        if (session !== s) return;
        if (await matchWaiting(s.account, channelId, h)) s.deps.applied([channelId]);
    } catch { /* no hash here (no crypto): the entry keeps waiting */ }
}

async function hashOf(s: Session, salt: string, id: string): Promise<string> {
    const key = `${salt}\n${id}`;
    let h = s.hashes.get(key);
    if (h === undefined) {
        h = await channelHash(salt, id);
        if (s.hashes.size > 5_000) s.hashes.clear();
        s.hashes.set(key, h);
    }
    return h;
}

function scheduleRetry(s: Session): void {
    if (s.timer !== null || session !== s) return;
    const delay = RETRY_LADDER_MS[s.retryStep];
    if (delay === undefined) return;
    s.retryStep++;
    s.timer = setTimeout(() => {
        s.timer = null;
        if (session === s) void syncNow(s);
    }, delay);
}

/** Run one sync for `s` (or note that another is wanted when one is running). Never throws. */
async function syncNow(s: Session): Promise<void> {
    if (s.running) {
        s.again = true;
        return;
    }
    s.running = true;
    try {
        do {
            s.again = false;
            const outcome = await syncOnce(s);
            if (session !== s) return;
            if (outcome === "ok") {
                s.retryStep = 0;
                if (s.timer !== null) { clearTimeout(s.timer); s.timer = null; }
            } else if (outcome === "retry") {
                scheduleRetry(s);
                return;
            } else if (outcome === "stop") {
                endChannelSync();
                return;
            }
        } while (s.again && session === s);
    } catch (err) {
        s.deps.log(`channel sync failed: ${err instanceof Error ? err.message : String(err)}`);
        scheduleRetry(s);
    } finally {
        s.running = false;
    }
}

/** One GET, then the POSTs. "stop": not linked; "retry": try again later; "ok"; "gone": the session ended. */
async function syncOnce(s: Session, saltRetries = 1): Promise<"ok" | "retry" | "stop" | "gone"> {
    const sentAt = Date.now();
    const got = await s.deps.call();
    if (session !== s) return "gone";
    s.lastSyncAt = Date.now();
    if (!got.ok) return failure(s, got.error, "read");
    // The relay's clock: its `now` against the middle of the round trip.
    const skew = typeof got.now === "number" ? Math.round(got.now - (sentAt + s.lastSyncAt) / 2) : null;
    const snap = channelSnapshot(s.account);
    if (snap === null) return "gone";

    const known = new Set<string>(snap.entries.keys());
    try { for (const id of s.deps.candidates()) if (typeof id === "string" && id !== "") known.add(id); } catch { /* the lists alone */ }
    const byHash = new Map<string, string>();
    for (const id of known) byHash.set(await hashOf(s, got.salt, id), id);
    if (session !== s) return "gone";

    const matched: { id: string; h: string; e: ChannelSyncEntry; }[] = [];
    const unmatched = new Map<string, ChannelSyncEntry>();
    for (const [h, e] of Object.entries(got.ch ?? {})) {
        const id = byHash.get(h);
        if (id !== undefined) matched.push({ id, h, e });
        else unmatched.set(h, e);
    }
    // Entries that waited under this salt and can be named now.
    if (snap.salt === got.salt) {
        for (const [h, e] of snap.remote) {
            const id = byHash.get(h);
            if (id !== undefined && !matched.some(m => m.h === h)) matched.push({ id, h, e });
        }
    }
    const changed = await applyRemoteChannels(s.account, got.salt, skew, matched, unmatched);
    if (session !== s) return "gone";
    if (changed.length > 0) {
        s.deps.log(`channel sync took ${changed.length} change(s) from the relay`);
        try { s.deps.applied(changed); } catch { /* a redraw failing never stops the sync */ }
    }

    // Send what is newer here.
    const after = channelSnapshot(s.account);
    if (after === null) return "gone";
    const dirty = after.dirty.filter(id => after.entries.has(id));
    for (let i = 0; i < dirty.length; i += PER_POST) {
        const chunk = dirty.slice(i, i + PER_POST);
        const relayNow = Date.now() + after.skew;
        const sent: { id: string; at: number; }[] = [];
        const changes: { h: string; s: string; at: number; }[] = [];
        for (const id of chunk) {
            const e = after.entries.get(id)!;
            sent.push({ id, at: e.at });
            // Never later than the relay's now: a clock that ran ahead when
            // this was stamped cannot win over every later change.
            changes.push({ h: await hashOf(s, got.salt, id), s: e.s, at: Math.max(0, Math.min(e.at, relayNow)) });
        }
        if (session !== s) return "gone";
        const put = await s.deps.call(JSON.stringify({ salt: got.salt, changes }));
        if (session !== s) return "gone";
        if (put.ok) {
            await settleDirty(s.account, sent);
            continue;
        }
        if (put.error === "salt_changed" && saltRetries > 0) return syncOnce(s, saltRetries - 1);
        if (put.error === "rejected") {
            // Never taken however often it is sent: kept here, not sent again.
            s.deps.log("channel sync: the relay refused a change as malformed; kept on this computer only");
            await settleDirty(s.account, sent, true);
            continue;
        }
        return failure(s, put.error, "write");
    }
    return "ok";
}

function failure(s: Session, error: string, what: "read" | "write"): "retry" | "stop" {
    if (error === "not_linked") {
        s.deps.log("channel sync: this install is not linked; the choices stay on this computer");
        return "stop";
    }
    s.deps.log(`channel sync: the ${what} failed (${error}); trying again later`);
    return "retry";
}
