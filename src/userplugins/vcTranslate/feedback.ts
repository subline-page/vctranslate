/**
 * The feedback box: what a reader can choose to send to the owner, built so
 * that what is sent is exactly what the reader was shown.
 *
 * THE RULES.
 *   - Nothing is ever sent automatically. Only the Send button sends, and
 *     only after the review step has shown every field.
 *   - `buildPayload` makes the one object that is both previewed and sent.
 *     `previewRows` reads that object and nothing else, and the box sends
 *     `JSON.stringify` of that same object. A part the reader unticked is not
 *     in the object, so it is neither shown nor sent.
 *   - A translation report carries ONE message: the one the reader
 *     right-clicked. Never the conversation around it.
 *   - Error codes come from the closed vocabulary in statusShape.ts, never an
 *     engine's text.
 *   - A failed send keeps everything the reader typed and says so calmly.
 *
 * The relay checks every field again (relay/src/feedback.ts); the limits here
 * mirror it so a valid-looking box is never refused there.
 */
import { toMinute } from "./recentErrors";

/* ================================================================== copy == */

/** Every string the feedback box shows. Short, plain, no em dashes. */
export const FEEDBACK_COPY = {
    title: "Send feedback",
    intro: "Tell us what works, what does not, or what you would like. You see everything before it is sent.",
    reportTitle: "Report a translation",
    reportIntro: "Tell us what is wrong with this translation. You see everything before it is sent.",
    contextMenu: "Report translation",
    messageLabel: "Your message",
    messagePlaceholder: "What happened, or what would you like?",
    reportMessagePlaceholder: "What is wrong with it? (optional)",
    emailLabel: "Email for a reply (optional)",
    emailPlaceholder: "Leave empty to stay anonymous",
    includeReport: "This translation (original and translated text, languages)",
    includeErrors: "Recent error codes (codes only, no messages)",
    includeApp: "App details (Subline version, build, system, plan)",
    noErrors: "No recent error codes.",
    review: "Review",
    reviewTitle: "This is exactly what will be sent:",
    send: "Send",
    sending: "Sending…",
    edit: "Edit",
    sent: "Thanks. Your feedback was sent.",
    sendAnother: "Send more",
    close: "Close",
    counter: "{n} of {max}",
    errors: {
        empty: "Write a message first.",
        tooLong: "That message is too long. Keep it under {max} characters.",
        badEmail: "That email does not look right. Check it, or leave it empty.",
        rate_limited: "You have sent a lot today. Try again tomorrow. Your text is still here.",
        rejected: "That could not be sent as it is. Try a shorter message. Your text is still here.",
        unavailable: "Couldn't send right now. Your text is still here. Try again in a minute.",
        network: "Couldn't reach Subline. Check your connection and try again. Your text is still here."
    },
    preview: {
        message: "Message",
        email: "Email",
        anonymous: "None (anonymous)",
        original: "Original text",
        translation: "Translation shown",
        shownAs: "Shown as",
        languages: "Languages",
        errors: "Error codes",
        app: "App details",
        google: "≈ Google",
        ai: "✦ AI"
    }
} as const;

/* ================================================================= shape == */

export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_EMAIL_CHARS = 254;
export const MAX_REPORT_TEXT_CHARS = 4_000;
export const MAX_ERRORS = 10;

export type Glyph = "≈" | "✦";
export type OsName = "mac" | "windows" | "linux" | "other";
export type PlanName = "none" | "automatic" | "ai";

export interface TranslationReport {
    original: string;
    translation: string;
    glyph: Glyph;
    source: string;
    target: string;
}
export interface ErrorCodeEntry { code: string; status?: number; at: string }
export interface AppDetails { version: string; build: string; os: OsName; plan: PlanName }

/** Exactly the body POST /v1/feedback takes. */
export interface FeedbackPayload {
    v: 1;
    message?: string;
    email?: string;
    report?: TranslationReport;
    errors?: ErrorCodeEntry[];
    app?: AppDetails;
}

