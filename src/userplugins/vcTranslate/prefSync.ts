import type { RelayPrefsResult } from "./engines/relay";
import { applyRemotePrefs, type PrefEntry, type PrefKey, prefSnapshot, settlePrefs } from "./prefs";

/**
 * SUBLINE'S SETTINGS FOLLOW THE DISCORD ACCOUNT (2026-10-16).
 *
 * Each computer keeps each account's settings (prefs.ts). For a LINKED
 * account the relay keeps a copy (relay/src/prefs.ts), and this module keeps
 * the two in step, the way channelSync.ts does for the 🌐 choices:
 *
 *  - WHEN. After the first status answer that says linked (begin: on start,
 *    after a link, after an account switch), on Discord's window coming back
 *    into focus at most every FOCUS_EVERY_MS, and PUSH_DEBOUNCE_MS after the
 *    last change made here. A failed sync is tried again on RETRY_LADDER_MS,
 *    then waits for the next focus, change or status.
 *  - HOW. With nothing to send, a GET. With changes made here, a POST of
 *    them, which answers the merged settings. Either answer is merged per
 *    setting (prefs.ts applyRemotePrefs): the later one wins.
 *  - CLOCKS. Times are the relay's: each answer's `now` gives the skew, and a
 *    time sent is never later than the relay's now as best known.
 *  - NEVER WORSE THAN BEFORE. Not linked, a relay without /v1/prefs yet
 *    (404), offline, a timeout: the settings here work exactly as before,
 *    and changes made here stay dirty until a sync takes them. Nothing here
 *    ever throws into Discord.
 *
 * One sync at a time; an account switch ends the session (end), and an
 * answer for the account before changes nothing (prefs.ts checks the owner
 * of every write).
 */

export const PUSH_DEBOUNCE_MS = 3_000;
export const FOCUS_EVERY_MS = 10 * 60_000;
export const RETRY_LADDER_MS = [30_000, 2 * 60_000, 10 * 60_000] as const;

export interface PrefSyncDeps {
    /** GET (no json) or POST (json) /v1/prefs for the current account's install. Should never reject. */
    call(json?: string): Promise<RelayPrefsResult>;
    /** Settings that a sync changed here (already written into the settings). */
    applied(keys: PrefKey[]): void;
    /** A short line for the debug log; never an id. */
    log(line: string): void;
}

interface Session {
    account: string;
    deps: PrefSyncDeps;
    running: boolean;
    again: boolean;
    lastSyncAt: number;
    retryStep: number;
    timer: ReturnType<typeof setTimeout> | null;
    debounce: ReturnType<typeof setTimeout> | null;
}

let session: Session | null = null;

/** Whether a session is running for `account`. */
export function prefSyncActive(account: string): boolean {
    return session !== null && session.account === account;
}

/**
 * The relay says `account`'s install is linked: sync now, unless a session
 * for it is already running (then nothing: focus and changes drive it).
 */
export function beginPrefSync(account: string, deps: PrefSyncDeps): void {
    if (session !== null && session.account === account) return;
    endPrefSync();
    session = { account, deps, running: false, again: false, lastSyncAt: 0, retryStep: 0, timer: null, debounce: null };
    void syncNow(session);
}

/** Stop syncing (an account switch, not linked any more, stop()). Changes made here stay dirty. */
export function endPrefSync(): void {
    const s = session;
    session = null;
    if (s === null) return;
    if (s.timer !== null) clearTimeout(s.timer);
    if (s.debounce !== null) clearTimeout(s.debounce);
}

/** Discord's window came back into focus: sync if the last one is FOCUS_EVERY_MS old. */
export function prefSyncFocus(): void {
    const s = session;
    if (s === null || Date.now() - s.lastSyncAt < FOCUS_EVERY_MS) return;
    void syncNow(s);
}

/** A setting was changed here: push it PUSH_DEBOUNCE_MS after the last change. */
export function prefChangedHere(): void {
    const s = session;
    if (s === null) return;
    if (s.debounce !== null) clearTimeout(s.debounce);
    s.debounce = setTimeout(() => {
        s.debounce = null;
        if (session === s) void syncNow(s);
    }, PUSH_DEBOUNCE_MS);
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
                endPrefSync();
                return;
            } else if (outcome === "later") {
                return;
            }
        } while (s.again && session === s);
    } catch (err) {
        s.deps.log(`settings sync failed: ${err instanceof Error ? err.message : String(err)}`);
        scheduleRetry(s);
    } finally {
        s.running = false;
    }
}

/**
 * One call: a POST of what changed here, or a GET when nothing did (then a
 * POST if the GET shows something newer here). "stop": not linked;
 * "retry": try again soon; "later": wait for the next focus, change or
 * status; "ok"; "gone": the session ended.
 */
async function syncOnce(s: Session): Promise<"ok" | "retry" | "later" | "stop" | "gone"> {
    const before = prefSnapshot(s.account);
    if (before === null) return "gone";
    if (before.dirty.length === 0) {
        const got = await exchange(s);
        if (got !== "ok") return got;
        const after = prefSnapshot(s.account);
        if (after === null) return "gone";
        if (after.dirty.length === 0) return "ok";
    }
    const snap = prefSnapshot(s.account);
    if (snap === null) return "gone";
    const relayNow = Date.now() + snap.skew;
    const prefs: Record<string, PrefEntry> = {};
    const sent: { key: PrefKey; at: number; }[] = [];
    for (const key of snap.dirty) {
        const e = snap.vals.get(key);
        if (e === undefined) continue;
        sent.push({ key, at: e.at });
        // Never later than the relay's now: a clock that ran ahead when this
        // was stamped cannot win over every later change.
        prefs[key] = { value: e.value, at: Math.max(0, Math.min(e.at, relayNow)) };
    }
    return exchange(s, JSON.stringify({ prefs }), sent);
}

/** A GET (no `json`) or POST, and its answer merged in. */
async function exchange(s: Session, json?: string, sent: { key: PrefKey; at: number; }[] = []): Promise<"ok" | "retry" | "later" | "stop" | "gone"> {
    const sentAt = Date.now();
    const got = await s.deps.call(json);
    if (session !== s) return "gone";
    s.lastSyncAt = Date.now();
    if (!got.ok) return failure(s, got.error, json === undefined ? "read" : "write", sent);
    const skew = typeof got.now === "number" ? Math.round(got.now - (sentAt + s.lastSyncAt) / 2) : null;
    const changed = await applyRemotePrefs(s.account, got.prefs, skew);
    if (session !== s) return "gone";
    if (changed.length > 0) {
        s.deps.log(`settings sync took ${changed.length} setting(s) from the relay`);
        try { s.deps.applied(changed); } catch { /* a redraw failing never stops the sync */ }
    }
    return "ok";
}

async function failure(s: Session, error: string, what: "read" | "write", sent: { key: PrefKey; at: number; }[]): Promise<"retry" | "later" | "stop"> {
    if (error === "not_linked") {
        s.deps.log("settings sync: this install is not linked; the settings stay on this computer");
        return "stop";
    }
    if (error === "missing") {
        s.deps.log("settings sync: the relay cannot keep settings yet; trying again later");
        return "later";
    }
    if (error === "rejected" && sent.length > 0) {
        // Never taken however often it is sent: kept here, not sent again.
        s.deps.log("settings sync: the relay refused the settings as malformed; kept on this computer only");
        await settlePrefs(s.account, sent);
        return "later";
    }
    s.deps.log(`settings sync: the ${what} failed (${error}); trying again later`);
    return "retry";
}
