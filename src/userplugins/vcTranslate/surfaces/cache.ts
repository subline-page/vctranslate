/**
 * The translation cache for text OUTSIDE messages: statuses, bios, embeds,
 * polls, reply and forward previews, channel topics and the like.
 *
 * KEYED BY TEXT, NOT BY PLACE. The same custom status shows in the member
 * list, the DM list and the profile; the same link preview is posted in ten
 * channels. Each distinct text (normalised) is translated once per target
 * language and reused everywhere, in this session and the next.
 *
 * BOUNDED. At most `maxEntries` (2,000), least recently used first out, and
 * nothing older than `maxAgeMs` (30 days) is served or kept. Persisted to
 * DataStore after a short quiet period, so a member list rendering fifty
 * statuses writes once, not fifty times.
 *
 * Every entry read from disk is validated, never trusted: a bad row is dropped
 * and that one text is simply translated again.
 */

export interface SurfaceTranslation {
    lang: string;
    text: string;
}

export interface SurfaceEntry {
    /** ✦, the relay. */
    quality?: SurfaceTranslation;
    /** ✦ judged it not foreign (already in the target language). */
    skip?: true;
    /**
     * The reader asked for this ✦ with a click on a name (0.2.8,
     * SurfaceService.askQuality). A name in the reader's own script shows a
     * ✦ answer only then: the same text's ✦ from a status or a title is the
     * meaning of the words, and a name is not its meaning (decision 9).
     */
    asked?: true;
    /** Last written or read, epoch ms. Drives both the LRU and the age limit. */
    at: number;
}

/**
 * v3 (0.2.9, AI only): the cache holds ✦ answers only. The first load of v3
 * migrates the older keys (v2, and v1 from 0.2.0) keeping only ✦
 * translations: every Google ≈ line is dropped, so none can ever show again,
 * and so is every skip-only entry, since an older skip may be Google's verdict
 * (v1's low-confidence "unsure" answers among them). Those texts are simply
 * asked again. The older keys are emptied once migrated.
 */
export const SURFACE_CACHE_KEY = "VcTranslate_surfaceCache_v3";
/** The 0.2.1 to 0.2.8 key (✦ and Google's ≈ side by side). */
export const SURFACE_CACHE_V2_KEY = "VcTranslate_surfaceCache_v2";
/** The 0.2.0 key. */
export const SURFACE_CACHE_LEGACY_KEY = "VcTranslate_surfaceCache";
export const SURFACE_CACHE_MAX_ENTRIES = 2_000;
export const SURFACE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SURFACE_PERSIST_DELAY_MS = 2_000;

/** Whitespace-insensitive at the edges and within lines, line-break-preserving. */
export function normalizeSurfaceText(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(line => line.replace(/[ \t ]+/g, " ").trim())
        .join("\n")
        .trim();
}

export function surfaceKey(text: string, targetLang: string): string {
    return `${targetLang}\u0000${normalizeSurfaceText(text)}`;
}

/**
 * A NAME or pronouns has its own key (0.2.9): names are always asked forced
 * (a reading of a script the reader cannot read is always worth showing), so
 * an older unforced "no translation needed" for the same text never hides it.
 */
export function nameKey(text: string, targetLang: string): string {
    return `${targetLang}\u0001${normalizeSurfaceText(text)}`;
}

