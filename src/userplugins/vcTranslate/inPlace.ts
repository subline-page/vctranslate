/**
 * A LONG MESSAGE, TRANSLATED IN PLACE (owner, 0.2.11).
 *
 * A message of at most SWAP_MAX_CHARS characters and SWAP_MAX_LINES lines
 * keeps its translation UNDER it, as before. A longer one would show the
 * long original and a long italic translation: too much text. So its
 * translation takes the original's place, in normal message text, with a
 * small marker after it like Discord's "(edited)": "✦ Turkish · Show
 * original". A click shows Discord's original again ("✦ Show translation"
 * under it); the choice is kept per message for the session.
 *
 * HOW (index.tsx InPlaceAccessory). No webpack patch. A message accessory
 * placed FIRST among the message's accessories (above images, embeds and
 * reactions, where the text was) draws the translation, and a <style> drawn
 * inside that same accessory hides Discord's own text element for that one
 * message (swapCss). Discord renders the text as `#message-content-<id>`
 * inside the message's `[role="article"]`, next to the accessories (checked
 * in Discord's bundle, 2026-11-05). FAIL SAFE BY CONSTRUCTION: the rule only
 * exists while the accessory that draws the translation is on screen, and it
 * only matches an article that contains that accessory. Anything that stops
 * the accessory (a crash, the plugin stopping, the message changing) takes
 * the rule with it, and Discord's original shows. A second rule hides the
 * translation in an article that has no text element of Discord's (the
 * reader editing their own message): never two texts, never none. A
 * browser without `:has()` gets no swap at all (canSwap).
 *
 * Pure logic only: the threshold, the CSS, the per-message choice.
 */

/** Longer than this many characters (as the reader sees them) is swapped. */
export const SWAP_MAX_CHARS = 280;
/** More lines than this is swapped. */
export const SWAP_MAX_LINES = 4;

/** Discord's tokens that draw as one thing: a custom emoji, a mention, a channel, a role, a timestamp, a command. */
const DISCORD_TOKEN = /<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|<t:-?\d+(?::[tTdDfFR])?>|<\/[^\s<>:]+(?: [^\s<>:]+)*:\d+>/g;

/** How long a text reads: characters (code points), with each Discord token counted as one. */
export function visibleLength(content: string): number {
    return [...content.trim().replace(DISCORD_TOKEN, "x")].length;
}

/** Lines as written: one more than the line breaks, 0 for nothing. */
export function lineCount(content: string): number {
    const t = content.replace(/\r\n?/g, "\n").trim();
    return t === "" ? 0 : t.split("\n").length;
}

/** Over 280 characters or over 4 lines: the translation takes the original's place. */
export function isLongOriginal(content: unknown): boolean {
    if (typeof content !== "string") return false;
    if (lineCount(content) > SWAP_MAX_LINES) return true;
    // Every message on screen asks: a text no longer than 280 UTF-16 units is
    // never over 280 characters, so most never get counted.
    if (content.length <= SWAP_MAX_CHARS) return false;
    return visibleLength(content) > SWAP_MAX_CHARS;
}

