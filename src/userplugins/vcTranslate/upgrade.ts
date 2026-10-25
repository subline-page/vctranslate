import type { StoredTranslation } from "./store";
import type { EngineId } from "./types";

/**
 * How authoritative an engine's output is.
 *
 * 0.2.9 has one engine (the relay, ✦), so every line it writes has the same
 * rank and a later answer for the same message (a ⚡ press, an edit) may
 * replace an earlier one. The bring-your-own-key engines share that rank:
 * they only appear on lines an older build stored. Google (0) and the
 * short-message judge (0.5) are gone; their stored lines are dropped when the
 * store loads (store.ts), so nothing below rank 1 exists any more.
 */
export const ENGINE_RANK: Record<EngineId, number> = {
    relay: 1,
    claude: 1,
    gemini: 1,
    groq: 1
};

/**
 * The rank of an engine id, or -1 for one this build does not know (a line an
 * older build stored under Google or the judge, should one ever reach memory):
 * anything replaces it, and it replaces nothing.
 */
export function rankOf(engine: unknown): number {
    return typeof engine === "string" && Object.prototype.hasOwnProperty.call(ENGINE_RANK, engine) ? ENGINE_RANK[engine as EngineId] : -1;
}

/** A stored entry that actually carries text to show, as opposed to a marker. */
export function isRealTranslation(
    e: StoredTranslation | undefined
): e is { lang: string; text: string; via: EngineId; same?: true } {
    return e !== undefined && "lang" in e;
}

/**
 * May `next` be written over `existing`?
 *
 * The rules, all about not taking something USEFUL away from the reader:
 *  - a lower-ranked engine never replaces a higher-ranked one;
 *  - a marker (failed/deferred/skipped) never replaces a real translation, so
 *    a ✦ retry that fails, or a forced skip, leaves the readable line in
 *    place instead of turning it into an error;
 *  - the ONE exception: an authoritative SKIP from a STRICTLY-higher-rank
 *    engine retracts a real translation. With one rank left it no longer
 *    fires, and an equal-rank skip never erases a line. A failed/deferred
 *    marker is not a decision that the line is wrong, so it never retracts.
 */
export function mayReplace(
    existing: StoredTranslation | undefined,
    next: StoredTranslation
): boolean {
    if (existing === undefined) return true;
    if (!isRealTranslation(existing)) return true;
    if (!isRealTranslation(next)) {
        // A strictly-higher-rank skip retracts the real line; every other
        // marker leaves it in place.
        if ("skipped" in next && next.skipped === true && next.via !== undefined) {
            return rankOf(next.via) > rankOf(existing.via);
        }
        // A marker never replaces a real line, except one from an engine this
        // build does not know: that line is never shown anyway.
        return rankOf(existing.via) < 0;
    }
    return rankOf(next.via) >= rankOf(existing.via);
}
