/**
 * The plan panel, the ended panel, the update panel and the code entry:
 * Discord modals.
 *
 * Built on the modal Vencord itself uses (`Modal` + `openModal` from
 * @webpack/common, as in Vencord's own badges plugin at the pinned commit), so
 * no Discord patch is involved. The buttons are the modal's own `actions`.
 * If a modal cannot be shown at all, the pricing page opens instead. Every
 * panel renders inside an ErrorBoundary (guardedOpen): a panel that throws
 * closes, and Discord keeps running.
 *
 * The code field is a plain <input>: its value is read from the closure when
 * Activate is pressed, so the modal needs no React state of its own, and a
 * refusal is said in a toast while the modal stays open for another try.
 */
import { closeModal, Modal, React } from "@webpack/common";

import type { Plan } from "./checkout";
import type { UpdateText } from "./planState";
import { PRICING_URL } from "./freePlan";
import { openGuardedModal } from "./linkPanels";
import { toast } from "./toast";
import { ELSEWHERE_COPY, PLAN_COPY, UPGRADE_COPY } from "./upgradeCopy";

const MUTED = { color: "var(--text-muted)", fontSize: "0.9rem" };

function openPricingInstead(): void {
    (globalThis as any).VencordNative?.native?.openExternal?.(PRICING_URL);
}

/**
 * openModal inside an ErrorBoundary (linkPanels.tsx openGuardedModal): a panel
 * that throws while it renders closes, and never reaches Discord's own
 * top-level boundary. Throws when the modal cannot be opened at all, so the
 * caller's fallback (the pricing page) still runs.
 */
function guardedOpen(render: (props: any) => any): string {
    const key = openGuardedModal(render);
    if (key === null) throw new Error("Subline: the window could not be opened");
    return key;
}

const LINK_STYLE = { cursor: "pointer", color: "var(--text-link, #00a8fc)" } as const;

/**
 * "Pay on another device" (0.2.8): a small link under a buy panel's text, for
 * a computer whose network blocks the payment page. It closes the panel and
 * hands over to `go` (the account confirm, then the link and its QR code).
 */
function ElsewhereLink({ go }: { go?: () => void; }) {
    if (go === undefined) return null;
    return (
        <div style={{ ...MUTED, paddingTop: 8 }}>
            <a role="button" tabIndex={0} style={LINK_STYLE} data-subline-elsewhere="" onClick={(e: any) => { e?.preventDefault?.(); go(); }}>
                {ELSEWHERE_COPY.link}
            </a>
        </div>
    );
}

/* ------------------------------------------------------ open panels -- */

/**
 * The windows Subline opens about the plan (0.2.9): the plan panel that
 * sells ("plan"), the plan panel with nothing to sell ("planInfo": a
 * subscription, a buyer, a payment on its way), the ended panel ("ended")
 * and the update panel ("update").
 */
export type PanelKind = "plan" | "planInfo" | "ended" | "update";

/** Modal key -> kind, for each panel opened and not yet closed by its own buttons. */
const openPanels = new Map<string, PanelKind>();

/** Track a panel by the key openModal returned. Its own buttons call `forget`. */
function track(kind: PanelKind, open: (forget: () => void) => unknown): void {
    let key: unknown;
    const forget = () => { if (typeof key === "string") openPanels.delete(key); };
    key = open(forget);
    if (typeof key === "string") openPanels.set(key, kind);
}

/**
 * Close an open panel (P5: AI switched on under an open plan panel; P4: a
 * payment started under it). Returns whether one was open. A panel the
 * reader already closed by hand is a no-op for Discord's closeModal.
 */
export function closePanel(kind: PanelKind): boolean {
    let closed = false;
    for (const [key, k] of [...openPanels]) {
        if (k !== kind) continue;
        openPanels.delete(key);
        try { closeModal(key); } catch { /* already gone */ }
        closed = true;
    }
    return closed;
}

/* -------------------------------------------------------- plan panel -- */

/** P3: the prices are on the buttons; the body is the coupon line, and "Pay on another device". */
export function PlanPanelBody({ elsewhere }: { elsewhere?: () => void; } = {}) {
    return (
        <div>
            <div style={MUTED}>{UPGRADE_COPY.couponHint}</div>
            <ElsewhereLink go={elsewhere} />
        </div>
    );
}

/** What the plan panel can do. `subscribe` absent: nothing to sell (it shows Enter a code and OK). */
export interface PlanPanelActions {
    /** The plan state in words: the ✦ button's hover text (planState.ts). */
    state: string;
    subscribe?: (plan: Plan) => void;
    /** Absent for a subscription or a buyer: a code would add nothing (the relay refuses it, 409). */
    enterCode?: () => void;
    /** "Pay on another device". */
    elsewhere?: () => void;
    /** A line under the state when there is nothing to sell (a payment on its way). */
    note?: string;
}

/**
 * THE PLAN PANEL (0.2.9 spec, decisions 11 and 15): the one window behind
 * the ✦ button, every Subscribe and every Activate. The state, then $1.99 a
 * month, $19.99 a year and "Enter a code"; "Enter a code" at every level.
 * Every button closes the panel first, then runs.
 */
