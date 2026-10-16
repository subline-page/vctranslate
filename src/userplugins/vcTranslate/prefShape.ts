import { SUPPORTED_LANGUAGE_CODES } from "./languages";

/**
 * Which Subline settings follow the Discord account, and what each may hold
 * (prefs.ts keeps them, prefSync.ts shares them). Pure, so the main process
 * (engines/relay.ts) checks a relay answer with the same rules.
 *
 * relay/src/prefs.ts PREF_SPECS has the same keys and the same rules, and
 * relay/test/prefs.test.ts fails when they differ.
 */
export const PREF_KEYS = [
    "targetLang",
    "catchUpCount",
    "globalAuto",
    "translateSurfaces",
    "translateNames"
] as const;

export type PrefKey = typeof PREF_KEYS[number];
export type PrefValue = string | number | boolean;
export interface PrefEntry { value: PrefValue; at: number; }

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

const VALID: Record<PrefKey, (v: unknown) => boolean> = {
    targetLang: v => typeof v === "string" && SUPPORTED_LANGUAGE_CODES.includes(v),
    catchUpCount: v => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 50,
    globalAuto: isBool,
    translateSurfaces: isBool,
    translateNames: isBool
};

export function isPrefKey(key: unknown): key is PrefKey {
    return typeof key === "string" && (PREF_KEYS as readonly string[]).includes(key);
}

export function validPref(key: PrefKey, value: unknown): value is PrefValue {
    return VALID[key](value);
}

/** Whether `a` replaces `b`: later wins; at the same time, the larger value (as JSON) wins (the relay's rule). */
export function prefWins(a: PrefEntry, b: PrefEntry): boolean {
    if (a.at !== b.at) return a.at > b.at;
    return JSON.stringify(a.value) > JSON.stringify(b.value);
}

/** The known, well-formed entries of `raw` (key -> { value, at }); anything else is left out. Never throws. */
export function cleanPrefEntries(raw: unknown): Partial<Record<PrefKey, PrefEntry>> {
    const out: Partial<Record<PrefKey, PrefEntry>> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const key of PREF_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const e = (raw as Record<string, unknown>)[key];
        if (!e || typeof e !== "object" || Array.isArray(e)) continue;
        const { value, at } = e as { value?: unknown; at?: unknown; };
        if (validPref(key, value) && typeof at === "number" && Number.isFinite(at) && at >= 0) out[key] = { value, at };
    }
    return out;
}
