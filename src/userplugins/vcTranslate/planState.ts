import type { Entitlement, Level } from "./entitlement";
import { NEW_DAYS_FALLBACK, type PeriodKind, type PlanAccess } from "./planAccess";
import { PLAN_COPY } from "./upgradeCopy";

/**
 * WHAT THE ✦ BUTTON SAYS (0.2.9 spec, decisions 11 to 13). One view of the
 * plan for the chat-bar ✦, its hover text, the plan panel, Subline →
 * Settings and the ⚡ tooltip, worked out from the relay's last answer
 * (entitlement.ts, planAccess.ts) and the local clock. Pure: no Discord, no
 * storage, no network, so every state can be tested with a fake time.
 *
 * The clock matters twice. A period that ends while Discord runs turns grey
 * at its end, with no relay answer needed (edge case "Period ends while
 * Discord is open"). And the days left are counted here from the end time,
 * so the hover text is right a day after the last answer too. Everything else
 * is the relay's word: a relay that cannot be reached leaves the last state
 * (decision 16), and only the token running out turns it grey.
 */

export type PlanStateName =
    /** ✦ on: a running period. */
    | "period"
    /** ✦ on: the period starts with the first translation. */
    | "not_started"
    /** ✦ on: a subscription, or a buyer of Automatic (AI for good). */
    | "subscribed"
    /** ✦ off: an AI payment is on its way. */
    | "pending"
    /** ✦ off: a period has ended. */
    | "ended"
    /** ✦ off: nothing (a Discord account too young for the 7 days, a subscription that lapsed). */
    | "off"
    /** Not linked to a Discord account: the Link comes first. */
    | "link";

export interface PlanView {
    /** ✦ in colour. */
    on: boolean;
    state: PlanStateName;
    /** The button's hover text (and the plan panel's subtitle). */
    hover: string;
    kind?: PeriodKind;
    periodDays?: number;
    /** A running period only: whole days left, rounded up (1 on the last day). */
    daysLeft?: number;
    /**
     * Which period this is (kind and start), for the once-a-period messages.
     * Absent when there is no period, or it has not started.
     */
    periodId?: string;
}

const DAY_MS = 24 * 60 * 60_000;

export interface PlanInputs {
    entitlement: Entitlement | null;
    /** entitlementLevel(now). */
    level: Level;
    now: number;
    /** The relay said link first (index.tsx linkNeeded). */
    linkNeeded: boolean;
    /** A checkout opened from this computer is being waited for (checkout.ts). */
    paymentPending: boolean;
}

/**
 * The kind and the relay's own start time, which never moves (index.tsx
 * accessOnLocalClock). Without a start, the kind alone: a moved end time
 * would change with every answer's clock skew.
 */
function periodIdOf(a: PlanAccess): string | undefined {
    if (a.kind === undefined) return undefined;
    return a.startedAt === undefined ? a.kind : `${a.kind}:${a.startedAt}`;
}

/** Whole days left before `endsAt`, rounded up, never below 1 while it runs. */
export function daysLeftUntil(endsAt: number, now: number): number {
    return Math.max(1, Math.ceil((endsAt - now) / DAY_MS));
}

export function planView(input: PlanInputs): PlanView {
    if (input.linkNeeded) return { on: false, state: "link", hover: PLAN_COPY.link };
    const a = input.entitlement?.access;
    const on = input.level === "ai";
    const period = a?.kind !== undefined ? { kind: a.kind, periodDays: a.periodDays } : {};
    const periodId = a === undefined ? undefined : periodIdOf(a);
    const owned = a?.state === "subscribed" || a?.state === "buyer";
    // A payment on its way (the relay's word, or a checkout opened here): said
    // first, unless the plan it would buy is already here.
    if (!owned && (a?.state === "pending" || a?.paymentPending === true || (!on && input.paymentPending))) {
        return { on, state: "pending", hover: PLAN_COPY.pending, ...period, ...(periodId ? { periodId } : {}) };
    }
    if (on) {
        if (a === undefined || owned) return { on, state: "subscribed", hover: PLAN_COPY.on };
        if (a.state === "not_started") {
            return { on, state: "not_started", hover: fillDays(PLAN_COPY.notStarted, a.periodDays ?? NEW_DAYS_FALLBACK), ...period };
        }
        if (a.endsAt !== undefined) {
            const daysLeft = daysLeftUntil(a.endsAt, input.now);
            const hover = daysLeft === 1 ? PLAN_COPY.oneDayLeft : fillDays(PLAN_COPY.daysLeft, daysLeft);
            return { on, state: "period", hover, daysLeft, ...period, ...(periodId ? { periodId } : {}) };
        }
        return { on, state: "subscribed", hover: PLAN_COPY.on };
    }
    // ✦ off. A period that ended (the relay said so, or its end has passed
    // here); never because the relay could not be reached.
    const ended = a?.kind !== undefined && (a.state === "ended" || (a.endsAt !== undefined && input.now >= a.endsAt));
    if (ended) return { on, state: "ended", hover: PLAN_COPY.off, ...period, ...(periodId ? { periodId } : {}) };
    return { on, state: "off", hover: PLAN_COPY.off };
}

