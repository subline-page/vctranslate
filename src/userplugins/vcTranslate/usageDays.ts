import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { PlanStateName } from "./planState";
import { DAY_MS } from "./weeklyNote";

/**
 * THE DAYS SUBLINE WAS USED, and the one review request built on them.
 *
 * A day counts when a real translation reached the screen that day (the same
 * moment the weekly note counts a message, index.tsx's writeResult). Only
 * local calendar days are kept ("2026-11-02"), at most USAGE_DAYS_KEPT of the
 * newest, plus when the first one was counted, when the review request
 * showed, when the last error code was recorded (statusBeacon.ts
 * recordError, so a restart does not forget it), and whether this install
 * is new (`origin`, below). No text, no ids, no languages, no codes. Nothing
 * here is ever sent.
 *
 * THE REVIEW REQUEST ("Is Subline useful to you?") is asked ONCE per computer,
 * ever, and only of someone who keeps using Subline (reviewDue): at least
 * REVIEW_MIN_DAYS different days, at least REVIEW_MIN_AGE_MS after the first,
 * no error code in the last 24 hours (this session's, or the stored last one
 * from an earlier session), a plan that is on and not being sold ("ended",
 * "pending", "off" and "link" never get it; a running period only with at
 * least REVIEW_MIN_DAYS_LEFT days left, so never on its last day, next to
 * the price), and only at a quiet moment (a channel switch, not typing,
 * nothing else shown this session).
 *
 * FEWER NOTICES (owner, 0.2.11). On top of the rules above:
 *  - ONLY A NEW INSTALL. The request is only for an install whose Subline
 *    data began with 0.2.11 or later (`origin: "new"`). This file is new in
 *    0.2.11, so "no usage record yet" cannot tell a new install from an old
 *    one: at the first start without a record, Discord's storage is asked
 *    whether ANY Subline key is there already (readPriorData, issued before
 *    this start writes anything), and so are Vencord's settings
 *    (settingsShowPriorUse: a code, a link, a changed option; they outlive
 *    Discord's storage). None: "new". Any, or a read that fails: "old".
 *    The answer is stored at once, in the record. A record without the
 *    field (a 0.2.11 test build) is "old". Old users never get it.
 *  - NEVER WITHIN REVIEW_NOTICE_QUIET_MS (7 days) OF ANY OTHER SUBLINE
 *    NOTICE OR WINDOW (noteNoticeShown: every Subline notice, the update,
 *    plan and Link windows). The time is kept under its own key, so a notice
 *    shown before the record is read is never lost. A read that fails, or a
 *    damaged value, asks nothing.
 *
 * WHY 4 AND 4. The 7 days start with the first translation, as firstAt does:
 * a rule of 7 days since the first would only ever reach a period that has
 * ended (never asked) and so only subscribers. 4 days in leaves a 7-day
 * period two days (days 5 and 6) when it can come.
 * No incentive and no stars: the store forbids paid or prompted ratings.
 *
 * BIAS TO SILENCE. A stored value that is not ours reads as "already asked",
 * a read that fails asks nothing this session, and the "asked" mark is
 * written BEFORE the request shows: a write that fails shows nothing.
 */

export const USAGE_KEY = "VcTranslate_usage";
/** When a Subline notice or window last showed (epoch ms), kept on its own (noteNoticeShown). */
export const LAST_NOTICE_KEY = "VcTranslate_lastNotice";
/** Every key Subline stores starts with this (the first-start check, readPriorData). */
export const SUBLINE_KEY_PREFIX = USAGE_KEY.slice(0, USAGE_KEY.indexOf("_") + 1);
export const USAGE_DAYS_KEPT = 60;
export const REVIEW_MIN_DAYS = 4;
export const REVIEW_MIN_AGE_MS = 4 * DAY_MS;
/** A running period gets it only with at least this many days left (planState.ts daysLeft, 1 on the last day). */
export const REVIEW_MIN_DAYS_LEFT = 2;
/** No review request within this long of an error code. */
export const REVIEW_ERROR_QUIET_MS = DAY_MS;
/** No review request within this long of another Subline notice or window. */
export const REVIEW_NOTICE_QUIET_MS = 7 * DAY_MS;
/** The stored lastErrorAt is written at most this often (a burst of errors is one write). */
export const ERROR_WRITE_EVERY_MS = 60_000;

export interface Usage {
    /** When the first day was counted (epoch ms), 0 for not yet. */
    firstAt: number;
    /** Distinct local days with a translation shown, oldest first. */
    days: string[];
    /** When the review request showed (epoch ms), 0 for never. */
    askedAt: number;
    /** When the last error code was recorded (epoch ms), 0 for none. */
    lastErrorAt: number;
    /**
     * "new": this install had no Subline data at all when its record was
     * first made (0.2.11 or later). "old": anything else, also a record made
     * before this field existed. Only "new" may get the review request.
     */
    origin: "new" | "old";
}

