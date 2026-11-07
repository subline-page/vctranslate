import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import { ENGINE_CAPS, type EngineId } from "./types";

const logger = new Logger("VcTranslate");

// Four states, not two. `skipped` exists because a message that is ALREADY in
// the target language has no translation to store — but writing nothing at
// all would make it a permanent cache miss, so catch-up would re-enqueue the
// entire already-target-language backlog on every channel open, forever. In a
// mixed-language chat that is most of the backlog.
//
// `deferred` (0.2.9: written again) means "no answer yet, asking again": the
// ✦ request never reached a verdict (no answer, a 5xx, a rate limit, the
// relay cooling down). With ✦ the only engine, a message must never sit
// blank with no sign while that happens, so the message wears this quiet
// marker and is retried (index.tsx runTier, armDeferredRetry). `failed` is
// reserved for a genuine attempt that came back broken twice (the model
// returned no usable row for the id).
//
// All four are "resolved" in the sense that catch-up's cache-hit check must
// see an entry at all; `failed` and `deferred` are the two worth retrying,
// and neither is ever persisted (setTranslation).
//
// `via` records which engine actually produced a real translation. It lives in
// the VALUE, not in the key (see makeKey). 0.2.9 writes only "relay"; a line
// an older build stored under Google or the short-message judge is dropped
// when it is read back (loadPersistedTranslations), so no ≈ line ever shows.
export type StoredTranslation =
    // `same`: a ⚡ (forced) answer that is the source text itself, i.e. the
    // message is already in the reader's language. Shown as one short line
    // instead of a duplicate of the message.
    | { lang: string; text: string; via: EngineId; same?: true }
    | { failed: true }
    // `via`: which engine decided. A skip with no `via` is one an older build
    // wrote for Google; it is dropped on load, never trusted.
    | { skipped: true; via?: EngineId }
    | { deferred: true };

const MAX_ENTRIES = 500;

const cache = new Map<string, StoredTranslation>();
const listeners = new Set<() => void>();

/* ------------------------------------------------------------ persistence -- */

export const PERSIST_KEY = "VcTranslate_translations";

/**
 * How many entries survive a restart, independent of the 500-entry in-memory
 * LRU above.
 *
 * The two caps answer different questions. 500 is a session's working set —
 * what the reader might scroll back to right now. The persisted cap exists so
 * a restart costs nothing, which means it should cover the backlog a user
 * actually re-reads across days, not just the current session. At roughly
 * 1,000 translated messages a day (the budget this phase is built around: ~40
 * requests × ~25 messages), 2,000 is about two days of chat.
 *
 * It is also small on disk: an entry is a key plus a short translation, on the
 * order of 100-200 bytes of JSON, so the whole thing is a few hundred KB in
 * IndexedDB. Raising it is cheap; leaving it unbounded is not, which is the
 * only thing this constant is actually here to prevent.
 */
const MAX_PERSISTED = 2000;

/**
 * The in-memory mirror of what is on disk — same pattern as channels.ts, for
 * the same reason: a write is async, and the rest of the plugin cannot wait on
 * IndexedDB to answer a cache lookup.
 *
 * Deliberately a SEPARATE map from `cache`, not a view of it. `cache` is the
 * LRU the renderer reads and is capped at 500; this one is capped at
 * MAX_PERSISTED and is only ever read to serialise. Eviction from one does not
 * evict from the other.
 */
const persisted = new Map<string, StoredTranslation>();

/**
 * The entries read back from disk this session (the very objects). A line
 * from an earlier session may describe a message edited since, while Discord
 * was closed: in-place text (inPlace.ts) never stands in for such a message.
 */
const fromDisk = new WeakSet<object>();

/** Was this entry read back from disk (not made this session)? */
export function isFromDisk(entry: unknown): boolean {
    return typeof entry === "object" && entry !== null && fromDisk.has(entry);
}

/**
 * What the last successful write actually put on disk, used to roll the mirror
 * back when a write fails (channels.ts's discipline: memory must never claim
 * something is persisted when it is not).
 */
let lastWritten: [string, StoredTranslation][] = [];

/**
 * Writes are serialised through this chain and coalesced via `dirty`, so the
 * 25 setTranslation() calls that land from a single batch response produce one
 * write of the whole map rather than 25.
 */
let writeChain: Promise<void> = Promise.resolve();
let dirty = false;

