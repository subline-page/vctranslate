import * as DataStore from "@api/DataStore";

import type { ChannelSyncEntry, ChannelSyncState } from "./engines/relay";

/**
 * Two persisted per-channel lists, one for each meaning of the 🌐 button.
 *
 * ENABLED is the opt-in list: channels translated although globalAuto does not
 * cover them (globalAuto is off, or the channel is a DM).
 *
 * DISABLED is the opt-out list: server channels globalAuto WOULD translate but
 * the user switched off. Without it, "Disable auto-translate here" had nothing
 * to write to while globalAuto was on, so it added the channel to ENABLED and
 * the channel stayed on.
 *
 * Which list a click edits is decided by index.tsx (channelActive), because
 * that needs settings and Discord's channel store. This module only stores.
 *
 * PER DISCORD ACCOUNT (2026-10-16). Each Discord account signed in on this
 * computer has its own two lists, in its own DataStore entry (keyed by its
 * LOCAL account key, account.ts accountKeyFor, never the Discord id), so two
 * accounts on one computer never share choices. The lists from before (one
 * pair for everybody) go to the account that is signed in first after the
 * update, and are then removed.
 *
 * FOLLOWING THE ACCOUNT (channelSync.ts). A linked account's choices are kept
 * by the relay too, so the desktop app and the browser add-on show the same
 * ones. For that, every channel changed here has a time (`at`, on the
 * relay's clock as best known: `skew`) and stays DIRTY until the relay took
 * it. Entries the relay has for channels this computer cannot name yet (the
 * relay knows only hashes) wait in `remote` until such a channel shows up.
 * Without a link, or without the relay, none of that changes anything here.
 */

/** The lists from before (one pair for every account). */
export const LEGACY_ENABLED_KEY = "VcTranslate_enabledChannels";
export const LEGACY_DISABLED_KEY = "VcTranslate_disabledChannels";

/** Each account's own entry is this, ":", and its local account key. */
const CHANNELS_KEY = "VcTranslate_channels";

/** An account's own entry. */
export function channelsKeyFor(account: string): string {
    return `${CHANNELS_KEY}:${account}`;
}

/** At most this many remote entries wait for a channel to match (the relay keeps as many). */
export const REMOTE_MAX = 1000;
/** At most this many "default" times are kept (a channel switched back to how it was). */
export const DEFAULT_STAMPS_MAX = 1000;

interface Book {
    enabled: Set<string>;
    disabled: Set<string>;
    /** Channel id -> when it was last changed (relay clock, ms). */
    at: Map<string, number>;
    /** Channels changed here that the relay has not taken yet. */
    dirty: Set<string>;
    /** The relay's clock minus this computer's, as last measured. */
    skew: number;
    /** The salt `remote` was hashed with ("" before the first answer). */
    salt: string;
    /** Hash -> entry, for channels not matched to an id here yet. */
    remote: Map<string, ChannelSyncEntry>;
}

const RANK: Record<ChannelSyncState, number> = { default: 0, on: 1, off: 2 };
const STATES: readonly string[] = ["on", "off", "default"];
const HASH_RE = /^[0-9a-f]{16}$/;

/** Whether `a` replaces `b`: later wins; at the same time, off over on over default (the relay's rule). */
export function entryWins(a: ChannelSyncEntry, b: ChannelSyncEntry): boolean {
    return a.at > b.at || (a.at === b.at && RANK[a.s] > RANK[b.s]);
}

// Before an account's lists are loaded nothing is on: isChannelEnabled is
// false and isChannelDisabled is true for every channel. That fail-safe
// direction (translation off, not on) is deliberate.
let account: string | null = null;
let book: Book | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function emptyBook(): Book {
    return { enabled: new Set(), disabled: new Set(), at: new Map(), dirty: new Set(), skew: 0, salt: "", remote: new Map() };
}

