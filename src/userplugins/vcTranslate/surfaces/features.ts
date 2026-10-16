/**
 * The parts of Subline the owner's OFF SWITCH covers (relay/src/features.ts
 * holds the same ids, with the owner's labels). Plain data, so the main
 * process (engines/relay.ts) can read the status answer with it too.
 *
 * The switch rides in the status answer as `off: string[]`. Read strictly:
 * an array of at most MAX_OFF strings, each matching FEATURE_ID_RE. Anything
 * else means "not stated", and the plugin keeps the last list it had. Ids this
 * build does not know are dropped (a newer relay's feature).
 */

export const FEATURE_IDS = [
    "topic", "voice-status", "rules", "guidelines", "event", "stage-topic", "thread-title", "forum-title",
    "forum-tag", "status-list", "bio", "onboarding", "status-profile", "reply-quote", "name-message",
    "name-mention", "name-profile", "messages"
] as const;

export type FeatureId = typeof FEATURE_IDS[number];

export const FEATURE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_OFF = 40;

const KNOWN: ReadonlySet<string> = new Set(FEATURE_IDS);

/** The `off` field of a status answer: the known ids switched off, or undefined when it is absent or malformed. */
export function offListFrom(raw: unknown): FeatureId[] | undefined {
    if (!Array.isArray(raw) || raw.length > MAX_OFF) return undefined;
    if (!raw.every(x => typeof x === "string" && FEATURE_ID_RE.test(x))) return undefined;
    const set = new Set(raw as string[]);
    return FEATURE_IDS.filter(id => set.has(id) && KNOWN.has(id));
}