/** True for a value that still matches the StoredTranslation union TODAY. */
function isStoredTranslation(value: unknown): value is StoredTranslation {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const o = value as Record<string, unknown>;

    // `failed` and `deferred` carry exactly one key and nothing else.
    if (o.failed === true || o.deferred === true) {
        return Object.keys(o).length === 1;
    }

    // `skipped` carries two keys: it records which engine's skip closed the
    // message. One on its own was Google's (older builds wrote it unmarked),
    // and a stray extra key, or a `via` that fails the same isKnownEngine
    // check a real translation's `via` does, is malformed: all dropped.
    if (o.skipped === true) {
        const keys = Object.keys(o);
        return keys.length === 2 && "via" in o && isKnownEngine(o.via);
    }

    return typeof o.lang === "string"
        && typeof o.text === "string"
        && isKnownEngine(o.via);
}

/**
 * `via` is validated against ENGINE_CAPS — the runtime table that already has
 * to list every engine — rather than against a hand-written string literal
 * union that would drift. A persisted entry outlives a rename or removal of
 * an engine id: 0.2.9 removed "google" and "judge", so a stored ≈ line (or
 * judge line) is not a known engine any more and is dropped on load, never
 * shown. Trusting it would also crash ENGINE_PROVENANCE[entry.via] in the
 * renderer with an undefined lookup. Dropping the entry costs one
 * re-translation; trusting it breaks the subtitle.
 */
function isKnownEngine(value: unknown): value is EngineId {
    return typeof value === "string"
        && Object.prototype.hasOwnProperty.call(ENGINE_CAPS, value);
}

function schedulePersist(): void {
    dirty = true;
    writeChain = writeChain.then(flushOnce);
}

async function flushOnce(): Promise<void> {
    // A previous link in the chain already wrote everything that was pending.
    if (!dirty) return;
    dirty = false;

    const snapshot: [string, StoredTranslation][] = [...persisted.entries()];
    try {
        await DataStore.set(PERSIST_KEY, snapshot);
        lastWritten = snapshot;
    } catch (err) {
        // Roll the mirror back to what disk actually holds. Note this does NOT
        // touch `cache`: the reader keeps the translation for this session, it
        // just stops being something we claim is saved. Same direction as
        // channels.ts — never let memory outrun the disk.
        persisted.clear();
        for (const [k, v] of lastWritten) persisted.set(k, v);
        dirty = false;
        logger.warn("Couldn't persist translations; keeping them for this session only.", err);
    }
}

/**
 * Resolves once every write scheduled so far has settled. Exists so tests can
 * assert on what actually reached DataStore without sleeping, and so a future
 * caller can flush deliberately; nothing in the plugin awaits it.
 */
export function persistenceSettled(): Promise<void> {
    return writeChain;
}

/**
 * Rehydrate the cache from disk. Never rejects and never throws: a slow or
 * broken read degrades to an empty cache (every message is simply a miss and
 * gets re-requested), which is the pre-Phase-2 behaviour, not a broken plugin.
 *
 * Entries already written this session win over anything on disk — the load is
 * not awaited by start(), so a message translated during startup must not be
 * clobbered by a stale persisted copy of itself.
 */
export async function loadPersistedTranslations(): Promise<void> {
    let stored: unknown;
    try {
        stored = await DataStore.get<unknown>(PERSIST_KEY);
    } catch (err) {
        logger.warn("Couldn't read persisted translations; starting with an empty cache.", err);
        return;
    }

    // Absent, or written by some other/older format. Not an error.
    if (!Array.isArray(stored)) return;

    const valid: [string, StoredTranslation][] = [];
    for (const row of stored) {
        // Every entry is validated rather than trusted. A shape that does not
        // match the union today is DROPPED, not coerced and not kept: the only
        // cost is re-translating that one message, whereas a bad entry renders
        // as a broken subtitle forever.
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [key, value] = row as [unknown, unknown];
        if (typeof key !== "string" || key === "") continue;
        if (!isStoredTranslation(value)) continue;
        // Markers written by earlier builds (setTranslation no longer persists
        // them): a failure is a session fact, and one read back from disk is a
        // warning about a moment nobody remembers.
        if ("failed" in value || "deferred" in value) continue;
        valid.push([key, value]);
    }

    // Insertion order is oldest-first, so the tail is the newest.
    for (const [key, value] of valid.slice(-MAX_PERSISTED)) {
        if (!persisted.has(key)) persisted.set(key, value);
        if (!cache.has(key)) {
            cache.set(key, value);
            fromDisk.add(value);
        }
    }
    trim(cache, MAX_ENTRIES);
    lastWritten = [...persisted.entries()];

    // Anything already rendered as "no translation yet" has to re-read now.
    for (const fn of listeners) fn();
}