/** The plan states that may get the review request: ✦ is on and nothing is being sold. */
export const REVIEW_PLAN_STATES: readonly PlanStateName[] = ["period", "subscribed", "not_started"];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function freshUsage(origin: Usage["origin"] = "old"): Usage {
    return { firstAt: 0, days: [], askedAt: 0, lastErrorAt: 0, origin };
}

/** The local calendar day of `now`, "YYYY-MM-DD" (the reader's own midnight, not UTC). */
export function localDay(now: number): string {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The stored value, re-validated rather than trusted. Nothing stored is a
 * fresh start ("old" until loadUsage decides). Anything that is not our
 * shape counts as asked already, so a damaged value can never lead to a
 * second request.
 */
export function parseUsage(raw: unknown, now: number): Usage {
    if (raw === undefined || raw === null) return freshUsage();
    if (typeof raw !== "object" || Array.isArray(raw)) return { ...freshUsage(), askedAt: now };
    const r = raw as Partial<Record<keyof Usage, unknown>>;
    const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    const days = Array.isArray(r.days)
        ? [...new Set(r.days.filter((d): d is string => typeof d === "string" && DAY_RE.test(d)))].sort().slice(-USAGE_DAYS_KEPT)
        : [];
    // An askedAt that is there but not a time: damaged, so asked.
    const askedAt = r.askedAt === undefined || r.askedAt === 0 ? 0 : time(r.askedAt) || now;
    // The same for lastErrorAt: damaged reads as an error just now.
    const lastErrorAt = r.lastErrorAt === undefined || r.lastErrorAt === 0 ? 0 : time(r.lastErrorAt) || now;
    // Only the exact "new" is new: missing (a record from before the field) or damaged is old.
    const origin = r.origin === "new" ? "new" : "old";
    return { firstAt: time(r.firstAt), days, askedAt, lastErrorAt, origin };
}

/** `usage` with today counted. The same object back when today is counted already. */
export function withDay(usage: Usage, now: number): Usage {
    const day = localDay(now);
    const firstAt = usage.firstAt > 0 ? usage.firstAt : now;
    if (usage.days.includes(day) && firstAt === usage.firstAt) return usage;
    const days = usage.days.includes(day) ? usage.days : [...usage.days, day].sort().slice(-USAGE_DAYS_KEPT);
    return { ...usage, firstAt, days };
}

export interface ReviewInputs {
    usage: Usage | null;
    now: number;
    plan: PlanStateName;
    /** A running period's whole days left (planState.ts PlanView.daysLeft). */
    daysLeft?: number;
    /** The times of this session's recent error codes (recentErrors.ts), ISO. */
    errorTimes: readonly string[];
    /** The reader is typing right now. */
    typing: boolean;
    /** A window or another ask already showed this session. */
    busySession: boolean;
    /**
     * When a Subline notice or window last showed (lastNoticeTime()): 0 for
     * never, null when that is not known (nothing is asked).
     */
    lastNoticeAt: number | null;
}

/** Is the review request due now? Pure. */
export function reviewDue(i: ReviewInputs): boolean {
    const u = i.usage;
    if (u === null || u.askedAt > 0 || i.typing || i.busySession) return false;
    // Only an install whose Subline began on 0.2.11 or later.
    if (u.origin !== "new") return false;
    // Never within 7 days of another Subline notice or window, one "in the future" too.
    if (typeof i.lastNoticeAt !== "number" || !Number.isFinite(i.lastNoticeAt)) return false;
    if (i.lastNoticeAt > 0 && i.now - i.lastNoticeAt < REVIEW_NOTICE_QUIET_MS) return false;
    if (!REVIEW_PLAN_STATES.includes(i.plan)) return false;
    // A period with no days left known, or on its last day: not due.
    if (i.plan === "period" && !(typeof i.daysLeft === "number" && i.daysLeft >= REVIEW_MIN_DAYS_LEFT)) return false;
    if (u.days.length < REVIEW_MIN_DAYS) return false;
    // A clock set back puts `now` before the first day: not due.
    if (u.firstAt <= 0 || i.now - u.firstAt < REVIEW_MIN_AGE_MS) return false;
    // An error from an earlier session (the stored one), "in the future" too.
    if (u.lastErrorAt > 0 && i.now - u.lastErrorAt < REVIEW_ERROR_QUIET_MS) return false;
    for (const at of i.errorTimes) {
        const t = Date.parse(at);
        // An error "in the future" (the clock moved back) is recent too.
        if (Number.isFinite(t) && i.now - t < REVIEW_ERROR_QUIET_MS) return false;
    }
    return true;
}

/* ------------------------------------------------------- the stored one -- */

/** The storage this uses: Vencord's DataStore, or a test's. `keys` lists every stored key (the first-start check). */
export interface UsageStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    keys?(): Promise<unknown[]>;
}

