import * as DataStore from "@api/DataStore";

import { cleanPrefEntries, isPrefKey, PREF_KEYS, type PrefEntry, type PrefKey, type PrefValue, prefWins, validPref } from "./prefShape";

export { PREF_KEYS, type PrefEntry, type PrefKey, type PrefValue, validPref } from "./prefShape";

/**
 * SUBLINE'S SETTINGS FOLLOW THE DISCORD ACCOUNT (2026-10-16).
 *
 * What a reader changes in Subline → Settings is kept per Discord account,
 * like the 🌐 lists (channels.ts), and a linked account's computers and the
 * browser add-on share it through the relay (prefSync.ts, relay/src/prefs.ts).
 *
 * WHICH SETTINGS. Only PREF_KEYS: the reading language, earlier messages,
 * all servers, profiles and embeds, names and pronouns. Never the saved code,
 * the engine, the install ids, the debug log or any other setting that
 * belongs to this computer or is not the reader's choice.
 *
 * PER ACCOUNT. Vencord keeps one settings file for every account on this
 * computer. So each account has its own copy of these settings in the
 * DataStore (keyed by its LOCAL account key, account.ts, never the Discord
 * id). Signing in as another account writes its copy into the settings at
 * once, offline too. An account seen here for the first time starts from
 * the settings as they are. The same account as last time keeps the
 * settings as they are (a value changed while Subline was not running
 * stays, as never changed).
 *
 * FROM BEFORE. The very first account after the update takes the settings
 * as they are, and each one the reader had changed from its default counts
 * as changed now, so it reaches the account's other computers.
 *
 * TIMES. Each setting has the time it was last changed (`at`, on the relay's
 * clock as best known: `skew`), 0 for never. A setting changed here stays
 * DIRTY until the relay took it. Merging is per setting: the later one wins
 * (prefWins, the relay's rule).
 *
 * NO ECHO. A value taken from the relay or from the account's copy is
 * written while `applying` is set, so the settings' own change hook
 * (notePrefChanged) does not take it for a change made here.
 *
 * Nothing here ever throws into Discord: a failed read is an empty copy, a
 * failed write keeps the settings as they are.
 */

/** How this module reads and writes Vencord's settings (index.tsx binds settings.store). */
export interface PrefStore {
    read(key: PrefKey): unknown;
    write(key: PrefKey, value: PrefValue): void;
    /** The value the setting has when the reader never changed it. */
    defaultOf(key: PrefKey): unknown;
}

/** Each account's own copy is this, ":", and its local account key. */
const PREFS_KEY = "VcTranslate_prefs";
/** Set once the first account took the settings from before. */
export const PREFS_ADOPTED_KEY = "VcTranslate_prefsAdopted";
/** The local account key whose settings Vencord's settings hold now. */
export const PREFS_HOLDER_KEY = "VcTranslate_prefsHolder";

export function prefsKeyFor(account: string): string {
    return `${PREFS_KEY}:${account}`;
}

interface Book {
    vals: Map<PrefKey, PrefEntry>;
    dirty: Set<PrefKey>;
    /** The relay's clock minus this computer's, as last measured. */
    skew: number;
}

let store: PrefStore | null = null;
let account: string | null = null;
let book: Book | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Writing a value that is not a change made here (see NO ECHO). */
let applying = false;
/** Settings changed here while no account's copy was loaded: taken as its changes once it is. */
const changedEarly = new Set<PrefKey>();
let onChangedHere: (() => void) | null = null;

function emptyBook(): Book {
    return { vals: new Map(), dirty: new Set(), skew: 0 };
}

function parseBook(raw: unknown): Book | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const b = emptyBook();
    for (const [k, e] of Object.entries(cleanPrefEntries(o.vals))) b.vals.set(k as PrefKey, e);
    if (Array.isArray(o.dirty)) for (const k of o.dirty) if (isPrefKey(k) && b.vals.has(k)) b.dirty.add(k);
    b.skew = typeof o.skew === "number" && Number.isFinite(o.skew) ? o.skew : 0;
    return b;
}

function serialise(b: Book): unknown {
    return { v: 1, vals: Object.fromEntries(b.vals), dirty: [...b.dirty], skew: b.skew };
}

function cloneBook(b: Book): Book {
    return { vals: new Map(b.vals), dirty: new Set(b.dirty), skew: b.skew };
}

