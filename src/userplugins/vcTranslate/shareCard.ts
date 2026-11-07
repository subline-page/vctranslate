import { renderDiscordMarkup, type MarkupResolvers } from "./discordMarkup";
import { cleanText } from "./feedback";
import { languageLabel } from "./langLabel";
import { SHARE_COPY } from "./upgradeCopy";

/**
 * THE "SHARE TRANSLATION" IMAGE, as data (shareRender.ts draws it). Pure: no
 * Discord, no DOM, no network, so every leak it must not have is tested.
 *
 * One message and the translation the reader saw, WITHOUT who wrote it or
 * where: the author is "Someone" with a plain grey circle (Discord's avatar
 * is never drawn), every user and role mention is "@someone", every channel
 * "#channel", a custom emoji its ":name:", a link "[link]", a spoiler's
 * hidden text "▇▇▇" (in the translation too: one that lost the spoiler
 * marks is hidden whole), and no id of any kind survives (no run of 17 or more digits, whatever the text held). The
 * server, the channel, attachments, embeds and the reply preview are not
 * part of the input at all.
 *
 * The translation already holds the resolved names (discordMarkup.ts turns
 * "<@id>" into "@deniz" before translating), so the names this message's
 * mentions resolve to, and the author's own names, are replaced there too.
 * A name typed as plain text that is not one of those stays, and so does a
 * channel name typed as "#general": the preview before copying is the guard
 * for that, and its subtitle says so (SHARE_COPY.subtitle).
 *
 * The brand rides here, in the footer, never on the lines in Discord.
 */

export interface ShareInput {
    /** The message's own raw content (Discord markup and all). */
    original: string;
    /** The translation the reader saw. */
    translation: string;
    /** The detected source language, when known. */
    sourceLang?: string;
    /** The reading language. */
    targetLang: string;
    /** The live lookups (index.tsx markupResolversFor), used only to learn which names to remove. */
    resolvers: MarkupResolvers;
    /** The author's names (username, display name, nickname) and the names of mentioned users. */
    names: readonly string[];
}

export interface ShareCard {
    author: string;
    original: string;
    translation: string;
    originalRtl: boolean;
    translationRtl: boolean;
    /** "Japanese → English", or "English" when the source is not known. */
    languages: string;
    footer: string;
}

/** The longest text a block keeps before it is laid out (the layout caps lines too). */
export const MAX_SHARE_TEXT_CHARS = 1_200;
/** The most lines one block shows; the last then ends in "…". */
export const MAX_BLOCK_LINES = 12;

const MENTION = SHARE_COPY.mention;
/** A spoiler, marks and all: the shortest span between two "||". */
const SPOILER = /\|\|[\s\S]*?\|\|/g;

/** How many spoilers `text` holds. */
const spoilerCount = (text: string): number => typeof text === "string" ? (text.match(SPOILER) ?? []).length : 0;
const SOMEONE_WORD = MENTION.slice(1);

/** Scripts written without spaces: a name in them is matched without word edges. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names this message's markup resolves to, by kind, read through `resolvers` without changing anything. */
export function resolvedNames(content: string, resolvers: MarkupResolvers): { users: string[]; roles: string[]; channels: string[]; } {
    const users: string[] = [];
    const roles: string[] = [];
    const channels: string[] = [];
    const keep = (list: string[], fn: (id: string) => string | undefined) => (id: string) => {
        let name: string | undefined;
        try { name = fn(id); } catch { name = undefined; }
        if (typeof name === "string" && name.trim() !== "") list.push(name.trim());
        return name;
    };
    try {
        renderDiscordMarkup(content, {
            user: keep(users, id => resolvers.user(id)),
            role: keep(roles, id => resolvers.role(id)),
            channel: keep(channels, id => resolvers.channel(id))
        });
    } catch { /* no names learned: the markup itself is still replaced below */ }
    return { users, roles, channels };
}

/** `text` with every "@name", "#name" (and, for people, the bare name) replaced. */
function withoutNames(text: string, people: readonly string[], channels: readonly string[]): string {
    let out = text;
    const byLength = (list: readonly string[]) => [...new Set(list.map(n => n.trim()).filter(n => n.length >= 2))].sort((a, b) => b.length - a.length);
    for (const name of byLength(channels)) out = out.replace(new RegExp(`#${escapeRe(name)}`, "giu"), SHARE_COPY.channel);
    for (const name of byLength(people)) {
        const e = escapeRe(name);
        out = out.replace(new RegExp(`@${e}`, "giu"), MENTION);
        // A bare name only as a whole word, except in a script without spaces.
        const bare = NO_SPACE_SCRIPT.test(name)
            ? new RegExp(e, "giu")
            : new RegExp(`(?<![\\p{L}\\p{N}_@#])${e}(?![\\p{L}\\p{N}_])`, "giu");
        out = out.replace(bare, SOMEONE_WORD);
    }
    return out;
}

/**
 * One text for the card: Discord's markup out, names out, links out, ids out,
 * formatting marks out, control characters out, capped. Never throws.
 */