function ids(stored: unknown): Set<string> {
    // A corrupted or older-format entry must not throw (breaks all channels)
    // or silently iterate a string's characters into bogus ids.
    return new Set(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string" && x !== "") : []);
}

const finiteAt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseBook(raw: unknown): Book | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const b = emptyBook();
    b.enabled = ids(o.on);
    b.disabled = ids(o.off);
    for (const id of b.enabled) b.disabled.delete(id);
    if (o.at && typeof o.at === "object") {
        for (const [id, at] of Object.entries(o.at as Record<string, unknown>)) if (id !== "" && finiteAt(at)) b.at.set(id, at);
    }
    b.dirty = ids(o.dirty);
    b.skew = typeof o.skew === "number" && Number.isFinite(o.skew) ? o.skew : 0;
    b.salt = typeof o.salt === "string" && HASH_RE.test(o.salt) ? o.salt : "";
    if (b.salt !== "" && o.remote && typeof o.remote === "object") {
        for (const [h, e] of Object.entries(o.remote as Record<string, unknown>)) {
            const v = e as { s?: unknown; at?: unknown; } | null;
            if (HASH_RE.test(h) && v && typeof v.s === "string" && STATES.includes(v.s) && finiteAt(v.at)) b.remote.set(h, { s: v.s as ChannelSyncState, at: v.at });
        }
    }
    return b;
}

function serialise(b: Book): unknown {
    return {
        v: 1,
        on: [...b.enabled],
        off: [...b.disabled],
        at: Object.fromEntries(b.at),
        dirty: [...b.dirty],
        skew: b.skew,
        salt: b.salt,
        remote: Object.fromEntries(b.remote)
    };
}

function cloneBook(b: Book): Book {
    return {
        enabled: new Set(b.enabled), disabled: new Set(b.disabled), at: new Map(b.at), dirty: new Set(b.dirty),
        skew: b.skew, salt: b.salt, remote: new Map(b.remote)
    };
}

function emit(set: Set<() => void>): void {
    for (const fn of [...set]) {
        try { fn(); } catch { /* one listener never stops the others */ }
    }
}