/** Run `fn` after every earlier change, so a switch and a change never interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
}

function read(key: PrefKey): unknown {
    try { return store?.read(key); } catch { return undefined; }
}

/** Write `value` into the settings without it counting as a change made here. Never throws. */
function applyValue(key: PrefKey, value: PrefValue): void {
    if (store === null || read(key) === value) return;
    applying = true;
    try {
        store.write(key, value);
    } catch { /* the setting stays as it is */ } finally {
        applying = false;
    }
}

/** Bind Vencord's settings (start) or unbind them (stop: null). */
export function bindPrefStore(next: PrefStore | null): void {
    store = next;
}

/** Called after a change made here was recorded (prefSync.ts pushes it). */
export function onPrefChangedHere(fn: (() => void) | null): void {
    onChangedHere = fn;
}

/** Run `fn` (a write that is not the reader's choice, like tidying an old value) without stamping it. */
export function withoutPrefStamp(fn: () => void): void {
    const was = applying;
    applying = true;
    try { fn(); } finally { applying = was; }
}

/** Whose copy is loaded or loading (a local account key), or null. */
export function prefAccount(): string | null {
    return account;
}

/**
 * Load `next`'s copy and write it into the settings (null: none). An account
 * seen here for the first time starts from the settings as they are. Never
 * throws.
 */
export function usePrefAccount(next: string | null): Promise<void> {
    account = next;
    book = null;
    if (next === null) return Promise.resolve();
    return serial(async () => {
        if (account !== next) return;
        let loaded: Book | null = null;
        try {
            loaded = parseBook(await DataStore.get<unknown>(prefsKeyFor(next)));
        } catch { /* a fresh copy below */ }
        let holder: unknown = null;
        try { holder = await DataStore.get<unknown>(PREFS_HOLDER_KEY); } catch { /* another account's, below */ }
        // The settings already hold this account's own (the same account as
        // last time): they stay as they are, and the copy follows them.
        const same = loaded !== null && holder === next;
        if (loaded === null) loaded = await adopt();
        if (account !== next) return;
        // A setting the copy does not have (a damaged copy, a setting newer
        // than it), or one changed while Subline was not running: as it is
        // here, never changed.
        for (const key of PREF_KEYS) {
            const value = read(key);
            if (!validPref(key, value)) continue;
            const e = loaded.vals.get(key);
            if (e === undefined || (same && e.value !== value)) {
                loaded.vals.set(key, { value, at: 0 });
                loaded.dirty.delete(key);
            }
        }
        // Changed here before the copy was loaded: those are this account's changes.
        const now = Date.now() + loaded.skew;
        for (const key of changedEarly) {
            const value = read(key);
            if (!validPref(key, value)) continue;
            loaded.vals.set(key, { value, at: now });
            loaded.dirty.add(key);
        }
        changedEarly.clear();
        // Another account's settings were in place: this account's go in.
        if (!same) for (const [key, e] of loaded.vals) applyValue(key, e.value);
        book = loaded;
        try {
            await DataStore.set(prefsKeyFor(next), serialise(loaded));
            await DataStore.set(PREFS_HOLDER_KEY, next);
        } catch { /* used for this session all the same */ }
    });
}

/** A new account's copy: the settings as they are. The first ever counts what was changed from a default as changed now. */
async function adopt(): Promise<Book> {
    const b = emptyBook();
    let first = false;
    try { first = (await DataStore.get<unknown>(PREFS_ADOPTED_KEY)) !== true; } catch { /* not first */ }
    const now = Date.now();
    for (const key of PREF_KEYS) {
        const value = read(key);
        if (!validPref(key, value)) continue;
        let byDefault = true;
        try { byDefault = value === store?.defaultOf(key); } catch { /* counted as the default */ }
        const changed = first && !byDefault;
        b.vals.set(key, { value, at: changed ? now : 0 });
        if (changed) b.dirty.add(key);
    }
    if (first) {
        try { await DataStore.set(PREFS_ADOPTED_KEY, true); } catch { /* tried again on the next new account */ }
    }
    return b;
}

/** Forget the loaded copy (stop()). */
export function forgetPrefAccount(): void {
    account = null;
    book = null;
    changedEarly.clear();
}

