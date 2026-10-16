/**
 * Lets settings.ts (and anything else that must not import index.tsx) open
 * the Activate / Add AI panel and the code entry. index.tsx registers the
 * openers on start() and clears them on stop(). With no opener (plugin
 * stopped) the pricing page opens instead, so a link is never a dead click.
 */
import { PRICING_URL } from "./freePlan";

let opener: (() => void) | null = null;
let codeOpener: (() => void) | null = null;
let linkOpener: (() => void) | null = null;
/**
 * Move my plan (0.2.8): the opener, and whether this account may move its
 * plan from here; and, on the new account while a move waits for it, the
 * window that finishes it.
 */
interface Mover { move: () => void; canMove: () => boolean; finish?: () => void; canFinish?: () => boolean; }
let mover: Mover | null = null;

export function registerUpgradeOpener(
    fn: (() => void) | null, codeFn: (() => void) | null = null, linkFn: (() => void) | null = null,
    moveFns: Mover | null = null
): void {
    opener = fn;
    codeOpener = codeFn;
    linkOpener = linkFn;
    mover = moveFns;
}

function pricing(): void {
    (globalThis as any).VencordNative?.native?.openExternal?.(PRICING_URL);
}

/** The Activate panel (not activated) or the Add AI panel (Automatic). */
export function openUpgrade(): void {
    if (opener !== null) opener();
    else pricing();
}

/** The code entry, from the settings page's "Enter a code". */
export function openCodeEntryFromSettings(): void {
    if (codeOpener !== null) codeOpener();
    else pricing();
}

/**
 * Discord's Authorize window, from the settings page's "Link". With the
 * plugin stopped there is nothing to link with, so nothing opens.
 */
export function openLinkFromSettings(): void {
    linkOpener?.();
}

/**
 * Settings → Plan → "Move my plan to another Discord account": shown only
 * when this account may move its plan from this computer (a linked computer
 * of the account that has it). Never throws; false with the plugin stopped.
 */
export function canMoveFromSettings(): boolean {
    try {
        return mover?.canMove() === true;
    } catch {
        return false;
    }
}

export function openMoveFromSettings(): void {
    mover?.move();
}

/**
 * Settings → Plan → "Finish moving your plan here": on another account while
 * a move started on this computer waits for it (its window was put away, or
 * the finish can be tried again). Never throws; false with the plugin stopped.
 */
export function canFinishMoveFromSettings(): boolean {
    try {
        return mover?.canFinish?.() === true;
    } catch {
        return false;
    }
}

export function openFinishMoveFromSettings(): void {
    mover?.finish?.();
}

/* ------------------------------------------------- payment on its way -- */

/**
 * P4. True while a payment from this install is on its way: a checkout page
 * was opened and the plugin is waiting for it, or the relay answered
 * purchase_pending. Meanwhile every place that sells (the plan card, the ⚡
 * popover, the ✦ preview line, the panel) says "Payment being confirmed"
 * and offers no second purchase. Set by the checkout flow (index.tsx).
 */
let paymentPending = false;
const pendingListeners = new Set<() => void>();

export function setPaymentPending(next: boolean): void {
    if (next === paymentPending) return;
    paymentPending = next;
    for (const fn of [...pendingListeners]) {
        try { fn(); } catch { /* a listener's failure is its own */ }
    }
}

export function isPaymentPending(): boolean {
    return paymentPending;
}

export function subscribePaymentPending(fn: () => void): () => void {
    pendingListeners.add(fn);
    return () => { pendingListeners.delete(fn); };
}

/* ------------------------------------------- Subline's Settings on screen -- */

/**
 * How many plan cards are mounted: Subline's Settings is on screen while
 * this is above zero. Discord draws a toast UNDER that page (the old
 * "Copied" toast was never seen there), so while it shows, the outcome of a
 * Link, Buy, Add AI, code or Move opens a window instead (index.tsx
 * sayResult), which is always on top. The plan card counts itself in on
 * mount and out on unmount (settings.ts PlanCard).
 */
let settingsCards = 0;

/** A plan card mounted: returns its unmount, which counts it out once. */
export function noteSettingsShown(): () => void {
    settingsCards++;
    let gone = false;
    return () => {
        if (gone) return;
        gone = true;
        settingsCards = Math.max(0, settingsCards - 1);
    };
}

/** Subline's Settings is on screen now (a plan card is mounted). */
export function settingsShowing(): boolean {
    return settingsCards > 0;
}