function trim(map: Map<string, StoredTranslation>, max: number): void {
    while (map.size > max) {
        const oldest = map.keys().next().value as string;
        map.delete(oldest);
    }
}

/**
 * The cache key is (message, target language) — deliberately NOT (message,
 * target language, engine).
 *
 * Keying by engine meant a translation produced by one engine was invisible to
 * a reader configured for another: the writer wrote one engine's key while
 * the accessory looked up another's and got a guaranteed miss.
 *
 * The visible consequence, which is intended: switching engines does not
 * re-request anything. Budget is not re-spent upgrading messages the user has
 * already read.
 *
 * Separator discipline: exactly one space, and no trailing separator, so
 * `invalidateMessage`'s `"<id> "` prefix scan matches message `7` without also
 * matching message `70`.
 */
export function makeKey(messageId: string, lang: string): string {
    return `${messageId} ${lang}`;
}

export function getTranslation(key: string): StoredTranslation | undefined {
    const hit = cache.get(key);
    if (hit === undefined) return undefined;
    // Refresh recency.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
}

export function setTranslation(key: string, value: StoredTranslation): void {
    cache.delete(key);
    cache.set(key, value);
    trim(cache, MAX_ENTRIES);

    // Markers stay in this session. A failed or deferred entry is a fact
    // about a MOMENT — the throttled minute, the parked engine — not about
    // the message, and persisting one turns "the relay was busy on Tuesday"
    // into a warning shown every session until something happens to heal it.
    // Removing any older persisted value for the key matters as much as not
    // adding one: a marker must also STOP a stale disk entry from
    // resurrecting over what the reader last saw.
    if ("failed" in value || "deferred" in value) {
        if (persisted.delete(key)) schedulePersist();
    } else {
        // Same recency-refresh + eviction as the LRU above, on its own cap.
        persisted.delete(key);
        persisted.set(key, value);
        trim(persisted, MAX_PERSISTED);
        schedulePersist();
    }

    for (const fn of listeners) fn();
}

/**
 * Take a ⏳ (deferred) marker away, and only that: the message then has no
 * entry, so it shows nothing and is asked again like one never asked. For a
 * wait that will not end in a request soon (a hold, ✦ turned off), where
 * "translating…" would not be true. Markers are never on disk, so memory is
 * all there is. True when one was removed.
 */
export function dropDeferred(key: string): boolean {
    const e = cache.get(key);
    if (e === undefined || !("deferred" in e)) return false;
    cache.delete(key);
    for (const fn of listeners) fn();
    return true;
}

export function invalidateMessage(messageId: string): void {
    const prefix = `${messageId} `;
    for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
    }

    // Must reach disk too, or an edited message's pre-edit translation comes
    // back from the dead on the next restart.
    let removedFromDisk = false;
    for (const key of [...persisted.keys()]) {
        if (key.startsWith(prefix)) {
            persisted.delete(key);
            removedFromDisk = true;
        }
    }
    if (removedFromDisk) schedulePersist();

    for (const fn of listeners) fn();
}

/**
 * Drop every translation into `lang`, in memory and on disk. Used when the
 * reader switches reading language: those lines are no longer shown (keys
 * carry the language), and keeping them would only crowd the caps.
 */
export function clearLanguage(lang: string): void {
    const suffix = ` ${lang}`;
    for (const key of [...cache.keys()]) {
        if (key.endsWith(suffix)) cache.delete(key);
    }
    let removedFromDisk = false;
    for (const key of [...persisted.keys()]) {
        if (key.endsWith(suffix)) {
            persisted.delete(key);
            removedFromDisk = true;
        }
    }
    if (removedFromDisk) schedulePersist();
    for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * Drops everything held in memory, including the persistence mirror and any
 * pending write bookkeeping. Deliberately does NOT erase what is on disk: this
 * is a "reset this module's state" hook (tests, stop/start), not a "forget the
 * user's translations" one.
 */
export function clearStore(): void {
    cache.clear();
    listeners.clear();
    persisted.clear();
    lastWritten = [];
    dirty = false;
    writeChain = Promise.resolve();
}