const logger = new Logger("VcTranslate");

const DATASTORE: UsageStore = {
    get: key => DataStore.get(key),
    set: (key, value) => DataStore.set(key, value),
    keys: () => DataStore.keys()
};

let usage: Usage | null = null;
let store: UsageStore = DATASTORE;
/** When lastErrorAt was last written (noteUsageError), 0 for not this session. */
let errorWrittenAt = 0;
/**
 * The newest Subline notice or window known: this session's (noteNoticeShown)
 * or the stored one. Never cleared by loadUsage: a notice can show before
 * the stored value is read.
 */
let lastNoticeAt = 0;
/** The stored lastNoticeAt was read (loadUsage). Until then, and after a read that failed, nothing is asked. */
let lastNoticeKnown = false;

/**
 * IS THERE SUBLINE DATA FROM BEFORE? Asked at the very top of start(), before
 * this start writes anything (Vencord's DataStore runs its transactions in
 * the order they are asked for, so a read asked first sees the store as it
 * was). True: some Subline key other than the usage record is there. False:
 * none. Null: it cannot be told (no keys() in this Vencord, a read that
 * fails, an answer that is not a list), which loadUsage reads as "old".
 */
export async function readPriorData(from: UsageStore = DATASTORE): Promise<boolean | null> {
    try {
        if (typeof from.keys !== "function") return null;
        const all = await from.keys();
        if (!Array.isArray(all)) return null;
        return all.some(k => typeof k === "string" && k.startsWith(SUBLINE_KEY_PREFIX) && k !== USAGE_KEY);
    } catch (e) {
        logger.warn(`whether Subline was used here before could not be read: ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}

/**
 * The plugin settings the installer writes on a FRESH install (the install
 * id, the reading language, the relay engine): never a sign of use. A code
 * pasted in the installer is one, on purpose: it cannot be told from the
 * code of an existing user whose Discord data was cleared, and an existing
 * user must never get the request.
 */
export const INSTALLER_SEEDED_SETTINGS: readonly string[] = ["installId", "targetLang", "engine"];

/** A setting's value as compared: nothing, "" and null are the same. */
function settingShape(v: unknown): string {
    if (v === undefined || v === null || v === "") return "";
    try {
        return JSON.stringify(v) ?? "";
    } catch {
        return "?";
    }
}

/**
 * IS THERE USE IN THE SETTINGS? Vencord's settings file outlives Discord's
 * own storage (Discord's data cleared, a new Discord profile, Discord
 * reinstalled): an existing user may have no DataStore key left at all.
 * True when any of this plugin's settings with a default differs from it (a
 * saved or cleared code, a link binding, an account's codes, an old trial,
 * the owner's off switch, a changed option), or the engine is not the
 * relay. The installer's own seeds do not count (INSTALLER_SEEDED_SETTINGS).
 * Anything that cannot be read counts as use. Pure: `values` is the
 * plugin's settings as stored, `defs` their definitions.
 */
export function settingsShowPriorUse(values: unknown, defs: unknown, relayEngine = "relay"): boolean {
    try {
        if (values === null || typeof values !== "object") return true;
        if (defs === null || typeof defs !== "object") return true;
        const v = values as Record<string, unknown>;
        const { engine } = v;
        if (engine !== undefined && engine !== null && engine !== "" && engine !== relayEngine) return true;
        for (const [key, def] of Object.entries(defs as Record<string, unknown>)) {
            if (INSTALLER_SEEDED_SETTINGS.includes(key)) continue;
            if (def === null || typeof def !== "object" || !("default" in def)) continue;
            if (!(key in v)) continue;
            if (settingShape(v[key]) !== settingShape((def as { default: unknown; }).default)) return true;
        }
        return false;
    } catch {
        return true;
    }
}

/**
 * readPriorData's answer and the settings' (settingsShowPriorUse, read at
 * the same moment): use in either is use. Both are read before this start
 * writes anything.
 */
export async function priorUse(settingsUse: boolean, data: Promise<boolean | null>): Promise<boolean | null> {
    if (settingsUse) return true;
    try {
        return await data;
    } catch {
        return null;
    }
}

/** A stored lastNoticeAt: a time, 0 for never; anything else is damaged and reads as just now. */
function parseNoticeTime(raw: unknown, now: number): number {
    if (raw === undefined || raw === null || raw === 0) return 0;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : now;
}

/**
 * Read the stored days, and the last notice's time. A read that fails leaves
 * nothing loaded: nothing counts and nothing is asked this session.
 *
 * `prior`: readPriorData's answer, asked at the top of start(). Used only
 * when there is no record yet: then the record is made, "new" only when the
 * answer is exactly false, and stored at once (a later start would see this
 * start's own keys as data from before).
 */
export async function loadUsage(now: number = Date.now(), from: UsageStore = DATASTORE, prior?: Promise<boolean | null>): Promise<void> {
    store = from;
    usage = null;
    errorWrittenAt = 0;
    lastNoticeKnown = false;
    try {
        const stored = parseNoticeTime(await from.get(LAST_NOTICE_KEY), now);
        lastNoticeAt = Math.max(lastNoticeAt, stored);
        lastNoticeKnown = true;
    } catch (e) {
        logger.warn(`the last notice time could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
    let raw: unknown;
    try {
        raw = await from.get(USAGE_KEY);
    } catch (e) {
        logger.warn(`the days used could not be read: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    if (raw !== undefined && raw !== null) {
        usage = parseUsage(raw, now);
        return;
    }
    let hadData: boolean | null = null;
    try {
        hadData = prior === undefined ? null : await prior;
    } catch {
        hadData = null;
    }
    const first = freshUsage(hadData === false ? "new" : "old");
    usage = first;
    try {
        await from.set(USAGE_KEY, { ...first, days: [...first.days] });
    } catch (e) {
        // Kept in memory: the next start cannot tell any more and reads "old".
        logger.warn(`the first usage record could not be stored: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** Count today, once per day. Never throws, never waits. */
export function noteUsageDay(now: number = Date.now()): void {
    if (usage === null) return;
    const next = withDay(usage, now);
    if (next === usage) return;
    usage = next;
    // A lost write costs one day of the count.
    void store.set(USAGE_KEY, { ...next, days: [...next.days] }).catch(() => { });
}

/**
 * An error code was recorded (statusBeacon.ts recordError): keep its time, so
 * the review request waits a day even across a restart. Stored at most once
 * a minute; the time in memory is always the newest. Never throws, never waits.
 */
export function noteUsageError(now: number = Date.now()): void {
    if (usage === null) return;
    usage = { ...usage, lastErrorAt: now };
    // A clock set back (now before the last write) writes again.
    if (errorWrittenAt > 0 && now >= errorWrittenAt && now - errorWrittenAt < ERROR_WRITE_EVERY_MS) return;
    errorWrittenAt = now;
    void store.set(USAGE_KEY, { ...usage, days: [...usage.days] }).catch(e => {
        // A lost write: a restart within the day may ask a day early.
        logger.warn(`the last error time could not be stored: ${e instanceof Error ? e.message : String(e)}`);
    });
}

/**
 * A Subline notice or window showed (sublineNotice.ts putNotice, index.tsx
 * noteWindowShown and its other notices): the review request waits 7 days
 * from now. Works before loadUsage too (kept in memory and stored at once).
 * Never throws, never waits.
 */
export function noteNoticeShown(now: number = Date.now()): void {
    // A clock set back keeps the newer time: "in the future" is recent too.
    if (Number.isFinite(now) && now > lastNoticeAt) lastNoticeAt = now;
    try {
        void store.set(LAST_NOTICE_KEY, lastNoticeAt).catch(e => {
            // A lost write: a restart may ask within the 7 days of this notice.
            logger.warn(`the last notice time could not be stored: ${e instanceof Error ? e.message : String(e)}`);
        });
    } catch (e) {
        logger.warn(`the last notice time could not be stored: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** When a Subline notice or window last showed: 0 for never, null while that is not known. */
export function lastNoticeTime(): number | null {
    return lastNoticeKnown ? lastNoticeAt : null;
}

export function currentUsage(): Usage | null {
    return usage === null ? null : { ...usage, days: [...usage.days] };
}

/**
 * Mark the review request as shown, BEFORE it shows. True only when the mark
 * is stored: the caller shows nothing otherwise. Either way it is not asked
 * again this session.
 */
export async function markReviewAsked(now: number = Date.now()): Promise<boolean> {
    if (usage === null) return false;
    usage = { ...usage, askedAt: now };
    try {
        await store.set(USAGE_KEY, { ...usage, days: [...usage.days] });
        return true;
    } catch (e) {
        logger.warn(`the review request was not shown: its mark could not be stored: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}

/** Tests and stop(). */
export function __resetUsage(): void {
    usage = null;
    store = DATASTORE;
    errorWrittenAt = 0;
    lastNoticeAt = 0;
    lastNoticeKnown = false;
}