export interface SurfaceStorage {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

export interface SurfaceCacheOptions {
    storage: SurfaceStorage;
    now: () => number;
    schedule: (fn: () => void, ms: number) => unknown;
    cancel: (handle: unknown) => void;
    maxEntries?: number;
    maxAgeMs?: number;
    persistDelayMs?: number;
}

function isTranslation(v: unknown): v is SurfaceTranslation {
    if (v === null || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return typeof o.lang === "string" && typeof o.text === "string" && o.text.trim() !== "";
}

/**
 * A stored row, checked field by field, as the entry it may be kept as, or
 * null. Only ✦ (`quality`) and a ✦ skip are kept; a Google line (`fast`, an
 * older build's) is never part of the result.
 */
function entryFrom(v: unknown): SurfaceEntry | null {
    if (v === null || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
    if (o.quality !== undefined && !isTranslation(o.quality)) return null;
    if (o.skip !== undefined && o.skip !== true) return null;
    if (o.asked !== undefined && o.asked !== true) return null;
    if (o.quality !== undefined) {
        const q = o.quality as SurfaceTranslation;
        return { quality: { lang: q.lang, text: q.text }, ...(o.asked === true ? { asked: true as const } : {}), at: o.at };
    }
    return o.skip === true ? { skip: true, at: o.at } : null;
}

export class SurfaceCache {
    private readonly map = new Map<string, SurfaceEntry>();
    private timer: unknown = null;
    private readonly maxEntries: number;
    private readonly maxAgeMs: number;
    private readonly persistDelayMs: number;
    private writes = Promise.resolve();

    constructor(private readonly opts: SurfaceCacheOptions) {
        this.maxEntries = opts.maxEntries ?? SURFACE_CACHE_MAX_ENTRIES;
        this.maxAgeMs = opts.maxAgeMs ?? SURFACE_CACHE_MAX_AGE_MS;
        this.persistDelayMs = opts.persistDelayMs ?? SURFACE_PERSIST_DELAY_MS;
    }

    get size(): number {
        return this.map.size;
    }

    /** The entry for a key, touched (most recently used). Expired entries are dropped. */
    get(key: string): SurfaceEntry | undefined {
        const entry = this.map.get(key);
        if (entry === undefined) return undefined;
        const now = this.opts.now();
        if (now - entry.at > this.maxAgeMs) {
            this.map.delete(key);
            this.schedulePersist();
            return undefined;
        }
        // Touch: re-insert at the young end. The timestamp is refreshed too,
        // so a status seen every day never ages out.
        this.map.delete(key);
        entry.at = now;
        this.map.set(key, entry);
        return entry;
    }

    /**
     * Merge a verdict into an entry. A skip never removes a ✦ line. `asked`
     * marks the entry's ✦ as one the reader asked for (only with a ✦ there).
     */
    put(key: string, patch: { quality?: SurfaceTranslation; skip?: true; asked?: true }): SurfaceEntry {
        const prev = this.map.get(key);
        const next: SurfaceEntry = { ...(prev ?? {}), at: this.opts.now() };
        if (patch.quality) {
            next.quality = patch.quality;
            delete next.skip;
        }
        if (patch.skip && !next.quality) next.skip = true;
        if (patch.asked && next.quality) next.asked = true;
        this.map.delete(key);
        this.map.set(key, next);
        this.evict();
        this.schedulePersist();
        return next;
    }

    private evict(): void {
        while (this.map.size > this.maxEntries) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    private schedulePersist(): void {
        if (this.timer !== null) return;
        this.timer = this.opts.schedule(() => {
            this.timer = null;
            void this.persistNow();
        }, this.persistDelayMs);
    }

    /** Write everything now. Never rejects. */
    persistNow(): Promise<void> {
        if (this.timer !== null) {
            this.opts.cancel(this.timer);
            this.timer = null;
        }
        const snapshot = [...this.map.entries()];
        this.writes = this.writes.then(() => this.opts.storage.set(SURFACE_CACHE_KEY, snapshot)).catch(() => { });
        return this.writes;
    }

    /** Load from disk. Entries set this session win. Never rejects. */
    async load(): Promise<void> {
        let stored: unknown;
        const migratedFrom: string[] = [];
        try {
            stored = await this.opts.storage.get(SURFACE_CACHE_KEY);
            if (!Array.isArray(stored)) {
                // First start on v3: take the newest older cache's ✦ answers
                // only (see SURFACE_CACHE_KEY). Both older keys are emptied.
                for (const legacyKey of [SURFACE_CACHE_V2_KEY, SURFACE_CACHE_LEGACY_KEY]) {
                    const legacy = await this.opts.storage.get(legacyKey);
                    if (!Array.isArray(legacy)) continue;
                    migratedFrom.push(legacyKey);
                    if (Array.isArray(stored)) continue;
                    stored = legacy.filter(row => Array.isArray(row) && row.length === 2 && entryFrom(row[1])?.quality !== undefined);
                }
            }
        } catch {
            return;
        }
        if (!Array.isArray(stored)) return;
        const now = this.opts.now();
        const loaded = new Map<string, SurfaceEntry>();
        for (const row of stored) {
            if (!Array.isArray(row) || row.length !== 2) continue;
            const [key, value] = row as [unknown, unknown];
            if (typeof key !== "string" || key === "") continue;
            const entry = entryFrom(value);
            if (entry === null) continue;
            if (now - entry.at > this.maxAgeMs) continue;
            loaded.set(key, entry);
        }
        // Disk order is LRU order (oldest first); session entries go after it.
        const session = [...this.map.entries()];
        const inSession = new Set(this.map.keys());
        this.map.clear();
        for (const [k, v] of loaded) if (!inSession.has(k)) this.map.set(k, v);
        for (const [k, v] of session) this.map.set(k, v);
        this.evict();
        if (migratedFrom.length > 0) {
            this.schedulePersist();
            // The older keys are not read again; empty them so they hold nothing.
            for (const legacyKey of migratedFrom) {
                this.writes = this.writes.then(() => this.opts.storage.set(legacyKey, [])).catch(() => { });
            }
        }
    }

    /** Drop everything in memory (stop()). Disk is untouched. */
    clear(): void {
        if (this.timer !== null) this.opts.cancel(this.timer);
        this.timer = null;
        this.map.clear();
    }

    keys(): string[] {
        return [...this.map.keys()];
    }
}