export function anonymize(text: string, people: readonly string[] = [], channels: readonly string[] = []): string {
    if (typeof text !== "string") return "";
    let s = cleanText(text).slice(0, MAX_SHARE_TEXT_CHARS * 2);
    s = s
        // Hidden text stays hidden: first, before any rule below could split a spoiler.
        .replace(SPOILER, SHARE_COPY.spoiler)
        .replace(/<a?:(\w{1,32}):\d+>/g, ":$1:")
        .replace(/<@&\d+>/g, MENTION)
        .replace(/<@!?\d+>/g, MENTION)
        .replace(/<#\d+>/g, SHARE_COPY.channel)
        .replace(/<t:-?\d+(?::[tTdDfFR])?>/g, "")
        .replace(/<\/([\w -]{1,64}):\d+>/g, "/$1")
        .replace(/@(everyone|here)\b/g, MENTION)
        // Links before names: an invite or a message link names the server.
        .replace(/<?\bhttps?:\/\/[^\s>]+>?/gi, SHARE_COPY.link)
        .replace(/\b(?:discord(?:app)?\.(?:gg|com|io|me)|dsc\.gg)\/[^\s]+/gi, SHARE_COPY.link);
    s = withoutNames(s, people, channels);
    s = s
        // Formatting marks out (the words stay), code fences included.
        .replace(/```[\w-]*\n?/g, "")
        .replace(/\*\*|__|~~|\|\||`/g, "")
        // Whatever the text held, no id-length number survives.
        .replace(/\d{17,}/g, "…")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (s.length > MAX_SHARE_TEXT_CHARS) s = Array.from(s).slice(0, MAX_SHARE_TEXT_CHARS).join("").trimEnd() + "…";
    return s;
}

/** Right to left when the first letter with a direction is Hebrew, Arabic or the like. */
export function isRtlText(text: string): boolean {
    for (const ch of text) {
        if (/[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch)) return true;
        if (/\p{L}/u.test(ch)) return false;
    }
    return false;
}

/** "Japanese", or null for a code the runtime cannot name. */
function englishName(code: string | undefined): string | null {
    // "und", "zxx" and the like name no language (langLabel.ts).
    const c = languageLabel(code);
    if (c === null) return null;
    try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(c) ?? null;
    } catch {
        return null;
    }
}

/** The card, or null when nothing would be left to show. Never throws. */
export function shareCard(input: ShareInput): ShareCard | null {
    try {
        const found = resolvedNames(input.original, input.resolvers);
        const people = [...input.names.filter((n): n is string => typeof n === "string"), ...found.users, ...found.roles];
        const original = anonymize(input.original, people, found.channels);
        // A translation with fewer spoilers than the message lost some marks:
        // its hidden words may be in the clear, so none of it shows.
        const translation = spoilerCount(input.translation) < spoilerCount(input.original)
            ? SHARE_COPY.spoiler
            : anonymize(input.translation, people, found.channels);
        if (original === "" || translation === "") return null;
        const from = englishName(input.sourceLang);
        const to = englishName(input.targetLang);
        const languages = from !== null && to !== null && from !== to ? `${from} → ${to}` : to ?? "";
        return {
            author: SHARE_COPY.someone,
            original,
            translation,
            originalRtl: isRtlText(original),
            translationRtl: isRtlText(translation),
            languages,
            footer: SHARE_COPY.footer
        };
    } catch {
        return null;
    }
}

/* -------------------------------------------------------------- layout -- */

function segments(text: string, granularity: "word" | "grapheme"): string[] {
    try {
        const Seg = (Intl as any).Segmenter;
        if (typeof Seg === "function") return Array.from(new Seg(undefined, { granularity }).segment(text), (s: any) => s.segment as string);
    } catch { /* below */ }
    return granularity === "word" ? text.split(/(\s+)/).filter(s => s !== "") : Array.from(text);
}

/**
 * `text` broken into lines no wider than `maxWidth` by `measure`, at most
 * `maxLines`, the last ending in "…" when it was cut. Words break at word
 * edges (Intl.Segmenter, which also splits Japanese and Chinese into words);
 * a word wider than a line breaks between characters, never inside one
 * (an emoji or an accented letter stays whole). A "\n" starts a new line.
 * A measure that throws or answers nonsense counts each character as wide.
 */
export function layoutLines(text: string, measure: (s: string) => number, maxWidth: number, maxLines: number = MAX_BLOCK_LINES): string[] {
    const width = (s: string): number => {
        let w: number;
        try { w = measure(s); } catch { w = Number.NaN; }
        return Number.isFinite(w) && w >= 0 ? w : s.length * maxWidth;
    };
    const out: string[] = [];
    const full = () => out.length > maxLines;
    const push = (line: string) => out.push(line.replace(/\s+$/u, ""));
    for (const para of String(text ?? "").split("\n")) {
        if (full()) break;
        let line = "";
        for (const tok of segments(para, "word")) {
            if (full()) break;
            if (width(line + tok) <= maxWidth) {
                line += tok;
                continue;
            }
            // A space that does not fit ends the line and is dropped.
            if (/^\s+$/u.test(tok)) {
                push(line);
                line = "";
                continue;
            }
            if (line.trim() !== "") push(line);
            line = "";
            if (width(tok) <= maxWidth) {
                line = tok;
                continue;
            }
            for (const g of segments(tok, "grapheme")) {
                if (line !== "" && width(line + g) > maxWidth) {
                    push(line);
                    line = "";
                    if (full()) break;
                }
                line += g;
            }
        }
        if (!full()) push(line);
    }
    if (out.length <= maxLines) return out;
    const kept = out.slice(0, maxLines);
    let last = Array.from(kept[maxLines - 1]!);
    while (last.length > 0 && width(last.join("") + "…") > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.join("").trimEnd() + "…";
    return kept;
}
