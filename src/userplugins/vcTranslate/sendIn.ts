import * as DataStore from "@api/DataStore";

import { normalizeTargetLang } from "./languages";

/**
 * "SEND IN [LANGUAGE]" (0.2.11). Per channel, the reader can have what they
 * type translated before it is sent. ONE Enter:
 *
 *   1. They type in their own language and press Enter.
 *   2. The message box empties at once; a status line says "Sending in
 *      Burmese…". They can type the next message meanwhile.
 *   3. The translation is sent as the message, with the reply, to the
 *      channel it was typed in. Under it, only they see "You wrote: …".
 *
 * This module is the decision logic (SendInQueue), the panel's language list
 * and the per-channel memory, with every contact to Discord and the relay
 * handed in (SendInDeps), so the rules can be tested without a client.
 * index.tsx wires it to Vencord's pre-send hook and Discord's message box.
 *
 * TWO WAYS A MESSAGE GOES OUT (index.tsx sendInPreSend says why):
 *  - "queue" (text, with or without a reply): the hook cancels Discord's
 *    send, the box is emptied by Subline, and the translation is sent by
 *    Subline to the channel the Enter came from, with Discord's own send
 *    options from that Enter (the reply).
 *  - "inPlace" (files, stickers, a forward, @silent): Discord's own send is
 *    held in the hook while the text is translated, and the translation is
 *    put in the message Discord then sends, so its own upload path sends the
 *    files. The box waits for this one message.
 *
 * THE INVARIANTS (worst cases first):
 *  - Nothing untranslated is sent while Send in is on, except text with
 *    nothing to translate (a slash command, an empty message, only mentions,
 *    emoji, links or code), text the relay gives back as it is, what the
 *    reader chose to send as written, and, once the reader was told and the
 *    label is grey, messages while Send in cannot translate (the day's
 *    limit, the AI pause, no AI).
 *  - Any failure (relay down, refused, the daily limit, a timeout, an empty
 *    answer, a mention or link the model dropped) sends NOTHING. The text is
 *    kept: offered back with "Try again" and "Send as written" (queue), or
 *    left in the box with its files (inPlace). Never lost, whatever the
 *    reader types meanwhile.
 *  - Messages of one channel go out in the order they were typed: a message
 *    waits for every earlier one of its channel to be sent or kept, and a
 *    message typed while an earlier one was on its way and then kept is kept
 *    behind it (so "Try again" / "Send as written" cannot put it after a
 *    later one). A message typed once "Not sent" is on screen goes normally.
 *  - Nothing longer than Discord takes (2000, or 4000 with Nitro) is sent: a
 *    translation that grew past it is kept like any failure.
 *  - "@silent" stays Discord's word: it is taken off before translating and
 *    put back in front, so Discord still sends the message silently.
 *  - A message goes only to the channel it was typed in.
 *  - One request per message, none for a text translated before (cache).
 */

/* ------------------------------------------------------- protected tokens -- */

/**
 * What the model must never touch: code blocks, inline code, anything in
 * angle brackets with no spaces (Discord's <@id>, <@!id>, <@&id>, <#id>,
 * <:name:id>, <a:name:id>, <t:123:R>, </command:id>, <https://suppressed>),
 * bare links, @everyone/@here, and a literal "{n}" the reader typed (it is
 * the placeholder shape, so it is protected like the rest and comes back as
 * written). Earlier alternatives win: a link inside code stays code.
 */
const PROTECTED = new RegExp([
    "```[\\s\\S]*?```",
    "``[^`]+?``",
    "`[^`\\n]+`",
    "<[^\\s<>]+>",
    "https?:\\/\\/(?:[^\\s<>()]|\\([^\\s<>()]*\\))+",
    "@(?:everyone|here)\\b",
    "\\{\\d+\\}"
].join("|"), "g");