/** What the reader typed and ticked. */
export interface FeedbackDraft {
    message: string;
    email: string;
    include: { report: boolean; errors: boolean; app: boolean };
}

/** What the box may offer to attach. Read when the box opens. */
export interface FeedbackContext {
    report?: TranslationReport;
    errors: ErrorCodeEntry[];
    app: AppDetails;
}

export function emptyDraft(): FeedbackDraft {
    return { message: "", email: "", include: { report: true, errors: true, app: true } };
}

/* ============================================================== building == */

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const LANG_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,2}$/;
const ERROR_CODE_RE = /^[a-z][a-z0-9-]{1,31}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Control characters out (they would make the relay refuse the whole item). */
export function cleanText(s: string): string {
    return s.replace(CONTROL_RE, " ");
}

/** A light check: one @, a dot in the domain, no spaces. */
export function looksLikeEmail(s: string): boolean {
    return s.length <= MAX_EMAIL_CHARS && EMAIL_RE.test(s);
}

export function langOrUnknown(s: string | undefined): string {
    return typeof s === "string" && LANG_RE.test(s) ? s : "und";
}

/**
 * The report for ONE message: its own text, the translation the reader saw,
 * and how it was made. Null when there is no real translation to report.
 * Takes only this message's text, so nothing from any other message can
 * reach the payload.
 */
export function reportFor(
    messageContent: unknown,
    stored: { text?: unknown; lang?: unknown; via?: unknown; same?: unknown } | undefined,
    target: string
): TranslationReport | null {
    if (!stored || typeof stored.text !== "string" || stored.same === true) return null;
    if (typeof messageContent !== "string") return null;
    const original = cleanText(messageContent).slice(0, MAX_REPORT_TEXT_CHARS);
    const translation = cleanText(stored.text).slice(0, MAX_REPORT_TEXT_CHARS);
    if (original.trim() === "" || translation.trim() === "") return null;
    return {
        original,
        translation,
        glyph: stored.via === "google" ? "≈" : "✦",
        source: langOrUnknown(typeof stored.lang === "string" ? stored.lang : undefined),
        target: langOrUnknown(target)
    };
}

/** Recent error codes in the relay's shape: codes, statuses and times only. */
export function errorEntries(recent: ReadonlyArray<{ code: string; at: string; status?: number }>): ErrorCodeEntry[] {
    const out: ErrorCodeEntry[] = [];
    for (const e of recent.slice(-MAX_ERRORS)) {
        if (!ERROR_CODE_RE.test(e.code) || !ISO_RE.test(e.at)) continue;
        // To the minute only: a millisecond time could be matched to one request.
        const at = toMinute(e.at);
        if (at === null) continue;
        const ok = typeof e.status === "number" && Number.isInteger(e.status) && e.status >= 100 && e.status <= 599;
        out.push(ok ? { code: e.code, status: e.status, at } : { code: e.code, at });
    }
    return out;
}

export function osName(platform: string | undefined): OsName {
    const p = (platform ?? "").toLowerCase();
    if (p.startsWith("mac") || p === "darwin") return "mac";
    if (p.startsWith("win")) return "windows";
    if (p.includes("linux")) return "linux";
    return "other";
}

export type BuildError = "empty" | "tooLong" | "badEmail";

/**
 * The one object that is previewed and sent. A message or a ticked report is
 * required; every optional part is present only when ticked.
 */
export function buildPayload(draft: FeedbackDraft, ctx: FeedbackContext): { payload: FeedbackPayload } | { error: BuildError } {
    const message = cleanText(draft.message).trim();
    const email = draft.email.trim();
    const report = draft.include.report && ctx.report ? ctx.report : undefined;
    if (message.length > MAX_MESSAGE_CHARS) return { error: "tooLong" };
    if (message === "" && !report) return { error: "empty" };
    if (email !== "" && !looksLikeEmail(email)) return { error: "badEmail" };
    const payload: FeedbackPayload = { v: 1 };
    if (message !== "") payload.message = message;
    if (email !== "") payload.email = email;
    if (report) payload.report = { ...report };
    const errors = draft.include.errors ? errorEntries(ctx.errors) : [];
    if (errors.length > 0) payload.errors = errors;
    if (draft.include.app) payload.app = { ...ctx.app };
    return { payload };
}