export function openPlanPanel(a: PlanPanelActions): void {
    const sells = a.subscribe !== undefined;
    try {
        track(sells ? "plan" : "planInfo", forget => guardedOpen((props: any) => {
            const then = (fn: () => void) => () => { forget(); props.onClose(); fn(); };
            const actions: { text: string; variant: string; onClick: () => void; }[] = [];
            if (a.enterCode !== undefined) actions.push({ text: UPGRADE_COPY.enterCodeButton, variant: "secondary", onClick: then(a.enterCode) });
            if (a.subscribe !== undefined) {
                const subscribe = a.subscribe;
                actions.push(
                    { text: UPGRADE_COPY.monthlyButton, variant: "secondary", onClick: then(() => subscribe("monthly")) },
                    { text: UPGRADE_COPY.annualButton, variant: "primary", onClick: then(() => subscribe("annual")) }
                );
            } else {
                actions.push({ text: PLAN_COPY.ok, variant: "primary", onClick: then(() => { }) });
            }
            return (
                <Modal {...props} title={PLAN_COPY.panelTitle} subtitle={a.state} actions={actions}>
                    {sells
                        ? <PlanPanelBody elsewhere={a.elsewhere && then(a.elsewhere)} />
                        : a.note !== undefined ? <div style={MUTED}>{a.note}</div> : null}
                </Modal>
            );
        }));
    } catch {
        openPricingInstead();
    }
}

/* ------------------------------------------------------- ended panel -- */

/**
 * "Your 7 days of AI translation have ended." (decision 12): once per period,
 * at the next channel switch or the next start (index.tsx decides when).
 * $1.99 a month, $19.99 a year, Not now. Never shown again for the period,
 * whichever button (or the X) closes it.
 */
export function openEndedPanel(periodDays: number, subscribe: (plan: Plan) => void): boolean {
    try {
        track("ended", forget => guardedOpen((props: any) => {
            const then = (fn: () => void) => () => { forget(); props.onClose(); fn(); };
            return (
                <Modal
                    {...props}
                    title={PLAN_COPY.endedTitle.replace("{n}", String(periodDays))}
                    subtitle={PLAN_COPY.endedBody}
                    actions={[
                        { text: PLAN_COPY.notNow, variant: "secondary", onClick: then(() => { }) },
                        { text: UPGRADE_COPY.monthlyButton, variant: "secondary", onClick: then(() => subscribe("monthly")) },
                        { text: UPGRADE_COPY.annualButton, variant: "primary", onClick: then(() => subscribe("annual")) }
                    ]}
                />
            );
        }));
        return true;
    } catch {
        // Nothing else opens in its place: it is a reminder, not a sale the reader asked for.
        return false;
    }
}

/* ------------------------------------------------------ update panel -- */

/**
 * The update panel (decision 13): once, on the first start of 0.2.9, with
 * the text for this plan. "What's new" opens the public release notes.
 */
export function openUpdatePanel(u: UpdateText, whatsNew: () => void): boolean {
    try {
        track("update", forget => guardedOpen((props: any) => {
            const then = (fn: () => void) => () => { forget(); props.onClose(); fn(); };
            return (
                <Modal
                    {...props}
                    title={u.title}
                    subtitle={u.text}
                    actions={[
                        ...(u.whatsNew ? [{ text: PLAN_COPY.whatsNew, variant: "secondary", onClick: then(whatsNew) }] : []),
                        { text: PLAN_COPY.ok, variant: "primary", onClick: then(() => { }) }
                    ]}
                />
            );
        }));
        return true;
    } catch {
        return false;
    }
}

/* -------------------------------------------------------- code entry -- */

const INPUT_STYLE = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    marginTop: 8,
    borderRadius: 4,
    border: "1px solid var(--border-subtle, var(--background-modifier-accent, #4e5058))",
    background: "var(--input-background, var(--background-secondary, #1e1f22))",
    color: "var(--text-default, var(--text-normal, #dbdee1))",
    fontSize: "1rem"
} as const;

/**
 * What submitting a code leads to: null (it worked, the modal closes), or the
 * sentence to show (a toast; the modal stays open for another try). 0.2.8:
 * the account it joins is confirmed before the entry opens (the account
 * confirm), so a code that checks out is linked at once, with no "Use this
 * code?" after it.
 */
export type CodeSubmitResult = string | null;

/**
 * The code entry. `submit` gets the typed text; see CodeSubmitResult.
 */
export function openCodeEntry(submit: (text: string) => Promise<CodeSubmitResult>): void {
    // Outside the render function: Discord renders a modal more than once
    // (its open transition), and the typed text must survive that.
    let value = "";
    let busy = false;
    try {
        guardedOpen((props: any) => {
            const go = async () => {
                if (busy) return;
                busy = true;
                try {
                    const result = await submit(value);
                    if (result === null) props.onClose();
                    else toast(result, "failure");
                } finally {
                    busy = false;
                }
            };
            return (
                <Modal
                    {...props}
                    title={UPGRADE_COPY.codeTitle}
                    subtitle={UPGRADE_COPY.codeSubtitle}
                    actions={[
                        { text: UPGRADE_COPY.codeSubmit, variant: "primary", onClick: () => { void go(); } }
                    ]}
                >
                    <input
                        type="text"
                        autoFocus
                        spellCheck={false}
                        placeholder={UPGRADE_COPY.codePlaceholder}
                        style={INPUT_STYLE}
                        onChange={(e: any) => { value = String(e?.target?.value ?? ""); }}
                        onKeyDown={(e: any) => { if (e?.key === "Enter") { e.preventDefault?.(); void go(); } }}
                    />
                </Modal>
            );
        });
    } catch {
        openPricingInstead();
    }
}
