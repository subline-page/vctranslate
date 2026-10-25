/**
 * 0.2.9 is AI only: "relay" (✦, Subline's own relay) is the one engine any
 * build uses. Google and the short-message judge are gone (spec decision 1).
 * The bring-your-own-key engines stay in the type only so that a line an
 * older build stored under one still reads as ✦; nothing sends to them
 * (native.ts refuses them, and the engine setting is always "relay").
 */
export type EngineId = "claude" | "gemini" | "groq" | "relay";

/**
 * The Gemini model the quality tier asks for unless the user overrides it in
 * settings (see `geminiModel` in settings.ts).
 *
 * MEASURED, not chosen from a docs page. Probed side by side against one real
 * free-tier key, same endpoint, same instant:
 *
 *   gemini-2.5-flash       200 — works
 *   gemini-3.6-flash       429 quota exceeded, at ANY rate
 *   gemini-2.5-pro         429 quota exceeded, at ANY rate
 *   gemini-2.5-flash-lite  404 no longer available
 *   gemini-3-flash         404 not found
 *   gemini-2.0-flash       500
 *
 * The previous default was `gemini-3.6-flash`, which has no free-tier
 * allowance on that key at all: it returned 429 on the FIRST request of a
 * session, so every rate-limiting mechanism in this plugin was throttling
 * against a wall that was never a rate limit, and no LLM translation ever
 * reached the screen.
 *
 * Lives here, in the module both the renderer (settings.ts) and the native
 * side (engines/gemini.ts) already import, so the setting's default and the
 * request's fallback are the same string by construction.
 *
 * WHICH MODEL IS FREE MOVES UNDER US — that table is a snapshot, not a
 * contract. That is precisely why the model is a SETTING: a user whose ✦
 * upgrades stop can change it without waiting for a rebuild.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * The Groq model the quality tier asks for unless the user overrides it in
 * settings (see `groqModel` in settings.ts).
 *
 * A SETTING FROM DAY ONE, and the reason is the paragraph above this one. The
 * plugin shipped for a week pinned to a Gemini model the key had zero quota
 * for; the symptom was a 429 on every request, which reads as throttling, and
 * the only cure was a rebuild. That is not a mistake worth making twice on a
 * new provider, so Groq's model is user-changeable before its first request
 * has ever been sent.
 *
 * `llama-3.3-70b-versatile` is Groq's general-purpose free-tier chat model at
 * the time of writing. NOT MEASURED against a live key — there is no Groq key
 * on this machine yet — which is precisely why this is a default rather than a
 * constant: WHICH MODEL IS FREE MOVES UNDER US, on this provider exactly as it
 * did on the last one, and the user must be able to move with it from the
 * settings page.
 *
 * Lives here, in the module both the renderer (settings.ts) and the native
 * side (engines/groq.ts) already import, so the setting's default and the
 * request's fallback are the same string by construction.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Models this provider has retired, and which no request can any longer reach.
 *
 * WHY A LIST AND NOT JUST A NEW DEFAULT. The model is a persisted SETTING, so a
 * new default reaches nobody who has already installed: their settings.json
 * still names the dead model, every request 404s or 400s, and the plugin falls
 * back to Google with no explanation the user could act on. Changing the
 * default alone would have fixed this for new installs only — which is the
 * smaller half of the problem.
 *
 * Groq announced Llama 3.3 70B Versatile's decommission for 2026-08-16.
 *
 * Read by `effectiveGroqModel`: a stored value on this list is treated as
 * absent, so the current default is used instead and the user's own choice of
 * any LIVE model is still respected.
 */
export const RETIRED_GROQ_MODELS: readonly string[] = [
    "llama-3.3-70b-versatile"
];

/**
 * The model a request should actually use.
 *
 * Blank falls back for the reason the old comment gave — sending `"model": ""`
 * is a 400 on every request. A RETIRED model falls back for a newer reason:
 * it is a value the user never chose so much as inherited from a default that
 * has since died, and leaving them on it means a plugin that silently stopped
 * doing the one thing they installed it for.
 */
export function effectiveGroqModel(stored?: string): string {
    const trimmed = typeof stored === "string" ? stored.trim() : "";
    if (trimmed === "") return DEFAULT_GROQ_MODEL;
    if (RETIRED_GROQ_MODELS.includes(trimmed)) return DEFAULT_GROQ_MODEL;
    return trimmed;
}

