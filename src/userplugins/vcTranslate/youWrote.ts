import * as DataStore from "@api/DataStore";

import { normalizeForCompare } from "./sendIn";

/**
 * "YOU WROTE" (Send in, 0.2.11). A message Send in translated and sent shows
 * a small "(sent in Turkish)" after its text, only to its writer, and its
 * hover says what they typed ("You wrote: …", index.tsx InPlaceAccessory).
 * LOCAL ONLY: a capped map from the sent message's id to the original text
 * and the language it was sent in, kept on this computer (Vencord's
 * DataStore, so it survives a Discord restart), never sent anywhere, never
 * synced.
 *
 * The id is not known when the message is sent: Discord gives it in its own
 * MESSAGE_CREATE. So a send leaves an EXPECTATION (channel, the exact text
 * sent, the original, the language), and the reader's own next message in
 * that channel with that text takes it. Discord first shows a local copy
 * (`optimistic`, its id the nonce) and then the real one: both are noted,
 * and the expectation is used up by the real one, which also drops the local
 * copy's row (its `nonce` is the local copy's id), so each sent message keeps
 * ONE row and the newest YOU_WROTE_MAX messages keep theirs. Unmatched
 * expectations expire.
 *
 * Stored rows are [id, original, lang]. Rows from the first 0.2.11 builds
 * have no language: `lang` is null for them.
 */

export const YOU_WROTE_KEY = "VcTranslate_youWrote";
/** The newest this many messages keep their line. */
export const YOU_WROTE_MAX = 500;
/** An expectation no message took within this long is dropped. */
export const YOU_WROTE_EXPECT_MS = 2 * 60_000;
/** Expectations kept at once, all channels (a flood of failed sends cannot grow it). */
const EXPECT_MAX = 50;

interface Expectation {
    channelId: string;
    content: string;
    original: string;
    lang: string | null;
    at: number;
}

/** What the reader typed for one sent message, and the language it went out in (null: not known). */
export interface YouWrote {
    original: string;
    lang: string | null;
}

let rows = new Map<string, YouWrote>();
let expected: Expectation[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function changed(): void {
    for (const fn of listeners) {
        try { fn(); } catch { /* a listener's own trouble */ }
    }
}

function scheduleSave(): void {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const out = [...rows].map(([id, r]) => r.lang === null ? [id, r.original] : [id, r.original, r.lang]);
        void DataStore.set(YOU_WROTE_KEY, out).catch(() => { /* kept in memory */ });
    }, 2_000);
}

function put(id: string, row: YouWrote): void {
    rows.delete(id);
    rows.set(id, row);
    while (rows.size > YOU_WROTE_MAX) rows.delete(rows.keys().next().value as string);
    scheduleSave();
    changed();
}

/** The send after expectSent() failed at once: that expectation is dropped (the newest one with this text). */
export function forgetExpected(channelId: string, content: string): void {
    const c = normalizeForCompare(content);
    for (let i = expected.length - 1; i >= 0; i--) {
        if (expected[i]!.channelId === channelId && expected[i]!.content === c) {
            expected.splice(i, 1);
            return;
        }
    }
}

/**
 * A translation was sent as `content` in `channelId`; `original` is what the
 * reader typed, `lang` the language it was sent in.
 */
export function expectSent(channelId: string, content: string, original: string, now: number = Date.now(), lang: string | null = null): void {
    expected = expected.filter(e => now - e.at < YOU_WROTE_EXPECT_MS);
    expected.push({ channelId, content: normalizeForCompare(content), original, lang: typeof lang === "string" && lang !== "" ? lang : null, at: now });
    if (expected.length > EXPECT_MAX) expected = expected.slice(-EXPECT_MAX);
}

/**
 * Discord's MESSAGE_CREATE. True when the message was one Send in sent (its
 * line is noted). `meId`: the signed-in account; anyone else's message is
 * never matched.
 */
export function noteMessageCreated(
    message: { id?: unknown; channel_id?: unknown; content?: unknown; nonce?: unknown; author?: { id?: unknown; }; } | undefined,
    meId: string | undefined, optimistic: boolean, now: number = Date.now()
): boolean {
    if (!message || typeof message.id !== "string" || typeof message.channel_id !== "string") return false;
    if (!meId || message.author?.id !== meId || typeof message.content !== "string") return false;
    expected = expected.filter(e => now - e.at < YOU_WROTE_EXPECT_MS);
    const content = normalizeForCompare(message.content);
    const i = expected.findIndex(e => e.channelId === message.channel_id && e.content === content);
    if (i < 0) return false;
    const e = expected[i]!;
    if (!optimistic) {
        expected.splice(i, 1);
        // Discord's local copy is replaced by this one: its row is not needed.
        if (typeof message.nonce === "string" && message.nonce !== message.id) rows.delete(message.nonce);
    }
    put(message.id, { original: e.original, lang: e.lang });
    return true;
}

/** What the reader wrote for this message, or undefined (not one Send in sent). */
export function youWroteFor(messageId: unknown): string | undefined {
    return typeof messageId === "string" ? rows.get(messageId)?.original : undefined;
}

/** What the reader wrote for this message and the language it went out in, or undefined. */
export function youWroteEntry(messageId: unknown): YouWrote | undefined {
    if (typeof messageId !== "string") return undefined;
    const r = rows.get(messageId);
    return r === undefined ? undefined : { ...r };
}

export function subscribeYouWrote(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export async function loadYouWrote(): Promise<void> {
    try {
        const raw = await DataStore.get<unknown>(YOU_WROTE_KEY);
        if (!Array.isArray(raw)) return;
        const next = new Map<string, YouWrote>();
        for (const row of raw.slice(-YOU_WROTE_MAX)) {
            if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
                next.set(row[0], { original: row[1], lang: typeof row[2] === "string" && row[2] !== "" ? row[2] : null });
            }
        }
        // Anything noted before the read finished is newer.
        for (const [id, r] of rows) { next.delete(id); next.set(id, r); }
        while (next.size > YOU_WROTE_MAX) next.delete(next.keys().next().value as string);
        rows = next;
        changed();
    } catch { /* nothing stored, or unreadable: start empty */ }
}

/** Tests only. */
export function __resetYouWrote(): void {
    rows = new Map();
    expected = [];
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    listeners.clear();
}

/** Tests only: how many lines are kept. */
export function __youWroteSize(): number {
    return rows.size;
}
