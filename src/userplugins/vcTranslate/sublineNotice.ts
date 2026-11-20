import { currentNotice, noticesQueue, popNotice, showNotice } from "@api/Notices";
import { Logger } from "@utils/Logger";

import { noteNoticeShown } from "./usageDays";

const logger = new Logger("VcTranslate");

/**
 * Subline's own notices (the activation notice, the "checking" notice, the
 * app update notice, the Link bar of a prior payer, 0.2.8, the
 * "translation paused until tomorrow" notice and the last-day notice, 0.2.9,
 * and the review request, usageDays.ts),
 * tracked by whether THEY are still there, not by a flag.
 *
 * WHY. Vencord's notices are one FIFO queue, and `popNotice()` dismisses
 * whatever notice is on screen. The old code assumed its own notice was that
 * one: when the reader had closed it with its X, a later "take it down"
 * dismissed someone else's (the once-a-session "restart for the update"
 * banner), and every Activate click queued another identical device-limit
 * notice the reader had to dismiss one by one.
 *
 * Each notice is found by its button callback, a function made fresh for
 * every show, so an identity check finds exactly ours. A notice is "present"
 * while it is on screen or still queued; the X removes it from both without
 * calling anything, which is how a close by hand is seen.
 *
 * VENCORD 1.15.18+ (main 4611397, "fix & improve Notices"). Discord removed
 * the GENERIC notice type Vencord used, so no Vencord notice rendered at all
 * (Stable, PTB and Canary, 2026-11). Since that fix a queued or current
 * notice is one object, { id, type: "VencordNotice", message, buttonText,
 * callback }, `currentNotice` is that object or undefined, and `popNotice()`
 * is async (Discord's NoticeStore takes the notice down through a Flux
 * dispatch; installer/scripts/vencordRewrites.mjs fixes two upstream bugs in
 * it, UPSTREAM_PATCH_FIXES). The callback is still the identity.
 */
export type NoticeSlot = "activation" | "checking" | "appUpdate" | "link" | "paused" | "plan" | "review";

/** What this file reads of a Vencord notice: its button callback. */
interface VencordNoticeEntry { callback?: unknown; }

/** What Subline gives Vencord's showNotice (the one-object form; the three-argument form is deprecated). */
interface NoticeInput { message: unknown; buttonText: string; callback: () => void; }

/**
 * Vencord's showNotice, the one-object form. Cast because the type check
 * (tsconfig.json) may read an older Vencord whose showNotice takes three
 * arguments; the build always uses the pinned Vencord, which takes this.
 */
const show = showNotice as unknown as (notice: NoticeInput) => void;

const mine: Record<NoticeSlot, { cb: () => void; text: string; } | null> = { activation: null, checking: null, appUpdate: null, link: null, paused: null, plan: null, review: null };

/**
 * A Subline notice was put up this session, even one the reader has closed
 * since: the two asks (index.tsx checkAsks) never come in such a session,
 * and a notice closed with its X is no longer "present".
 */
let shownThisSession = false;

const callbackOf = (entry: unknown): unknown =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry) ? (entry as VencordNoticeEntry).callback : undefined;

function queue(): unknown[] {
    return Array.isArray(noticesQueue) ? noticesQueue as unknown[] : [];
}

/**
 * Take down the notice whose button is `cb`: the one on screen (Vencord then
 * shows the next) or one still queued. Nothing when it is neither: it never
 * dismisses a notice that is not this one.
 */
function dropNotice(cb: unknown): void {
    if (callbackOf(currentNotice) === cb) {
        // Async since Vencord 1.15.18. Discord's store takes it down within
        // the same dispatch; a failure is logged, never thrown at the caller.
        void Promise.resolve(popNotice()).catch(e => logger.error("Could not take a Subline notice down", e));
        return;
    }
    const q = queue();
    const at = q.findIndex(e => callbackOf(e) === cb);
    if (at >= 0) q.splice(at, 1);
}

/** Is this slot's notice on screen or waiting in the queue? */
export function noticePresent(slot: NoticeSlot): boolean {
    const m = mine[slot];
    if (m === null) return false;
    return callbackOf(currentNotice) === m.cb || queue().some(e => callbackOf(e) === m.cb);
}

/** The text this slot's notice is showing, "" for none. */
export function noticeShowing(slot: NoticeSlot): string {
    return noticePresent(slot) ? mine[slot]!.text : "";
}

/** Take this slot's notice down. Never dismisses a notice that is not ours. */
export function takeNotice(slot: NoticeSlot): void {
    const m = mine[slot];
    mine[slot] = null;
    if (m === null) return;
    dropNotice(m.cb);
}

/**
 * Show `text` in this slot. Nothing when the same text is already there. Once
 * the reader has closed it, the same text is not shown again this session
 * unless `force` (they pressed something that asks for it).
 *
 * `display` replaces `text` on screen when given (a node with an inline link,
 * appNotice.ts's "Later"); `text` stays the identity used above.
 */
export function putNotice(
    slot: NoticeSlot, text: string, button: string, onClick: () => void, force = false, display?: unknown
): void {
    const m = mine[slot];
    if (m !== null && m.text === text && (noticePresent(slot) || !force)) return;
    takeNotice(slot);
    const cb = () => onClick();
    mine[slot] = { cb, text };
    shownThisSession = true;
    // The review request waits 7 days after any Subline notice (usageDays.ts).
    noteNoticeShown();
    show({ message: display ?? text, buttonText: button, callback: cb });
}

/**
 * A notice outside the slots (index.tsx: the update, the purchase and the
 * add-on reload notices). Its button runs `onClick` with a function that
 * takes exactly this notice down, never another one.
 */
export function showLooseNotice(message: unknown, button: string, onClick: (takeDown: () => void) => void): void {
    const cb = () => onClick(takeDown);
    const takeDown = () => dropNotice(cb);
    show({ message, buttonText: button, callback: cb });
}

/** Did a Subline notice show this session (closed since or not)? */
export function noticeShownThisSession(): boolean {
    return shownThisSession;
}

/** Forget every slot without touching the screen (stop()), and the session with them. */
export function forgetNotices(): void {
    shownThisSession = false;
    mine.activation = null;
    mine.checking = null;
    mine.appUpdate = null;
    mine.link = null;
    mine.paused = null;
    mine.plan = null;
    mine.review = null;
}