export interface PendingMessage {
    id: string;
    author: string;
    text: string;
    channelId: string;
    /** The message this one replies to, when Discord says it is a reply. */
    replyToId?: string;
    /**
     * A short clipped copy of the parent (see REPLY_PARENT_MAX in index.tsx),
     * when Discord has it. Sent to the ✦ tier so the model can read a reply
     * against what it answers even when the parent is outside the context
     * ring. The batcher drops it when the parent is in the same batch.
     */
    replyTo?: { author: string; text: string };
}

export interface BatchRequest {
    messages: {
        id: string;
        author: string;
        text: string;
        replyToId?: string;
        /** The parent's clipped copy; see PendingMessage.replyTo. */
        replyTo?: { author: string; text: string };
    }[];
    context: { author: string; text: string }[];
    targetLang: string;
    /**
     * Relay only. "preview" asks for one of the day's five ✦ (⚡) for an
     * install whose ✦ is off. "auto" was the 0.1.x free trial's automatic
     * batch; nothing sends it now, and the type keeps it only for the older
     * relay contract. Absent everywhere else.
     */
    mode?: "auto" | "preview";
    /**
     * The reader pressed ⚡ on this message: translate it, never skip. Set
     * only by forceQualityTranslate, which always sends its message alone, so
     * a forced request is never merged with an automatic batch. Survives
     * fitLlmRequest/shrinkAfterRefusal (they spread the request), so every
     * piece of a split is forced too. A relay that predates it ignores it.
     */
    force?: true;
}

// `failed` is the per-message failure variant: it lets a batch return a real
// answer for the messages that worked and an explicit marker for the ones that
// did not, instead of the whole batch being all-or-nothing (or, worse, a
// message silently vanishing from the results with no marker at all — the
// renderer would then show nothing forever and re-request it on every open).
// It mirrors `StoredTranslation`'s `{ failed: true }` shape in store.ts.
export type Result =
    // `truncated` is set only by the relay's preview mode: the text is the
    // first few words of the ✦ translation, not all of it, and must never be
    // stored or shown as a full translation.
    | { id: string; lang: string; text: string; skip: false; truncated?: boolean }
    // The engine decided this text needs no translation.
    | { id: string; skip: true }
    // `transport` marks a failure that never REACHED a verdict: a 429 that
    // survived the retry, a 5xx, a network drop, for THIS message while its
    // batch-mates went through. It is a fact about the moment, not the
    // message, and runTier renders it as "waiting" rather than "failed" —
    // the same transport-vs-verdict split the batch level already has.
    | { id: string; failed: true; transport?: true };

/**
 * What each engine can do, and — via `hasOwnProperty` in store.ts's
 * isKnownEngine — the single runtime list of which engine ids exist at all.
 *
 * `supportsContext` is READ, by rebuildBatcher() in index.tsx. That matters:
 * a capability table nothing consults is a comment pretending to be code.
 */
export const ENGINE_CAPS: Record<EngineId, { supportsContext: boolean }> = {
    // Subline relay: LLM-backed, so it wants conversation context like the
    // keyed engines. Its key is a code and its endpoint is the relay, but from
    // the batcher's point of view it is a context-aware quality engine.
    relay: { supportsContext: true },
    claude: { supportsContext: true },
    gemini: { supportsContext: true },
    groq: { supportsContext: true }
};

/**
 * True when a translation is indistinguishable from its source, so there is
 * nothing worth rendering. Engines pass text through unchanged when they
 * misdetect the language, and the detected-language check cannot catch
 * that, because the bogus detection is not the target language either.
 *
 * Compares case-insensitively with whitespace collapsed, so a translation
 * differing only in spacing or capitalisation still counts as no translation.
 */
export function isSameText(a: string, b: string): boolean {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    return norm(a) === norm(b);
}

/**
 * The ✦ tier's grouping window (0.2.9, spec decision 7): a live message waits
 * at most this long, so a burst of quick lines leaves as one request of up to
 * QUALITY_MAX_BATCH messages.
 *
 * 3s (was 1.5s while Google put a ≈ line on screen first). With ✦ the only
 * engine the reader waits for this window, so it stays short; it is a fixed
 * window from the FIRST message, so a busy channel flushes at most every 3s,
 * sooner at the 25-message cap. Catch-up bypasses it entirely (flushNow)
 * because a backlog is already complete when it is queued. The request
 * ceiling itself is the relay's (per-code rate limit, the hidden daily
 * ceiling) and the client's rate gate, not this window.
 */
export const QUALITY_DEBOUNCE_MS = 3_000;
export const QUALITY_MAX_BATCH = 25;