/** The ``` fences in a text. */
function fences(text: string): number {
    return (text.match(/```/g) ?? []).length;
}

/**
 * Did the translation keep the original's code blocks? Same number of ```
 * fences. A translation that lost or broke one is never swapped in: code
 * would read as prose (it is shown under the original instead, as before).
 */
export function keepsCodeBlocks(original: string, translation: string): boolean {
    return fences(original) === fences(translation);
}

/* ------------------------------------ nothing of the original is lost -- */

/*
 * A SWAPPED TEXT NEVER DROPS CONTENT (0.2.11 review). The translation stands
 * in for the original, so whatever the original shows must be in it too.
 * Custom emoji are never sent to a translator (customEmoji.ts): they are put
 * back where they stood, at the start or the end of their line, or on a line
 * of their own (placeCustomEmoji). An emoji in the middle of a line has no
 * sure place in a translated sentence: that message is not swapped. Then
 * everything else Discord draws on its own is checked (keepsContent):
 * mentions, channels, roles, timestamps, commands, links (masked ones too),
 * @everyone and @here, spoilers, inline code, headings, subtext, quotes and
 * lists. One missing: no swap, the translation stays under the original (as
 * before), where the original is still there to read. No extra request
 * either way.
 */

const CUSTOM_EMOJI = /<a?:\w+:\d+>/;
const CUSTOM_EMOJI_G = /<a?:\w+:\d+>/g;
const LEAD_EMOJI = /^\s*(?:<a?:\w+:\d+>\s*)+/;
const TRAIL_EMOJI = /(?:\s*<a?:\w+:\d+>)+\s*$/;

type LinePlan = { kind: "blank"; } | { kind: "verbatim"; line: string; } | { kind: "text"; lead: string; trail: string; };

/**
 * The translation with the original's custom emoji put back, or null when
 * they cannot be put back for sure. The translator saw each line without its
 * emoji (an emoji-only line as an empty one), so the original's lines with
 * words pair, in order, with the translation's non-empty lines: a different
 * number of them is null. A text without custom emoji comes back unchanged.
 */
export function placeCustomEmoji(source: string, translation: string): string | null {
    if (!CUSTOM_EMOJI.test(source)) return translation;
    const plan: LinePlan[] = [];
    for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
        if (!CUSTOM_EMOJI.test(line)) {
            plan.push(line.trim() === "" ? { kind: "blank" } : { kind: "text", lead: "", trail: "" });
            continue;
        }
        if (line.replace(CUSTOM_EMOJI_G, "").trim() === "") {
            plan.push({ kind: "verbatim", line: line.trim() });
            continue;
        }
        const lead = LEAD_EMOJI.exec(line)?.[0] ?? "";
        const rest = line.slice(lead.length);
        const trail = TRAIL_EMOJI.exec(rest)?.[0] ?? "";
        // An emoji between words: no sure place for it in the translated sentence.
        if (CUSTOM_EMOJI.test(rest.slice(0, rest.length - trail.length))) return null;
        plan.push({ kind: "text", lead: lead.trimStart(), trail: trail.trimEnd() });
    }
    const lines = translation.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
    if (lines.length !== plan.filter(p => p.kind === "text").length) return null;
    let i = 0;
    const out = plan.map(p => {
        if (p.kind === "blank") return "";
        if (p.kind === "verbatim") return p.line;
        let t = lines[i++]!;
        if (p.lead !== "") t = t.trimStart();
        if (p.trail !== "") t = t.trimEnd();
        return p.lead + t + p.trail;
    });
    return out.join("\n").replace(/^\n+|\n+$/g, "");
}

/** How many times each match of `re` (global) is in `text`. */
function tally(text: string, re: RegExp): Map<string, number> {
    const m = new Map<string, number>();
    for (const x of text.match(re) ?? []) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
}

/** Discord's bracketed tokens other than custom emoji: <@id>, <#id>, <@&id>, <t:…>, </cmd:id>, <https://…>. */
const BRACKETED = /<[^\s<>]+>/g;
/** A link, as Discord draws it (a masked link's address too); trailing sentence punctuation is not part of it. */
const LINK = /https?:\/\/[^\s<>()[\]]+/g;
const LINK_TAIL = /[.,!?;:'"]+$/;

/** What a line starts with that Discord draws: a heading, subtext, a quote, a list item. Null for plain text. */
function lineMark(line: string): string | null {
    const t = line.trimStart();
    if (/^-#\s/.test(t)) return "subtext";
    const h = /^(#{1,3})\s/.exec(t);
    if (h) return `h${h[1]!.length}`;
    if (/^>>>(?:\s|$)/.test(t)) return "quote-rest";
    if (/^>(?:\s|$)/.test(t)) return "quote";
    if (/^[-*+]\s/.test(t)) return "list";
    if (/^\d+[.)]\s/.test(t)) return "numbered";
    return null;
}

/** A text's line marks, counted; lines inside code blocks left out (Discord draws them as code). */
function lineMarks(text: string): Map<string, number> {
    const m = new Map<string, number>();
    let inCode = false;
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
        if (!inCode) {
            const k = lineMark(line);
            if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
        }
        if ((line.match(/```/g) ?? []).length % 2 === 1) inCode = !inCode;
    }
    return m;
}

function sameTally(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [k, n] of a) if (b.get(k) !== n) return false;
    return true;
}

function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

/**
 * Does `shown` (the translation as it would be drawn, Discord's tokens put
 * back) keep everything of `source` (the original as Discord has it) that is
 * not words? The list is in this section's header. Pure.
 */
export function keepsContent(source: string, shown: string): boolean {
    // Custom emoji: exactly the same ones, as many times.
    if (!sameTally(tally(source, CUSTOM_EMOJI_G), tally(shown, CUSTOM_EMOJI_G))) return false;
    // Mentions, channels, roles, timestamps, commands, suppressed links: each one still there.
    const shownTokens = tally(shown, BRACKETED);
    for (const token of tally(source, BRACKETED).keys()) {
        if (CUSTOM_EMOJI.test(token)) continue;
        if (!shownTokens.has(token)) return false;
    }
    // Links, bare or masked: each address still there.
    for (const raw of source.match(LINK) ?? []) {
        const url = raw.replace(LINK_TAIL, "");
        if (url !== "" && !shown.includes(url)) return false;
    }
    for (const ping of ["@everyone", "@here"]) {
        if (source.includes(ping) && !shown.includes(ping)) return false;
    }
    // Spoilers (a lost one shows what the writer hid) and inline code: the same marks.
    if (occurrences(source, "||") !== occurrences(shown, "||")) return false;
    if (occurrences(source, "`") !== occurrences(shown, "`")) return false;
    // Headings, subtext, quotes, lists.
    return sameTally(lineMarks(source), lineMarks(shown));
}

/**
 * The text to draw in the original's place, or null: not swapped. `shown` is
 * the cleaned translation with mentions turned back into Discord's tokens.
 */
export function carryThrough(source: string, shown: string): string | null {
    if (typeof source !== "string" || typeof shown !== "string" || shown.trim() === "") return null;
    const placed = placeCustomEmoji(source, shown);
    if (placed === null || placed.trim() === "") return null;
    if (!keepsCodeBlocks(source, placed) || !keepsContent(source, placed)) return null;
    return placed;
}

/** A Discord id: digits only. Anything else never reaches a CSS rule. */
const SNOWFLAKE = /^\d{1,25}$/;

export function isSnowflake(id: unknown): id is string {
    return typeof id === "string" && SNOWFLAKE.test(id);
}

/** The attribute on the accessory's own element that the rules look for. */
export const SWAP_ATTR = "data-subline-swap";

/**
 * The two rules for one message, or null for an id that is not a Discord id:
 *  1. in the article that holds THIS accessory, Discord's text element of
 *     this message is hidden;
 *  2. in an article that has no text element of this message (Discord shows
 *     its edit box instead), the accessory's text is hidden.
 */
export function swapCss(messageId: string): string | null {
    if (!isSnowflake(messageId)) return null;
    const original = `[id="message-content-${messageId}"]`;
    const mine = `[${SWAP_ATTR}="${messageId}"]`;
    return `[role="article"]:has(${mine}) ${original}{display:none !important}`
        + `[role="article"]:not(:has(${original})) ${mine}{display:none !important}`;
}

let swapCheckedFor: unknown = null;
let swapSupported = false;

/**
 * Can this browser hide by `:has()`? No: nothing is swapped, the translation
 * stays under the original. Asked of the browser once (every message on
 * screen asks), again only if its CSS object is another.
 */
export function canSwap(): boolean {
    try {
        const css = (globalThis as { CSS?: { supports?(q: string): boolean; }; }).CSS;
        if (typeof css?.supports !== "function") return false;
        if (swapCheckedFor === css) return swapSupported;
        swapSupported = css.supports("selector(:has(a))") === true && css.supports("selector(:not(:has(a)))") === true;
        swapCheckedFor = css;
        return swapSupported;
    } catch {
        return false;
    }
}

/* -------------------------------------------- the reader's choice, per message -- */

const showingOriginal = new Set<string>();
const listeners = new Set<() => void>();
/** Message id -> what redraws when Discord updates that message (an edit). */
const editListeners = new Map<string, Set<() => void>>();

function notify(set: Iterable<() => void>): void {
    for (const fn of [...set]) {
        try { fn(); } catch { /* a listener's own trouble */ }
    }
}

/** Did the reader ask for Discord's original of this message ("Show original")? */
export function isShowingOriginal(messageId: string): boolean {
    return showingOriginal.has(messageId);
}

/** "Show original" / "Show translation". */
export function toggleOriginal(messageId: string): void {
    if (showingOriginal.has(messageId)) showingOriginal.delete(messageId);
    else showingOriginal.add(messageId);
    notify(listeners);
}

export function subscribeSwap(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * Discord updated this message (MESSAGE_UPDATE). Discord's accessories do
 * not redraw for a new text, so an in-place text is redrawn from here.
 */
export function noteMessageEdited(messageId: unknown): void {
    if (typeof messageId !== "string") return;
    const set = editListeners.get(messageId);
    if (set) notify(set);
}

export function subscribeMessageEdit(messageId: string, fn: () => void): () => void {
    let set = editListeners.get(messageId);
    if (!set) editListeners.set(messageId, set = new Set());
    set.add(fn);
    return () => {
        const s = editListeners.get(messageId);
        if (!s) return;
        s.delete(fn);
        if (s.size === 0) editListeners.delete(messageId);
    };
}

/** Redraw every in-place text and line (stop(): they draw nothing once the plugin is off). */
export function redrawSwaps(): void {
    notify(listeners);
    for (const set of [...editListeners.values()]) notify(set);
}

/** Tests and stop(). */
export function __resetSwap(): void {
    swapCheckedFor = null;
    swapSupported = false;
    showingOriginal.clear();
    listeners.clear();
    editListeners.clear();
}
