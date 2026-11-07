/**
 * THE LINK LINE UNDER A MESSAGE (0.2.11).
 *
 * While this Discord account is not linked, nothing translates, and the
 * Link bar (a Vencord notice) was the only way to be asked. A bar can be
 * closed, missed, or broken by a Discord update. So the newest message in
 * the open channel that Subline would translate also carries one small line:
 * "Link your Discord account to translate · Link".
 *
 * WHICH MESSAGE. At most LINK_HINT_MAX (one) per channel: the newest message
 * that is not the reader's own and that the local, free checks (skip.ts,
 * detectLang.ts, the same ones enqueue() uses) do not rule out. Nothing goes
 * to the relay for this: no request, no status call. Only the newest
 * LINK_HINT_SCAN loaded messages are looked at, so a long channel in the
 * reader's own language costs a bounded amount of local work.
 */

/** How many messages in one channel carry the line at most. */
export const LINK_HINT_MAX = 1;

/** How many of the newest loaded messages are looked at. */
export const LINK_HINT_SCAN = 50;

/** The parts of a Discord message this reads. Anything else is ignored. */
interface MessageLike {
    id?: unknown;
    content?: unknown;
    author?: { id?: unknown; } | null;
}

/**
 * The ids (newest first) of the messages that carry the line. `messages` is
 * oldest first, as MessageStore gives them. `wouldTranslate` is the local
 * check for a message that is not the reader's own; it must not throw, but
 * a throw counts as "no" for that message.
 */
export function pickLinkHintIds(
    messages: readonly unknown[],
    meId: string | undefined,
    wouldTranslate: (text: string) => boolean,
    max: number = LINK_HINT_MAX,
    scan: number = LINK_HINT_SCAN
): string[] {
    const out: string[] = [];
    if (!Array.isArray(messages) || max <= 0) return out;
    const stop = Math.max(0, messages.length - scan);
    for (let i = messages.length - 1; i >= stop && out.length < max; i--) {
        const m = messages[i] as MessageLike | null | undefined;
        if (m == null || typeof m.id !== "string" || m.id === "") continue;
        if (typeof m.content !== "string" || m.content.trim() === "") continue;
        const author = m.author?.id;
        // Never the reader's own; and with no reader known, nobody's.
        if (typeof meId !== "string" || meId === "" || author === meId) continue;
        let yes = false;
        try {
            yes = wouldTranslate(m.content);
        } catch {
            yes = false;
        }
        if (yes) out.push(m.id);
    }
    return out;
}

/**
 * One Link per press. A second press within `gapMs` (a double click), or
 * any press while `busy()` says a link is already running, does nothing.
 * Returns whether `run` was called.
 */
export function createClickGuard(gapMs: number, now: () => number = Date.now) {
    let last = -Infinity;
    return (busy: () => boolean, run: () => void): boolean => {
        if (busy()) return false;
        const t = now();
        if (t - last < gapMs) return false;
        last = t;
        run();
        return true;
    };
}