/**
 * A setting changed (its onChange). A change made here is stamped and kept
 * dirty for the relay; a value this module wrote is not. Never throws.
 */
export function notePrefChanged(key: PrefKey): void {
    if (applying) return;
    try {
        if (store === null) return;
        if (account === null || book === null) {
            changedEarly.add(key);
            return;
        }
        const owner = account;
        // The value and the time of the change, not of the write after it.
        const value = read(key);
        const when = Date.now();
        if (!validPref(key, value)) return;
        void commit(owner, b => {
            // The same value again is no change (Vencord does not even call onChange for it).
            if (b.vals.get(key)?.value === value) return null;
            b.vals.set(key, { value, at: when + b.skew });
            b.dirty.add(key);
            return true;
        }).then(changed => {
            if (changed === true) onChangedHere?.();
        });
    } catch { /* the setting works here as before */ }
}

/**
 * Change `owner`'s copy and persist it, after every earlier change. Nothing
 * when the copy is not `owner`'s any more. On a failed write the copy is
 * restored (memory never differs from the disk). A `change` that answers
 * null changed nothing: nothing is written. Resolves `change`'s answer, or
 * null. Never rejects.
 */
function commit<T>(owner: string, change: (b: Book) => T | null, after?: (out: T) => void): Promise<T | null> {
    return serial(async () => {
        if (account !== owner || book === null) return null;
        const before = cloneBook(book);
        const out = change(book);
        if (out === null) return null;
        try {
            await DataStore.set(prefsKeyFor(owner), serialise(book));
        } catch {
            if (account === owner) book = before;
            return null;
        }
        if (account === owner) after?.(out);
        return out;
    }).catch(() => null);
}

/* ------------------------------------------------------- sync support -- */

export interface PrefSnapshot {
    vals: Map<PrefKey, PrefEntry>;
    dirty: PrefKey[];
    skew: number;
}

/** `owner`'s copy, or null when it is not the loaded one. */
export function prefSnapshot(owner: string): PrefSnapshot | null {
    if (account !== owner || book === null) return null;
    return { vals: new Map(book.vals), dirty: [...book.dirty], skew: book.skew };
}

/**
 * Take the relay's settings into `owner`'s copy and into Vencord's settings
 * (one write). Per setting: a newer one there is taken (and written into the
 * settings); the same value takes the relay's time (so a clock that ran ahead
 * here cannot win later); a newer one here stays and is sent. Returns the
 * settings that changed. Nothing when the copy is not `owner`'s any more.
 */
export async function applyRemotePrefs(owner: string, remote: Partial<Record<PrefKey, PrefEntry>>, skew: number | null): Promise<PrefKey[]> {
    const changed = await commit(owner, b => {
        if (skew !== null) b.skew = skew;
        const out: PrefKey[] = [];
        const take: [PrefKey, PrefValue][] = [];
        for (const key of PREF_KEYS) {
            const there = remote[key];
            const here = b.vals.get(key);
            if (there === undefined) {
                if (here !== undefined && here.at > 0) b.dirty.add(key);
                continue;
            }
            if (here === undefined || (here.value !== there.value && prefWins(there, here))) {
                b.vals.set(key, there);
                b.dirty.delete(key);
                take.push([key, there.value]);
                out.push(key);
            } else if (here.value === there.value) {
                b.vals.set(key, { value: here.value, at: there.at });
                b.dirty.delete(key);
                take.push([key, there.value]);
            } else if (here.at > 0) {
                b.dirty.add(key);
            }
        }
        return { out, take };
    }, ({ take }) => {
        // Only once the copy is on disk, so the two never differ.
        for (const [key, value] of take) applyValue(key, value);
    });
    return changed?.out ?? [];
}

/**
 * The relay took these (each with the time it had here when sent): no longer
 * dirty, unless the setting changed again since.
 */
export async function settlePrefs(owner: string, sent: { key: PrefKey; at: number; }[]): Promise<void> {
    await commit(owner, b => {
        for (const { key, at } of sent) {
            if ((b.vals.get(key)?.at ?? 0) <= at) b.dirty.delete(key);
        }
    });
}

/** Tests only: start over. */
export function __resetPrefs(): void {
    store = null;
    account = null;
    book = null;
    queue = Promise.resolve();
    applying = false;
    changedEarly.clear();
    onChangedHere = null;
}