function fillDays(template: string, n: number): string {
    return template.replace("{n}", String(n));
}

/* ------------------------------------------------ once-a-period messages -- */

/**
 * ONLY TWO MESSAGES PER PERIOD, EACH ONCE (decision 12): the last-day notice
 * and the ended panel. What was shown is kept per computer and per Discord
 * account (index.tsx stores it under the account's key), by period id, so a
 * second computer shows each once too, and a reinstall that keeps Discord's
 * storage shows nothing twice.
 */
export interface PlanNotes {
    lastDay: string[];
    ended: string[];
}

/** How many period ids a list keeps. A Discord account has at most two periods (the 7 days and one promo). */
const NOTES_KEEP = 20;

export function emptyNotes(): PlanNotes {
    return { lastDay: [], ended: [] };
}

/** A stored value, checked. Anything malformed is empty (at worst a message shows once more). */
export function notesFrom(raw: unknown): PlanNotes {
    const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(-NOTES_KEEP) : [];
    if (!raw || typeof raw !== "object") return emptyNotes();
    const o = raw as Record<string, unknown>;
    return { lastDay: list(o.lastDay), ended: list(o.ended) };
}

export function withNote(notes: PlanNotes, which: keyof PlanNotes, id: string): PlanNotes {
    if (notes[which].includes(id)) return notes;
    return { ...notes, [which]: [...notes[which], id].slice(-NOTES_KEEP) };
}

/** "Your AI translation ends tomorrow.": a running period's last day, not shown before for it. */
export function lastDayDue(view: PlanView, notes: PlanNotes): boolean {
    return view.state === "period" && view.daysLeft === 1 && view.periodId !== undefined && !notes.lastDay.includes(view.periodId);
}

/** The ended panel: a period that ended, not shown before for it. Never while a payment is on its way. */
export function endedDue(view: PlanView, notes: PlanNotes): boolean {
    return view.state === "ended" && view.periodId !== undefined && !notes.ended.includes(view.periodId);
}

/* ---------------------------------------------------------- update panel -- */

/**
 * The update panel's text by plan (decision 13), or null while the plan does
 * not match one of the four (not linked yet, a payment on its way, a Discord
 * account too young for the 7 days): then it waits for an answer that does.
 * The promo and no-plan texts say the period starts with the first
 * translation, so they are for a period not started yet only. One already
 * running (started on another computer) has no text in the spec: none.
 */
export interface UpdateText {
    title: string;
    text: string;
    /** A What's new button: only for people who used Subline before. */
    whatsNew: boolean;
}

export function updateTextFor(a: PlanAccess | undefined): UpdateText | null {
    if (a === undefined) return null;
    const update = (text: string): UpdateText => ({ title: PLAN_COPY.updateTitle, text, whatsNew: true });
    if (a.state === "buyer") return update(a.via === "promo" ? PLAN_COPY.update.promoKept : PLAN_COPY.update.buyer);
    // A subscription changes nothing a subscriber needs to know (owner, 2026-10-25).
    if (a.state === "subscribed") return null;
    if (a.state === "not_started") {
        if (a.kind === "promo") return update(PLAN_COPY.update.promo);
        if (a.kind === "new") {
            return { title: PLAN_COPY.welcomeTitle, text: fillDays(PLAN_COPY.update.noPlan, a.periodDays ?? NEW_DAYS_FALLBACK), whatsNew: false };
        }
    }
    return null;
}