/** Trailing punctuation that ends a sentence, not a link. */
const LINK_TAIL = /[.,!?;:'"]+$/;

export interface Protected {
    /** The text with each protected token replaced by {0}, {1}, ... in order. */
    masked: string;
    /** The tokens, by placeholder number. */
    tokens: string[];
}

export function protectTokens(text: string): Protected {
    const tokens: string[] = [];
    const masked = text.replace(PROTECTED, (match: string) => {
        let token = match;
        let tail = "";
        if (/^https?:/.test(match)) {
            const m = LINK_TAIL.exec(match);
            if (m) { token = match.slice(0, m.index); tail = m[0]; }
        }
        tokens.push(token);
        return `{${tokens.length - 1}}${tail}`;
    });
    return { masked, tokens };
}

/**
 * Put the tokens back. Null unless every placeholder came back exactly once
 * and no other placeholder appeared: a dropped or doubled mention, link or
 * code block is never sent (the reader's text is kept instead).
 */
export function restoreTokens(translated: string, tokens: readonly string[]): string | null {
    const seen = new Array<number>(tokens.length).fill(0);
    let bad = false;
    const out = translated.replace(/\{(\d+)\}/g, (_m, n: string) => {
        const i = Number(n);
        if (!Number.isInteger(i) || i >= tokens.length) { bad = true; return ""; }
        seen[i]! += 1;
        return tokens[i]!;
    });
    if (bad || seen.some(c => c !== 1)) return null;
    return out;
}

/** Anything that pings or points at someone: @everyone, @here, user, role and channel mentions. */
const PING = /@(?:everyone|here)\b|<@[!&]?\d+>|<#\d+>/g;

/**
 * True when the translation pings someone the reader's text did not: the
 * model added "@everyone", "@here" or a raw mention. Such a translation is
 * never sent (the reader's text is kept instead).
 */
export function addsPings(original: string, translated: string): boolean {
    const count = (t: string) => {
        const m = new Map<string, number>();
        for (const x of t.match(PING) ?? []) m.set(x, (m.get(x) ?? 0) + 1);
        return m;
    };
    const before = count(original);
    for (const [k, n] of count(translated)) if (n > (before.get(k) ?? 0)) return true;
    return false;
}

/**
 * Whether there is anything to translate once protected tokens, emoji,
 * digits and punctuation are gone: at least one letter.
 */
export function hasTranslatableText(text: string): boolean {
    return /\p{L}/u.test(protectTokens(text).masked.replace(/\{\d+\}/g, " "));
}

/** Text compared as Discord sends it: trimmed, line endings and runs of spaces made one. */
export function normalizeForCompare(text: string): string {
    return text.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").trim();
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
/** What the box draws differently from the sent form: Discord's tokens (mentions, channels, roles, custom emoji, timestamps, commands), emoji shortcodes, emoji characters. */
const DRAWN_DIFFERENTLY = /<(?:@[!&]?\d+|#\d+|a?:[\w~-]+:\d+|t:-?\d+(?::[a-zA-Z])?|id:[\w-]+|\/[^<>\n]+:\d+)>|:[\w~+-]+:|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u20E3]+/gu;

/** The longest a piece is drawn in the box: "@" or "#" and a role or channel name (up to 100). */
const DRAWN_PIECE_MAX = 101;
/** How a piece drawn differently starts in the box: a mention or channel, a shortcode, a raw token, a command, an emoji. */
const DRAWN_PIECE_START = /^[@#:<\/\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

/**
 * A message as the parts any form of it shares: the text between the pieces
 * the box draws differently (DRAWN_DIFFERENTLY: `<@123>` is drawn `@deniz`,
 * an emoji as a picture), with all white space gone (the box draws each line
 * as its own block, so its text has no line breaks). `gaps[i]`: how many such
 * pieces come before `parts[i]`; the last entry, after the last part.
 */
interface BoxShape { parts: string[]; gaps: number[]; }

function boxParts(text: string): BoxShape {
    const clean = text.replace(ZERO_WIDTH, "");
    const parts: string[] = [];
    const gaps: number[] = [0];
    let last = 0;
    for (const m of clean.matchAll(DRAWN_DIFFERENTLY)) {
        const lit = clean.slice(last, m.index).replace(/\s+/g, "");
        if (lit !== "") {
            parts.push(lit);
            gaps.push(0);
        }
        gaps[gaps.length - 1] = gaps[gaps.length - 1]! + 1;
        last = (m.index ?? 0) + m[0].length;
    }
    const tail = clean.slice(last).replace(/\s+/g, "");
    if (tail !== "") {
        parts.push(tail);
        gaps.push(0);
    }
    return { parts, gaps };
}

/** Whether `g`, seen where the message has `pieces` pieces drawn differently, can be their drawing. */
function gapFits(g: string, pieces: number): boolean {
    if (g === "") return true;
    if (pieces === 0 || g.length > DRAWN_PIECE_MAX * pieces) return false;
    return DRAWN_PIECE_START.test(g);
}

/**
 * Whether `seen` (a box's drawn text, or the draft) is the message: its parts
 * in order, nothing else between them, and where the message has pieces
 * drawn differently, nothing or something that can be their drawing (it
 * starts with @, #, :, <, / or an emoji, and is not longer than they can be).
 * So text typed after the clear that merely starts like the message is not
 * taken for it. Tries each place a part fits, each (part, place) once.
 */
function sameMessage(shape: BoxShape, seen: string): boolean {
    const text = seen.replace(ZERO_WIDTH, "").replace(/\s+/g, "");
    const { parts, gaps } = shape;
    if (parts.length === 0) return false;
    const failed = new Set<string>();
    const fit = (i: number, pos: number): boolean => {
        if (i === parts.length) return gapFits(text.slice(pos), gaps[i]!);
        const key = `${i}:${pos}`;
        if (failed.has(key)) return false;
        const p = parts[i]!;
        const latest = pos + DRAWN_PIECE_MAX * gaps[i]!;
        for (let at = text.indexOf(p, pos); at >= 0 && at <= latest; at = text.indexOf(p, at + 1)) {
            if (gapFits(text.slice(pos, at), gaps[i]!) && fit(i + 1, at + p.length)) return true;
        }
        failed.add(key);
        return false;
    };
    return fit(0, 0);
}

/**
 * Whether a message is still in its box after Subline's clear, from what can
 * be read: `boxTexts`, the drawn text of each box of the channel (null: not
 * readable; "" for an empty box), and `draft`, Discord's draft for the
 * channel (its raw form, `<@123>`, with line breaks; null: not readable).
 *   - A box whose drawn text is the message (sameMessage): yes.
 *   - Else the draft is the message AND a box shows some text: yes.
 *   - Else no. An empty box is believed over the draft: a draft not saved
 *     yet must never drop a message that left the box (it would be lost).
 * A wrong "yes" loses a message (it is dropped as "still in the box"), so a
 * yes needs every part of the text, in order; a wrong "no" sends it twice.
 * A message of only pieces drawn differently (only emoji or mentions) never
 * comes here: it is sent as written.
 */
export function boxHolds(original: string, boxTexts: ReadonlyArray<string | null>, draft: string | null): boolean {
    const want = boxParts(original);
    if (want.parts.length === 0) return false;
    let shows = false;
    for (const t of boxTexts) {
        if (typeof t !== "string") continue;
        if (sameMessage(want, t)) return true;
        if (t.replace(ZERO_WIDTH, "").trim() !== "") shows = true;
    }
    return shows && typeof draft === "string" && sameMessage(want, draft);
}

/** The primary language subtag, lower case ("pt-BR" → "pt"), or "". */
export function primaryLang(code: unknown): string {
    return typeof code === "string" ? code.trim().split(/[-_]/)[0]!.toLowerCase() : "";
}

/** A slash command (Discord's and the bots'): always Discord's own, never queued or translated. */
export function isSlashCommand(content: unknown): boolean {
    return typeof content === "string" && content.trimStart().startsWith("/");
}

/**
 * Whether a message is one Send in translates: not empty, not a slash
 * command, and with letters left once mentions, emoji, links and code are
 * set aside. Anything else is sent as written.
 */
export function isTranslatable(content: unknown): content is string {
    if (typeof content !== "string") return false;
    if (content.trim() === "") return false;
    if (isSlashCommand(content)) return false;
    return hasTranslatableText(splitSilent(content).body);
}

/** Discord's own "@silent " at the start of a message (it sends the rest without notifying anyone). */
const SILENT = /^\s*@silent\s+/;

/**
 * "@silent hello" → prefix "@silent ", body "hello". Discord reads the word
 * from the start of the text in its own send, so it never goes to the model
 * (which could translate or move it): only `body` is translated, and the
 * prefix is put back in front of the translation.
 */
export function splitSilent(text: string): { prefix: string; body: string; } {
    const m = SILENT.exec(text);
    return m ? { prefix: "@silent ", body: text.slice(m[0].length) } : { prefix: "", body: text };
}

/**
 * What the reader typed in the box while a message with files was held
 * (`now`, the box's text when Discord is let send `original`): the part to
 * put back once Discord empties the box. "" for nothing new. Text typed after
 * the original is given alone; anything else (an edit in the middle) is given
 * whole, so nothing typed is ever lost.
 */
export function typedMeanwhile(now: string, original: string): string {
    if (typeof now !== "string" || now.trim() === "") return "";
    if (normalizeForCompare(now) === normalizeForCompare(original)) return "";
    if (now.startsWith(original)) return now.slice(original.length).replace(/^\s+/, "");
    return now;
}

/* ------------------------------------------------------------------ cache -- */

/**
 * The same text into the same language reuses the saved translation: no
 * request. Keyed on the MASKED text, so "thanks {0}" for two different
 * mentions is one entry; each message's own tokens are put back. LRU, capped.
 */
export class TranslationCache {
    private readonly rows = new Map<string, string>();

    constructor(private readonly cap: number) { }

    private key(lang: string, masked: string): string {
        return `${lang}\u0000${normalizeForCompare(masked)}`;
    }

    get(lang: string, masked: string): string | undefined {
        const k = this.key(lang, masked);
        const v = this.rows.get(k);
        if (v === undefined) return undefined;
        this.rows.delete(k);
        this.rows.set(k, v);
        return v;
    }

    set(lang: string, masked: string, translatedMasked: string): void {
        const k = this.key(lang, masked);
        this.rows.delete(k);
        this.rows.set(k, translatedMasked);
        while (this.rows.size > this.cap) this.rows.delete(this.rows.keys().next().value as string);
    }

    get size(): number {
        return this.rows.size;
    }

    clear(): void {
        this.rows.clear();
    }
}

/* ---------------------------------------------------------------- the queue -- */

/** What the relay answered for one outgoing text. */
export type OutgoingResult =
    /** `text`: the translation, placeholders in. */
    | { kind: "ok"; text: string; lang: string; }
    /** The relay said the text needs no translating (already in the language). */
    | { kind: "same"; }
    /** The day's Send in messages are used up (the relay's send_in_limit). */
    | { kind: "limit"; }
    /** The relay paused AI for the day (ai_paused): blocked() now says so. */
    | { kind: "blocked"; }
    /** Nothing usable: `note` is what the reader is told. */
    | { kind: "fail"; note: string; };

/** Where Send in stands in a channel right now. */
export type SendInState = { kind: "off"; } | { kind: "on"; lang: string; };

/**
 * Why Send in cannot translate right now, for everyone: the day's limit, or
 * AI is not on. `key` changes when the reason does (a new day's limit), so
 * the reader is told once per reason.
 */
export interface SendInBlock {
    key: string;
    note: string;
}

/** Discord's send for one message, carried as it is to the send (the reply, the emoji). */
export type Carry = unknown;

export interface SendInDeps {
    state(channelId: string): SendInState;
    /** Null when Send in may translate; else why not. */
    blocked(): SendInBlock | null;
    /** One request: `masked` (placeholders in) into `lang`, forced, alone. Never throws. */
    translate(masked: string, lang: string, signal: { cancelled: boolean; }): Promise<OutgoingResult>;
    /** The relay said send_in_limit: remember it until the day ends (blocked() then says so). */
    noteLimit(): void;
    /**
     * Empty the box the Enter came from (and its reply bar). False when it
     * could not: then nothing is queued and the text stays in the box.
     */
    clearBox(channelId: string, carry: Carry): boolean;
    /**
     * After clearBox said yes: whether the box of `channelId` really no
     * longer holds `original` (Discord's clear goes to the box it last
     * subscribed). Resolves false only when it is sure the text is still
     * there; then nothing is sent or kept (the text is in the box). Optional.
     */
    checkCleared?(channelId: string, original: string): Promise<boolean>;
    /** Send `content` to `channelId` with Discord's options from the Enter. Throws when Discord would not take it. */
    send(channelId: string, content: string, carry: Carry): void;
    /**
     * A translation is about to go out (or goes, inPlace) as `content`;
     * `original` is what the reader typed, `lang` the language it is sent in.
     * Called BEFORE the send, so Discord's local copy of the message, created
     * inside the send, finds it.
     */
    sent(channelId: string, content: string, original: string, lang: string): void;
    /** The send after sent() threw: forget that expectation. Optional. */
    unsent?(channelId: string, content: string): void;
    /**
     * A message with files is let go by the hook now (Discord sends it and
     * then empties the box): keep what the reader typed in the box meanwhile.
     * Optional.
     */
    releasing?(channelId: string, original: string): void;
    /** The longest message Discord takes from the reader (2000, 4000 with Nitro). */
    maxSendChars(): number;
    /** Longest masked text sent for translating (the relay's per-text limit). */
    maxChars: number;
    /** How long one message waits for the relay. */
    timeoutMs: number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}

export interface SendInCopy {
    failed: string;
    timeout: string;
    tokensLost: string;
    tooLong: string;
    /** The translation is longer than Discord takes. */
    tooLongOut: string;
    tooMany: string;
    /** Kept because an earlier message of the channel was kept (the order holds). */
    heldBehind: string;
    sendFailed: string;
    boxNotCleared: string;
}

/** The pre-send hook's answer. `pass` with `content`: Discord sends that text instead. */
export type PreSendDecision =
    | { action: "pass"; content?: string; }
    | { action: "cancel"; };

/** A message kept for the reader: nothing was sent. */
export interface Offer {
    original: string;
    carry: Carry;
    /** The language it was to be sent in ("" for a message that was going as written). */
    lang: string;
    note: string;
}

/** What the status line above a channel's box says. */
export type StatusView =
    /** Messages kept for the reader: the first one's note, and how many. */
    | { kind: "failed"; note: string; count: number; }
    /** A message with files was not sent; it is still in the box with its files. */
    | { kind: "boxFailed"; note: string; }
    | { kind: "sending"; lang: string; }
    | { kind: "note"; text: string; };

interface Job {
    channelId: string;
    original: string;
    carry: Carry;
    lang: string;
    mode: "queue" | "inPlace";
    status: "wait" | "ready" | "failed";
    /** ready: what is sent. */
    text?: string;
    /** ready: the reader's own text, untranslated (no "You wrote" line then). */
    asWritten?: boolean;
    /** failed: what the reader is told. */
    note?: string;
    /** inPlace: the hook's answer. */
    resolve?: (d: PreSendDecision) => void;
    /** queue: the box is being checked (checkCleared); not sent before it says yes. */
    checking?: boolean;
    /** An earlier message of the channel, on its way with it, was kept: this one is kept behind it. */
    held?: boolean;
}

/** Messages one channel may have on their way at once; past it, a message is kept. */
export const SEND_IN_MAX_QUEUE = 20;
/** Saved translations kept for reuse. */
export const SEND_IN_CACHE_SIZE = 200;
/** How long a passing note stays on the status line. */
export const SEND_IN_NOTE_MS = 6_000;

const PASS: PreSendDecision = { action: "pass" };
const CANCEL: PreSendDecision = { action: "cancel" };

export class SendInQueue {
    private readonly queues = new Map<string, Job[]>();
    private readonly offers = new Map<string, Offer[]>();
    /** inPlace: the note, and the text left in the box with its files. */
    private readonly boxFailed = new Map<string, { note: string; text: string; }>();
    private readonly notes = new Map<string, { text: string; timer: unknown; }>();
    /** inPlace "Send as written": this channel's next Enter of this text goes as it is. */
    private readonly bypass = new Map<string, string>();
    /** The blocks the reader was told about already (SendInBlock.key). */
    private readonly told = new Set<string>();
    private readonly listeners = new Set<() => void>();
    readonly cache = new TranslationCache(SEND_IN_CACHE_SIZE);
    /** Requests on their way, by language and text: the same text twice shares one request. */
    private readonly inFlight = new Map<string, Promise<OutgoingResult>>();

    constructor(private readonly deps: SendInDeps, private readonly copy: SendInCopy) { }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private changed(): void {
        for (const fn of this.listeners) {
            try { fn(); } catch { /* a listener's own trouble */ }
        }
    }

    /** What the status line of this channel says, or null for nothing. */
    view(channelId: string): StatusView | null {
        const offers = this.offers.get(channelId);
        if (offers && offers.length > 0) return { kind: "failed", note: offers[0]!.note, count: offers.length };
        const box = this.boxFailed.get(channelId);
        if (box !== undefined) return { kind: "boxFailed", note: box.note };
        const waiting = this.queues.get(channelId)?.filter(j => j.status === "wait") ?? [];
        if (waiting.length > 0) return { kind: "sending", lang: waiting[waiting.length - 1]!.lang };
        const note = this.notes.get(channelId);
        if (note) return { kind: "note", text: note.text };
        return null;
    }

    /** The messages kept for the reader in this channel. */
    offered(channelId: string): readonly Offer[] {
        return this.offers.get(channelId) ?? [];
    }

    /** Whether this channel has a message on its way. */
    busy(channelId: string): boolean {
        return (this.queues.get(channelId)?.length ?? 0) > 0;
    }

    /**
     * Discord's pre-send hook for a NEW message (an edit never comes here).
     * `inPlace`: the message carries files (or something else only Discord's
     * own send can carry), so Discord's send is held, never cancelled and
     * redone. Never throws.
     */
    async onPreSend(channelId: string, content: string, carry: Carry, inPlace: boolean): Promise<PreSendDecision> {
        const text = typeof content === "string" ? content : "";
        // Slash commands are Discord's own, always, at once.
        if (isSlashCommand(text)) return PASS;
        const state = this.deps.state(channelId);
        // Off (or turned off with messages still on their way): as written,
        // after the ones before it.
        if (state.kind === "off") return this.asWritten(channelId, text, carry, inPlace);
        this.dropNote(channelId);

        if (inPlace) {
            const by = this.bypass.get(channelId);
            this.bypass.delete(channelId);
            if (by !== undefined && normalizeForCompare(by) === normalizeForCompare(text)) {
                this.dismissBox(channelId);
                return this.asWritten(channelId, text, carry, true);
            }
            // Enter again while this message (with its files) is on its way:
            // never a second request, never the original.
            if (this.queues.get(channelId)?.some(j => j.mode === "inPlace")) return CANCEL;
            this.dismissBox(channelId);
        }

        if (!isTranslatable(text)) return this.asWritten(channelId, text, carry, inPlace);

        const block = this.deps.blocked();
        if (block !== null) {
            // Told once per reason, with this message kept; after that the
            // grey label says it, and messages go as written.
            if (this.told.has(block.key)) return this.asWritten(channelId, text, carry, inPlace);
            this.told.add(block.key);
            return this.refuse(channelId, text, carry, inPlace, state.lang, block.note);
        }

        if (protectTokens(splitSilent(text).body).masked.length > this.deps.maxChars) {
            return this.refuse(channelId, text, carry, inPlace, state.lang, this.copy.tooLong);
        }
        if ((this.queues.get(channelId)?.length ?? 0) >= SEND_IN_MAX_QUEUE) {
            return this.refuse(channelId, text, carry, inPlace, state.lang, this.copy.tooMany);
        }
        return this.translateJob(channelId, text, carry, inPlace, state.lang);
    }

    /** "Try again": every kept message of this channel, translated again, in order. The box is not touched. */
    retry(channelId: string): void {
        const offers = this.takeOffers(channelId);
        if (offers.length === 0) return;
        // Messages still on their way behind the kept ones go after them.
        const tail = this.detachHeld(channelId);
        const keptBefore = this.offers.get(channelId)?.length ?? 0;
        const block = this.deps.blocked();
        for (const o of offers) {
            if (o.lang === "" || !isTranslatable(o.original)) {
                this.push({ channelId, original: o.original, carry: o.carry, lang: "", mode: "queue", status: "ready", text: o.original, asWritten: true });
            } else if (block !== null) {
                this.keep(channelId, { ...o, note: block.note });
            } else if (protectTokens(splitSilent(o.original).body).masked.length > this.deps.maxChars) {
                this.keep(channelId, { ...o, note: this.copy.tooLong });
            } else {
                void this.translateJob(channelId, o.original, o.carry, false, o.lang, false);
            }
        }
        // One of them was kept again at once: what was behind it stays behind it.
        this.reattach(channelId, tail, (this.offers.get(channelId)?.length ?? 0) > keptBefore);
        this.pump(channelId);
        this.changed();
    }

    /** "Send as written": every kept message of this channel, as the reader wrote it, in order. */
    sendAsWritten(channelId: string): void {
        const offers = this.takeOffers(channelId);
        if (offers.length === 0) return;
        const tail = this.detachHeld(channelId);
        for (const o of offers) {
            this.push({ channelId, original: o.original, carry: o.carry, lang: o.lang, mode: "queue", status: "ready", text: o.original, asWritten: true });
        }
        this.reattach(channelId, tail, false);
        this.pump(channelId);
        this.changed();
    }

    /**
     * The messages held behind kept ones (always the end of the queue), taken
     * out so the kept ones, acted on now, go in front of them again.
     */
    private detachHeld(channelId: string): Job[] {
        const q = this.queues.get(channelId);
        if (!q) return [];
        const i = q.findIndex(j => j.held);
        if (i < 0) return [];
        const tail = q.splice(i);
        for (const j of tail) j.held = false;
        if (q.length === 0) this.queues.delete(channelId);
        return tail;
    }

    private reattach(channelId: string, tail: Job[], held: boolean): void {
        if (tail.length === 0) return;
        const q = this.queues.get(channelId) ?? [];
        for (const j of tail) {
            j.held = held;
            q.push(j);
        }
        this.queues.set(channelId, q);
    }

    /**
     * "Send as written" for a message with files (still in the box): its next
     * Enter goes as it is. Returns false when there is no such message.
     */
    armBypass(channelId: string): boolean {
        const box = this.boxFailed.get(channelId);
        if (box === undefined) return false;
        this.bypass.set(channelId, box.text);
        return true;
    }

    /** Close the line about a message with files (the reader acted on it, or sent again). */
    dismissBox(channelId: string): void {
        if (this.boxFailed.delete(channelId)) this.changed();
    }

    /** A note on the status line for a while. */
    note(channelId: string, text: string): void {
        this.dropNote(channelId);
        const timer = this.deps.setTimer(() => {
            if (this.notes.get(channelId)?.text === text) {
                this.notes.delete(channelId);
                this.changed();
            }
        }, SEND_IN_NOTE_MS);
        this.notes.set(channelId, { text, timer });
        this.changed();
    }

    private dropNote(channelId: string): void {
        const n = this.notes.get(channelId);
        if (!n) return;
        this.deps.clearTimer(n.timer);
        this.notes.delete(channelId);
        this.changed();
    }

    /**
     * Everything forgotten (the plugin stopped). Messages on their way are
     * dropped, never sent. Returns the texts that were already out of the box
     * (on their way, or kept with "Not sent"), oldest first, so the caller can
     * give them back; a message with files is still in its box (CANCEL).
     */
    reset(): { channelId: string; original: string; }[] {
        const lost: { channelId: string; original: string; }[] = [];
        for (const [channelId, list] of this.offers) {
            for (const o of list) lost.push({ channelId, original: o.original });
        }
        for (const [channelId, q] of this.queues) {
            for (const j of q) {
                j.status = "failed";
                j.resolve?.(CANCEL);
                if (j.mode === "queue") lost.push({ channelId, original: j.original });
            }
        }
        for (const n of this.notes.values()) this.deps.clearTimer(n.timer);
        this.queues.clear();
        this.offers.clear();
        this.boxFailed.clear();
        this.notes.clear();
        this.bypass.clear();
        this.told.clear();
        this.cache.clear();
        this.changed();
        return lost;
    }

    /* ------------------------------------------------------------ inside -- */

    private takeOffers(channelId: string): Offer[] {
        const offers = this.offers.get(channelId) ?? [];
        this.offers.delete(channelId);
        return offers;
    }

    private keep(channelId: string, offer: Offer): void {
        const list = this.offers.get(channelId) ?? [];
        list.push(offer);
        this.offers.set(channelId, list);
    }

    private push(job: Job): void {
        const q = this.queues.get(job.channelId) ?? [];
        // Behind a message that is being kept: kept too, in order.
        if (q.some(j => j.held)) job.held = true;
        q.push(job);
        this.queues.set(job.channelId, q);
    }

    /**
     * A message that goes as written. With nothing of this channel on its
     * way, Discord sends it itself. Otherwise it waits its turn: in the queue
     * (queue), or held in the hook (inPlace), so it cannot overtake.
     */
    private asWritten(channelId: string, text: string, carry: Carry, inPlace: boolean): Promise<PreSendDecision> | PreSendDecision {
        if (!this.busy(channelId)) return PASS;
        if (inPlace) {
            return new Promise<PreSendDecision>(resolve => {
                this.push({ channelId, original: text, carry, lang: "", mode: "inPlace", status: "ready", text, asWritten: true, resolve });
            });
        }
        const job: Job = { channelId, original: text, carry, lang: "", mode: "queue", status: "ready", text, asWritten: true };
        if (!this.clear(channelId, carry, job)) return CANCEL;
        this.push(job);
        this.changed();
        return CANCEL;
    }

    /** Nothing is sent: the message is kept (queue) or left in the box (inPlace) with `note`. */
    private refuse(channelId: string, text: string, carry: Carry, inPlace: boolean, lang: string, note: string): PreSendDecision {
        if (inPlace) {
            this.boxFailed.set(channelId, { note, text });
            this.changed();
            return CANCEL;
        }
        const offer: Offer = { original: text, carry, lang, note };
        if (!this.clear(channelId, carry, offer)) return CANCEL;
        this.keep(channelId, offer);
        this.changed();
        return CANCEL;
    }

    /**
     * Empty the box; if it cannot be emptied, say so (the text stays in it,
     * nothing is sent). `what`, the message or kept text the box held: with
     * checkCleared, a job waits for the check before it is sent, and if the
     * text turns out to be still in the box, the job or the kept text is
     * dropped (the box has it; a second copy would be sent twice).
     */
    private clear(channelId: string, carry: Carry, what: Job | Offer): boolean {
        let ok = false;
        try {
            ok = this.deps.clearBox(channelId, carry) === true;
        } catch {
            ok = false;
        }
        if (!ok) {
            this.note(channelId, this.copy.boxNotCleared);
            return false;
        }
        const check = this.deps.checkCleared;
        if (typeof check !== "function") return true;
        const job = "mode" in what ? what : null;
        if (job) job.checking = true;
        let p: Promise<boolean>;
        try {
            p = Promise.resolve(check.call(this.deps, channelId, what.original));
        } catch {
            p = Promise.resolve(true);
        }
        void p.then(r => r !== false, () => true).then(cleared => {
            if (job) {
                job.checking = false;
                if (!cleared) {
                    const q = this.queues.get(channelId);
                    const i = q?.indexOf(job) ?? -1;
                    if (q && i >= 0) {
                        q.splice(i, 1);
                        if (q.length === 0) this.queues.delete(channelId);
                    }
                    job.status = "failed";
                }
            } else if (!cleared) {
                const list = this.offers.get(channelId);
                const i = list?.indexOf(what as Offer) ?? -1;
                if (list && i >= 0) {
                    list.splice(i, 1);
                    if (list.length === 0) this.offers.delete(channelId);
                }
            }
            if (!cleared) this.note(channelId, this.copy.boxNotCleared);
            this.pump(channelId);
            this.changed();
        });
        return true;
    }

    /** One message on its way: translated (or taken from the cache), then sent in its turn. */
    private translateJob(channelId: string, text: string, carry: Carry, inPlace: boolean, lang: string, fromBox = true): Promise<PreSendDecision> {
        const { prefix, body } = splitSilent(text);
        const { masked, tokens } = protectTokens(body);
        const job: Job = { channelId, original: text, carry, lang, mode: inPlace ? "inPlace" : "queue", status: "wait" };
        // queue, from an Enter: the box is emptied now (the hook answers cancel
        // at once). "Try again" (fromBox false) never touches the box.
        if (!inPlace && fromBox && !this.clear(channelId, carry, job)) return Promise.resolve(CANCEL);
        const answer = inPlace ? new Promise<PreSendDecision>(resolve => { job.resolve = resolve; }) : Promise.resolve(CANCEL);
        this.push(job);
        this.changed();

        const settle = (r: OutgoingResult) => {
            if (job.status !== "wait") return;
            if (r.kind === "ok") {
                const restored = restoreTokens(r.text, tokens);
                if (restored === null || addsPings(body, restored)) this.fail(job, this.copy.tokensLost);
                else if (restored.trim() === "") this.fail(job, this.copy.failed);
                else {
                    this.cache.set(lang, masked, r.text);
                    const out = prefix + restored;
                    if (out.length > this.maxSend()) this.fail(job, this.copy.tooLongOut);
                    else this.ready(job, out);
                }
            } else if (r.kind === "same") {
                // Saved too: the same text again costs no request.
                this.cache.set(lang, masked, masked);
                this.ready(job, text);
            } else if (r.kind === "limit" || r.kind === "blocked") {
                if (r.kind === "limit") this.deps.noteLimit();
                const block = this.deps.blocked();
                if (block !== null) this.told.add(block.key);
                this.fail(job, block?.note ?? this.copy.failed);
            } else {
                this.fail(job, r.note);
            }
            this.pump(channelId);
            this.changed();
        };

        const hit = this.cache.get(lang, masked);
        // A saved translation is still sent after the hook has answered, never inside it.
        // The same text already on its way shares that one request (no second charge).
        const flightKey = `${lang}\u0000${masked}`;
        let result: Promise<OutgoingResult>;
        if (hit !== undefined) result = Promise.resolve<OutgoingResult>(hit === masked ? { kind: "same" } : { kind: "ok", text: hit, lang });
        else {
            const flying = this.inFlight.get(flightKey);
            if (flying) result = flying;
            else {
                result = this.withTimeout(masked, lang);
                this.inFlight.set(flightKey, result);
                const done = () => { if (this.inFlight.get(flightKey) === result) this.inFlight.delete(flightKey); };
                result.then(done, done);
            }
        }
        void result.then(settle);
        return answer;
    }

    /** Discord's limit for the reader's messages; 2000 when it cannot be read. */
    private maxSend(): number {
        try {
            const n = this.deps.maxSendChars();
            return typeof n === "number" && n > 0 ? n : 2000;
        } catch {
            return 2000;
        }
    }

    private ready(job: Job, text: string): void {
        job.status = "ready";
        job.text = text;
        job.asWritten = normalizeForCompare(text) === normalizeForCompare(job.original);
    }

    private fail(job: Job, note: string): void {
        job.status = "failed";
        job.note = note;
    }

    /** Send every finished message at the head of the channel's queue, in order. */
    private pump(channelId: string): void {
        const q = this.queues.get(channelId);
        if (!q) return;
        while (q.length > 0 && q[0]!.status !== "wait" && q[0]!.checking !== true) {
            const job = q.shift()!;
            // Kept behind an earlier message that was kept: never ahead of it.
            if (job.held && job.status === "ready") {
                job.status = "failed";
                job.note = this.copy.heldBehind;
            }
            if (job.mode === "inPlace") {
                if (job.status === "ready") {
                    if (!job.asWritten) this.deps.sent(channelId, job.text!, job.original, job.lang);
                    try { this.deps.releasing?.(channelId, job.original); } catch { /* the box's extra text only */ }
                    job.resolve!(job.text === job.original ? PASS : { action: "pass", content: job.text! });
                } else {
                    this.boxFailed.set(channelId, { note: job.note!, text: job.original });
                    job.resolve!(CANCEL);
                }
                continue;
            }
            if (job.status === "failed") {
                this.keep(channelId, { original: job.original, carry: job.carry, lang: job.lang, note: job.note! });
                // What was typed with it and is still on its way stays behind it.
                for (const later of q) later.held = true;
                continue;
            }
            // "You wrote" first: Discord's local copy is made inside the send.
            if (!job.asWritten) this.deps.sent(channelId, job.text!, job.original, job.lang);
            try {
                this.deps.send(channelId, job.text!, job.carry);
            } catch {
                if (!job.asWritten) {
                    try { this.deps.unsent?.(channelId, job.text!); } catch { /* the line only */ }
                }
                this.keep(channelId, { original: job.original, carry: job.carry, lang: job.lang, note: this.copy.sendFailed });
                for (const later of q) later.held = true;
            }
        }
        if (q.length === 0) this.queues.delete(channelId);
    }

    private withTimeout(masked: string, lang: string): Promise<OutgoingResult> {
        const signal = { cancelled: false };
        return new Promise<OutgoingResult>(resolve => {
            const timer = this.deps.setTimer(() => {
                signal.cancelled = true;
                resolve({ kind: "fail", note: this.copy.timeout });
            }, this.deps.timeoutMs);
            let p: Promise<OutgoingResult>;
            try {
                p = this.deps.translate(masked, lang, signal);
            } catch {
                p = Promise.resolve({ kind: "fail", note: this.copy.failed });
            }
            p.then(
                r => {
                    this.deps.clearTimer(timer);
                    if (signal.cancelled) {
                        // Too late for this message, but paid for: saved, so
                        // "Try again" sends it with no second request.
                        if (r.kind === "ok" && typeof r.text === "string" && r.text.trim() !== "") this.cache.set(lang, masked, r.text);
                        else if (r.kind === "same") this.cache.set(lang, masked, masked);
                    }
                    resolve(signal.cancelled ? { kind: "fail", note: this.copy.timeout } : r);
                },
                () => { this.deps.clearTimer(timer); resolve({ kind: "fail", note: this.copy.failed }); }
            );
        });
    }
}

/* ------------------------------------------------------ the panel's list -- */

/*
 * THE ✦ PANEL'S LIST (owner, 0.2.11: "not a single language to see until you
 * type"). On open it lists languages AT ONCE, in sections: the languages of
 * this channel (its tally, then its parent's for a thread), then the ones
 * the reader chose before (recent, newest first), then common languages.
 * Each language once, in its first section; never the reader's own. The
 * search box filters ALL languages by English or native name.
 */

/** How many of the channel's languages the panel lists first ("In this channel"). */
export const PANEL_TOP = 4;
/** How many search results the panel lists: all of them (the list scrolls). */
export const PANEL_SEARCH_MAX = Number.POSITIVE_INFINITY;
/** How many recently chosen languages the panel lists ("Recent"). */
export const PANEL_RECENT_MAX = 5;
/** How many chosen languages are remembered. */
export const RECENT_KEPT = 12;
/** The common languages the panel lists last ("Common"), most spoken on Discord first. */
export const PANEL_COMMON: readonly string[] = [
    "es", "tr", "ar", "hi", "pt", "fr", "de", "ru", "ja", "ko", "zh", "it", "id", "vi", "pl", "nl", "uk", "th", "fil", "fa"
];

export type PanelSectionKey = "channel" | "recent" | "common";
export interface PanelSection {
    key: PanelSectionKey;
    codes: string[];
}

/**
 * The panel's sections with nothing typed: "channel", "recent", "common", in
 * that order, each language once (in its first section), never the reader's
 * own, empty sections left out. `chosen` (the language Send in is on in, if
 * any) is always listed: first in "recent" when no section has it.
 */
export function panelSections(channelId: string, readerLang: string, parentId?: string | null, chosen?: string | null): PanelSection[] {
    const reader = primaryLang(readerLang);
    const seen = new Set<string>([reader]);
    const take = (codes: readonly string[]): string[] => {
        const out: string[] = [];
        for (const raw of codes) {
            const code = normalizeTargetLang(raw);
            if (code === null || seen.has(code)) continue;
            seen.add(code);
            out.push(code);
        }
        return out;
    };
    const channel = take(panelLanguages(channelId, readerLang, parentId));
    const recentCodes = recentLanguages().slice(0, PANEL_RECENT_MAX);
    const chosenCode = normalizeTargetLang(chosen);
    if (chosenCode !== null && !channel.includes(chosenCode) && !recentCodes.includes(chosenCode)) recentCodes.unshift(chosenCode);
    const recent = take(recentCodes);
    const common = take(PANEL_COMMON);
    const sections: PanelSection[] = [
        { key: "channel", codes: channel },
        { key: "recent", codes: recent },
        { key: "common", codes: common }
    ];
    return sections.filter(sec => sec.codes.length > 0);
}

/**
 * The languages Subline translated in this channel, most frequent first,
 * then its parent's for a thread, never the reader's own, at most PANEL_TOP.
 */
export function panelLanguages(channelId: string, readerLang: string, parentId?: string | null): string[] {
    const own = channelLanguages(channelId, readerLang);
    const parent = parentId ? channelLanguages(parentId, readerLang) : [];
    return [...new Set([...own, ...parent])].slice(0, PANEL_TOP);
}

export interface LanguageRow {
    code: string;
    english: string;
    native: string;
}

/** Lower case, accents gone: "Español" and "espanol" meet. */
function fold(s: string): string {
    return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/**
 * The search box: every language whose English or native name (or code)
 * matches what was typed, names that START with it first, never the
 * reader's own (all of them: the list scrolls). Nothing typed: nothing
 * here (the panel lists its sections instead).
 */
export function searchLanguages(query: string, rows: readonly LanguageRow[], readerLang: string): LanguageRow[] {
    const q = fold(query.trim());
    if (q === "") return [];
    const reader = primaryLang(readerLang);
    const scored: { row: LanguageRow; score: number; }[] = [];
    for (const row of rows) {
        if (row.code === reader) continue;
        const names = [fold(row.english), fold(row.native)];
        let score = -1;
        if (names.some(n => n.startsWith(q))) score = 0;
        else if (row.code === q || names.some(n => n.split(/[\s()]+/).some(w => w.startsWith(q)))) score = 1;
        else if (names.some(n => n.includes(q))) score = 2;
        if (score >= 0) scored.push({ row, score });
    }
    scored.sort((a, b) => a.score - b.score || a.row.english.localeCompare(b.row.english, "en"));
    return (Number.isFinite(PANEL_SEARCH_MAX) ? scored.slice(0, PANEL_SEARCH_MAX) : scored).map(s => s.row);
}

/* ----------------------------------------------------- per-channel memory -- */

/**
 * What Send in remembers, in one DataStore entry: per channel, whether it is
 * on and the chosen language, and a small tally of the languages Subline
 * translated in that channel (the panel's buttons, without asking anyone).
 */
export const SEND_IN_KEY = "VcTranslate_sendIn";

/** At most this many channels are remembered (the least recently touched go first). */
export const SEND_IN_MAX_CHANNELS = 300;
/** A channel's tally is halved past this many messages, so it follows the recent chat. */
export const TALLY_HALVE_AT = 60;

/** The languages the reader chose in the panel, newest first, all channels (the panel's "Recent"). */
export const SEND_IN_RECENT_KEY = "VcTranslate_sendInRecent";

interface ChannelEntry {
    on?: boolean;
    lang?: string;
    tally?: Record<string, number>;
    at: number;
}

let book = new Map<string, ChannelEntry>();
let recent: string[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let recentSaveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function scheduleRecentSave(): void {
    if (recentSaveTimer !== null) return;
    recentSaveTimer = setTimeout(() => {
        recentSaveTimer = null;
        void DataStore.set(SEND_IN_RECENT_KEY, [...recent]).catch(() => { /* kept in memory */ });
    }, 2_000);
}

/** The languages chosen before, newest first (at most RECENT_KEPT). */
export function recentLanguages(): string[] {
    return [...recent];
}

function noteRecent(code: string): void {
    recent = [code, ...recent.filter(c => c !== code)].slice(0, RECENT_KEPT);
    scheduleRecentSave();
}

function touch(channelId: string): ChannelEntry {
    let e = book.get(channelId);
    if (e === undefined) e = { at: 0 };
    book.delete(channelId);
    e.at = Date.now();
    book.set(channelId, e);
    while (book.size > SEND_IN_MAX_CHANNELS) {
        const oldest = book.keys().next().value as string;
        book.delete(oldest);
    }
    return e;
}

function scheduleSave(): void {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void DataStore.set(SEND_IN_KEY, Object.fromEntries(book)).catch(() => { /* kept in memory */ });
    }, 2_000);
}

function changed(): void {
    for (const fn of listeners) {
        try { fn(); } catch { /* a listener's own trouble */ }
    }
}

export async function loadSendIn(): Promise<void> {
    try {
        const raw = await DataStore.get<Record<string, ChannelEntry>>(SEND_IN_KEY);
        const next = new Map<string, ChannelEntry>();
        if (raw && typeof raw === "object") {
            const rows = Object.entries(raw)
                .filter(([id, e]) => typeof id === "string" && e && typeof e === "object")
                .sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
            for (const [id, e] of rows) {
                const lang = normalizeTargetLang(e.lang);
                const tally: Record<string, number> = {};
                if (e.tally && typeof e.tally === "object") {
                    for (const [code, n] of Object.entries(e.tally)) {
                        const c = normalizeTargetLang(code);
                        if (c !== null && typeof n === "number" && n > 0 && Number.isFinite(n)) tally[c] = n;
                    }
                }
                // On without a language is off.
                next.set(id, { on: e.on === true && lang !== null, ...(lang ? { lang } : {}), tally, at: typeof e.at === "number" ? e.at : 0 });
            }
        }
        // Anything changed before the read finished wins over the stored copy.
        for (const [id, e] of book) next.set(id, e);
        book = next;
    } catch { /* nothing stored, or unreadable: start empty */ }
    try {
        const raw = await DataStore.get<unknown>(SEND_IN_RECENT_KEY);
        let stored: string[];
        if (Array.isArray(raw)) {
            stored = raw.map(normalizeTargetLang).filter((c): c is string => c !== null);
        } else {
            // Nothing stored yet (the first 0.2.11 builds): the languages
            // chosen in channels, most recently touched first.
            stored = [...book.values()].sort((a, b) => b.at - a.at)
                .map(e => normalizeTargetLang(e.lang)).filter((c): c is string => c !== null);
        }
        // Chosen before the read finished: newer.
        recent = [...new Set([...recent, ...stored])].slice(0, RECENT_KEPT);
    } catch { /* nothing stored, or unreadable: only what is chosen from now */ }
    loaded = true;
    changed();
}

export function sendInLoaded(): boolean {
    return loaded;
}

export function subscribeSendIn(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Whether Send in is on in this channel (always with a language). */
export function sendInOn(channelId: string): boolean {
    const e = book.get(channelId);
    return e?.on === true && typeof e.lang === "string";
}

/** The language chosen for this channel, or null. */
export function sendInLang(channelId: string): string | null {
    return book.get(channelId)?.lang ?? null;
}

/** Turn Send in on in this channel, in `lang`. False for a language not in the list. */
export function chooseSendInLang(channelId: string, lang: string): boolean {
    const code = normalizeTargetLang(lang);
    if (code === null) return false;
    const e = touch(channelId);
    e.on = true;
    e.lang = code;
    noteRecent(code);
    scheduleSave();
    changed();
    return true;
}

/** Turn Send in off in this channel (its language is remembered). */
export function turnSendInOff(channelId: string): void {
    if (!sendInOn(channelId)) return;
    const e = touch(channelId);
    e.on = false;
    scheduleSave();
    changed();
}

/**
 * One message Subline translated in this channel was written in `lang`. The
 * reader's own language is not counted: it is never the language to send in.
 */
export function noteChannelLanguage(channelId: string, lang: unknown, readerLang: string): void {
    const code = normalizeTargetLang(lang);
    if (code === null || code === primaryLang(readerLang)) return;
    const e = touch(channelId);
    const tally = e.tally ?? (e.tally = {});
    tally[code] = (tally[code] ?? 0) + 1;
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    if (total > TALLY_HALVE_AT) {
        for (const k of Object.keys(tally)) {
            tally[k] = Math.floor(tally[k]! / 2);
            if (tally[k] === 0) delete tally[k];
        }
    }
    scheduleSave();
}

/** The languages Subline translated in this channel, most frequent first. */
export function channelLanguages(channelId: string, readerLang: string): string[] {
    const tally = book.get(channelId)?.tally ?? {};
    const reader = primaryLang(readerLang);
    return Object.entries(tally)
        .filter(([code, n]) => n > 0 && code !== reader)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code]) => code);
}

/** Tests only. */
export function __resetSendIn(): void {
    book = new Map();
    recent = [];
    loaded = false;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    if (recentSaveTimer !== null) clearTimeout(recentSaveTimer);
    recentSaveTimer = null;
    listeners.clear();
}