export interface PreviewRow { label: string; value: string }

/** Every field of the payload, in words. Reads the payload and nothing else. */
export function previewRows(p: FeedbackPayload): PreviewRow[] {
    const L = FEEDBACK_COPY.preview;
    const rows: PreviewRow[] = [];
    if (p.message !== undefined) rows.push({ label: L.message, value: p.message });
    rows.push({ label: L.email, value: p.email ?? L.anonymous });
    if (p.report) {
        rows.push({ label: L.original, value: p.report.original });
        rows.push({ label: L.translation, value: p.report.translation });
        rows.push({ label: L.shownAs, value: p.report.glyph === "≈" ? L.google : L.ai });
        rows.push({ label: L.languages, value: `${p.report.source} → ${p.report.target}` });
    }
    if (p.errors) rows.push({ label: L.errors, value: p.errors.map(e => `${e.code}${e.status ? ` (${e.status})` : ""} at ${e.at}`).join("\n") });
    if (p.app) rows.push({ label: L.app, value: `Subline ${p.app.version}, build ${p.app.build}, ${p.app.os}, plan ${p.app.plan}` });
    return rows;
}

export function buildErrorCopy(e: BuildError): string {
    if (e === "tooLong") return FEEDBACK_COPY.errors.tooLong.replace("{max}", MAX_MESSAGE_CHARS.toLocaleString("en-US"));
    return FEEDBACK_COPY.errors[e];
}

/* =============================================================== sending == */

export type SendResult =
    | { ok: true; id: string }
    | { ok: false; error: "rate_limited" | "rejected" | "unavailable" | "network"; status?: number };

export interface SendDeps {
    /** The install bearer (`free_<id>`), as every relay call sends it. */
    install: () => Promise<string>;
    /** The native call. May reject when the native half is missing. */
    send: (install: string, json: string) => Promise<SendResult>;
}

/**
 * Send exactly this payload. Never throws: any failure, including a missing
 * native half or a malformed answer, is a short word for `sendErrorCopy`.
 */
export async function sendPayload(payload: FeedbackPayload, deps: SendDeps): Promise<SendResult> {
    try {
        const install = await deps.install();
        const res = await deps.send(install, JSON.stringify(payload));
        if (res && res.ok === true && typeof res.id === "string") return res;
        if (res && res.ok === false && typeof res.error === "string" && res.error in FEEDBACK_COPY.errors) return res;
        return { ok: false, error: "unavailable" };
    } catch {
        return { ok: false, error: "network" };
    }
}

export function sendErrorCopy(res: SendResult): string {
    return res.ok ? "" : FEEDBACK_COPY.errors[res.error];
}

/* ============================================================ box state == */

export type Phase = "edit" | "review" | "sending" | "sent";

export interface BoxState {
    phase: Phase;
    draft: FeedbackDraft;
    /** Set on entering review, and the only thing Send ever sends. */
    payload: FeedbackPayload | null;
    notice: string | null;
}

export function initialBox(): BoxState {
    return { phase: "edit", draft: emptyDraft(), payload: null, notice: null };
}

/** Review: build the payload once and freeze it. Stays in edit with a notice when the draft is not sendable. */
export function toReview(state: BoxState, ctx: FeedbackContext): BoxState {
    const built = buildPayload(state.draft, ctx);
    if ("error" in built) return { ...state, phase: "edit", payload: null, notice: buildErrorCopy(built.error) };
    return { ...state, phase: "review", payload: built.payload, notice: null };
}

/** After a send: thanks, or back to review with the same payload and draft and a calm notice. */
export function afterSend(state: BoxState, res: SendResult): BoxState {
    if (res.ok) return { phase: "sent", draft: emptyDraft(), payload: null, notice: null };
    return { ...state, phase: "review", notice: sendErrorCopy(res) };
}