/** Run `fn` after every earlier change, so a switch and a click never interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
}

/** Re-render whatever shows a channel's state (the 🌐 button, the translations). Returns the unsubscribe. */
export function subscribeChannels(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** Whose lists are loaded or loading (a local account key), or null. */
export function channelAccount(): string | null {
    return account;
}

/** Whether `owner`'s lists are the loaded ones. */
export function channelsLoadedFor(owner: string): boolean {
    return account === owner && book !== null;
}

/**
 * Load `next`'s lists (null: none, nothing is on). The lists from before go
 * to the first account loaded after the update. Never throws: an unreadable
 * entry is an empty list.
 */
export function useChannelAccount(next: string | null): Promise<void> {
    // Nothing of the account before stays on while the next one loads.
    account = next;
    book = null;
    emit(listeners);
    if (next === null) return Promise.resolve();
    return serial(async () => {
        if (account !== next) return;
        let loaded: Book | null = null;
        try {
            loaded = parseBook(await DataStore.get<unknown>(channelsKeyFor(next)));
        } catch { /* an empty list below */ }
        if (loaded === null) loaded = await takeLegacyLists(next);
        if (account !== next) return;
        book = loaded;
        emit(listeners);
    });
}

/** The lists from before, as `next`'s: stamped now and dirty (so a linked account shares them). Removed once moved. */
async function takeLegacyLists(next: string): Promise<Book> {
    const b = emptyBook();
    let on: unknown, off: unknown;
    try {
        on = await DataStore.get<unknown>(LEGACY_ENABLED_KEY);
        off = await DataStore.get<unknown>(LEGACY_DISABLED_KEY);
    } catch {
        return b;
    }
    if (on === undefined && off === undefined) return b;
    b.enabled = ids(on);
    b.disabled = ids(off);
    for (const id of b.enabled) b.disabled.delete(id);
    const now = Date.now();
    for (const id of [...b.enabled, ...b.disabled]) {
        b.at.set(id, now);
        b.dirty.add(id);
    }
    try {
        await DataStore.set(channelsKeyFor(next), serialise(b));
        // Only once they are this account's on disk: a failed write leaves
        // them for the next start.
        await DataStore.del(LEGACY_ENABLED_KEY);
        await DataStore.del(LEGACY_DISABLED_KEY);
    } catch { /* used for this session all the same */ }
    return b;
}

/** Forget the loaded lists (stop()): nothing is on until the next load. */
export function forgetChannelAccount(): void {
    account = null;
    book = null;
    emit(listeners);
}

export function isChannelEnabled(id: string): boolean {
    return book !== null && book.enabled.has(id);
}

export function isChannelDisabled(id: string): boolean {
    return book === null || book.disabled.has(id);
}

function stateIn(b: Book, id: string): ChannelSyncState {
    return b.enabled.has(id) ? "on" : b.disabled.has(id) ? "off" : "default";
}

function setState(b: Book, id: string, s: ChannelSyncState): void {
    b.enabled.delete(id);
    b.disabled.delete(id);
    if (s === "on") b.enabled.add(id);
    else if (s === "off") b.disabled.add(id);
}

/** Keep the "default" times bounded: the oldest that are not waiting for the relay go. */
function trimStamps(b: Book): void {
    const defaults = [...b.at].filter(([id]) => stateIn(b, id) === "default" && !b.dirty.has(id));
    if (defaults.length <= DEFAULT_STAMPS_MAX) return;
    defaults.sort((x, y) => x[1] - y[1]);
    for (const [id] of defaults.slice(0, defaults.length - DEFAULT_STAMPS_MAX)) b.at.delete(id);
}

/**
 * Change `owner`'s lists (the account loaded when the change was asked) and
 * persist them, after every earlier change. On a failed write the lists are
 * restored, so memory never diverges from what is actually persisted, and
 * the error is rethrown. `quiet`: a failed write is not an error (the sync's
 * own bookkeeping: the next sync does it again), and nothing happens when
 * the lists are not `owner`'s any more. Resolves `change`'s answer.
 */
function commit<T>(owner: string | null, change: (b: Book) => T, quiet = false): Promise<T | null> {
    return serial(async () => {
        if (owner === null || account !== owner || book === null) {
            if (quiet) return null;
            throw new Error("Subline: the channel lists are not loaded");
        }
        const before = cloneBook(book);
        const out = change(book);
        trimStamps(book);
        try {
            await DataStore.set(channelsKeyFor(owner), serialise(book));
        } catch (err) {
            if (account === owner) book = before;
            if (quiet) return null;
            throw err;
        }
        emit(listeners);
        return out;
    });
}

function stampHere(b: Book, id: string): void {
    b.at.set(id, Date.now() + b.skew);
    b.dirty.add(id);
}

/**
 * Opt-in toggle, for a channel globalAuto does not cover. Returns whether the
 * channel is now on. Turning it on also clears any earlier opt-out, so the
 * channel stays on if globalAuto is switched on later.
 */
export async function toggleChannel(id: string): Promise<boolean> {
    const on = await commit(account, b => {
        const s: ChannelSyncState = b.enabled.has(id) ? "default" : "on";
        setState(b, id, s);
        stampHere(b, id);
        return s === "on";
    });
    return on === true;
}

/**
 * Opt-out toggle, for a server channel globalAuto covers. Returns whether the
 * channel is now on. Turning it off also clears any earlier opt-in, so the two
 * lists never both hold the same channel.
 */
export async function toggleChannelOptOut(id: string): Promise<boolean> {
    const on = await commit(account, b => {
        const s: ChannelSyncState = b.disabled.has(id) ? "default" : "off";
        setState(b, id, s);
        stampHere(b, id);
        return s !== "off";
    });
    return on === true;
}

/* ------------------------------------------------------- sync support -- */

/** What the sync needs to know about `owner`'s lists. */
export interface ChannelSnapshot {
    /** Every channel with a state or a time here. */
    entries: Map<string, ChannelSyncEntry>;
    dirty: string[];
    skew: number;
    salt: string;
    remote: Map<string, ChannelSyncEntry>;
}

/** `owner`'s lists, or null when they are not the loaded ones. */
export function channelSnapshot(owner: string): ChannelSnapshot | null {
    if (account !== owner || book === null) return null;
    const entries = new Map<string, ChannelSyncEntry>();
    for (const id of new Set([...book.enabled, ...book.disabled, ...book.at.keys()])) {
        entries.set(id, { s: stateIn(book, id), at: book.at.get(id) ?? 0 });
    }
    return { entries, dirty: [...book.dirty], skew: book.skew, salt: book.salt, remote: new Map(book.remote) };
}

/** Take one remote entry for channel `id` into `b`. Returns whether its state changed. */
function takeEntry(b: Book, id: string, e: ChannelSyncEntry): boolean {
    const here: ChannelSyncEntry = { s: stateIn(b, id), at: b.at.get(id) ?? 0 };
    if (entryWins(e, here)) {
        setState(b, id, e.s);
        b.at.set(id, e.at);
        b.dirty.delete(id);
        return here.s !== e.s;
    }
    // This computer's is newer (or the same): pushed when it differs.
    if (here.s !== e.s || here.at !== e.at) {
        if (!b.at.has(id)) b.at.set(id, here.at);
        b.dirty.add(id);
    } else {
        b.dirty.delete(id);
    }
    return false;
}

/**
 * Take the relay's answer into `owner`'s lists (one write):
 *  - `skew`: the relay's clock minus this computer's (null: unknown).
 *  - `salt`: a salt other than the one held means the relay's list was made
 *    again: the waiting remote entries go, and every channel with a time
 *    here is pushed again.
 *  - `matched`: remote entries this computer could name (`h` is the hash).
 *    Newer than here: taken (and no longer dirty). Older or the same: this
 *    computer's stays, and is pushed when it differs.
 *  - `unmatched`: entries for channels not known here; they wait (newest kept).
 * Returns the channels whose state changed. Never throws; nothing when the
 * lists are not `owner`'s any more.
 */
export async function applyRemoteChannels(
    owner: string, salt: string, skew: number | null,
    matched: { id: string; h: string; e: ChannelSyncEntry; }[], unmatched: Map<string, ChannelSyncEntry>
): Promise<string[]> {
    const changed = await commit(owner, b => {
        const out: string[] = [];
        if (skew !== null) b.skew = skew;
        if (b.salt !== salt) {
            b.salt = salt;
            b.remote.clear();
            for (const id of b.at.keys()) b.dirty.add(id);
        }
        for (const { id, h, e } of matched) {
            b.remote.delete(h);
            if (takeEntry(b, id, e)) out.push(id);
        }
        for (const [h, e] of unmatched) {
            const waiting = b.remote.get(h);
            if (waiting === undefined || entryWins(e, waiting)) b.remote.set(h, e);
        }
        if (b.remote.size > REMOTE_MAX) {
            const sorted = [...b.remote].sort((x, y) => x[1].at - y[1].at);
            for (const [h] of sorted.slice(0, b.remote.size - REMOTE_MAX)) b.remote.delete(h);
        }
        return out;
    }, true);
    return changed ?? [];
}

/**
 * A channel showed up (opened) whose hash under the held salt is `hash`: a
 * remote entry waiting for it is taken in. Returns whether its state changed.
 */
export async function matchWaiting(owner: string, id: string, hash: string): Promise<boolean> {
    if (account !== owner || book === null || !book.remote.has(hash)) return false;
    const changed = await commit(owner, b => {
        const e = b.remote.get(hash);
        if (e === undefined) return false;
        b.remote.delete(hash);
        return takeEntry(b, id, e);
    }, true);
    return changed === true;
}

/**
 * The relay took these changes (each id with the time it had here when sent):
 * no longer dirty, unless the channel changed again since. `drop`: the relay
 * will never take them (refused as malformed): no longer dirty either way.
 */
export async function settleDirty(owner: string, sent: { id: string; at: number; }[], drop = false): Promise<void> {
    await commit(owner, b => {
        for (const { id, at } of sent) {
            if (drop || (b.at.get(id) ?? 0) <= at) b.dirty.delete(id);
        }
    }, true);
}
