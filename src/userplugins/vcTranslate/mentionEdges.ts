/**
 * THE MENTION CASE (0.2.8): a message is judged by its own words, not by the
 * names it mentions.
 *
 * "@Danna Schmidt balhin ubos" is two words of Cebuano and a German name. Sent
 * whole, Google's language check reads the name too: it is less sure of the
 * language, so its line is held back (bias to silence) and the message waits
 * for ⚡, and the name pushes a short reply past the length that may borrow
 * its parent's language. The name itself follows the name rule instead (a
 * hover on the mention, surfaces/names.ts).
 *
 * So Google is sent the message WITHOUT the mentions at its start and end
 * ("balhin ubos"), and the mentions are put back around its answer
 * ("@Danna Schmidt move down"), exactly as they were written. Only real
 * mention tokens, never a guess about where a typed name ends, and only at
 * the edges: a mention inside a sentence is part of the sentence. The ✦ tier
 * is unchanged: the model reads the whole message with its conversation.
 *
 * Pure: no Discord, no network.
 */

/** A user, role or everyone mention, as Discord writes it in a message. */
const MENTION = String.raw`(?:<@!?\d+>|<@&\d+>|(?<![\w@.])@(?:everyone|here)\b)`;
/** Mentions at the start, with the spaces and light punctuation between and after them. */
const LEAD = new RegExp(String.raw`^\s*(?:${MENTION}[\s,:;]*)+`);
/** Mentions at the end, with the spaces and light punctuation before them. */
const TRAIL = new RegExp(String.raw`(?:[\s,]*${MENTION})+\s*$`);
/** Something to judge: a letter or a digit. */
const WORDY = /[\p{L}\p{N}]/u;

export interface EdgeMentions {
    /** The leading mentions as written (with what separates them from the words), or "". */
    lead: string;
    /** The message's own words. */
    core: string;
    /** The trailing mentions as written, or "". */
    trail: string;
}

/**
 * The message split into its edge mentions and its own words, or null when
 * there is no mention at an edge, or nothing but mentions (a bare mention is
 * nothing to translate, and is judged as before).
 */
export function splitEdgeMentions(content: unknown): EdgeMentions | null {
    if (typeof content !== "string" || content === "") return null;
    const lead = LEAD.exec(content)?.[0] ?? "";
    const rest = content.slice(lead.length);
    const trail = TRAIL.exec(rest)?.[0] ?? "";
    if (lead === "" && trail === "") return null;
    const core = rest.slice(0, rest.length - trail.length);
    if (!WORDY.test(core)) return null;
    return { lead, core: core.trim(), trail };
}

/**
 * Put the edge mentions back around a translation of the words: the readable
 * forms of the leading and trailing mentions, one space between.
 */
export function withEdgeMentions(lead: string, translation: string, trail: string): string {
    const parts = [lead.trim(), translation.trim(), trail.trim()].filter(p => p !== "");
    return parts.join(" ");
}
