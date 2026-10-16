/**
 * The Activate panel, the Add AI panel and the code entry: Discord modals.
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
import { PRICING_URL } from "./freePlan";
import { openGuardedModal } from "./linkPanels";
import { toast } from "./toast";
import { ELSEWHERE_COPY, UPGRADE_COPY } from "./upgradeCopy";

const ROW = { display: "flex", justifyContent: "space-between", padding: "8px 0", color: "var(--text-default, var(--text-normal))" };
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

/** The panels that sell something, and the payment-pending panel shown in their place. */
export type PanelKind = "addAi" | "activate" | "pending";

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
 * Close an open panel (P5: AI switched on under an open Add AI panel; P4: a
 * payment started under a buy panel). Returns whether one was open. A panel
 * the reader already closed by hand is a no-op for Discord's closeModal.
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

/* ------------------------------------------------------------ Add AI -- */

/** P3: the prices are on the buttons; the body is the coupon line, and "Pay on another device". */
export function UpgradePanelBody({ elsewhere }: { elsewhere?: () => void; } = {}) {
    return (
        <div>
            <div style={MUTED}>{UPGRADE_COPY.couponHint}</div>
            <ElsewhereLink go={elsewhere} />
        </div>
    );
}

/**
 * The Add AI panel, for an Automatic owner. `choose` runs after the panel
 * closes; `elsewhere` is "Pay on another device".
 */
export function openUpgradePanel(choose: (plan: Plan) => void, elsewhere?: () => void): void {
    try {
        track("addAi", forget => guardedOpen((props: any) => (
            <Modal
                {...props}
                title={UPGRADE_COPY.panelTitle}
                subtitle={UPGRADE_COPY.panelSubtitle}
                actions={[
                    { text: UPGRADE_COPY.monthlyButton, variant: "secondary", onClick: () => { forget(); props.onClose(); choose("monthly"); } },
                    { text: UPGRADE_COPY.annualButton, variant: "primary", onClick: () => { forget(); props.onClose(); choose("annual"); } }
                ]}
            >
                <UpgradePanelBody elsewhere={elsewhere && (() => { forget(); props.onClose(); elsewhere(); })} />
            </Modal>
        )));
    } catch {
        openPricingInstead();
    }
}

/**
 * In place of the Add AI or Activate panel while a payment is on its way (P4):
 * "Payment being confirmed", what happens next, and OK. Nothing to buy.
 */
export function openPaymentPendingPanel(): void {
    try {
        track("pending", forget => guardedOpen((props: any) => (
            <Modal
                {...props}
                title={UPGRADE_COPY.paymentPending}
                subtitle={UPGRADE_COPY.purchasePending}
                actions={[
                    { text: UPGRADE_COPY.purchasedNoticeButton, variant: "primary", onClick: () => { forget(); props.onClose(); } }
                ]}
            />
        )));
    } catch {
        openPricingInstead();
    }
}

/* ---------------------------------------------------------- Activate -- */

export function ActivatePanelBody({ elsewhere }: { elsewhere?: () => void; } = {}) {
    return (
        <div>
            <div style={ROW}>
                <strong>{UPGRADE_COPY.automaticName}</strong>
                <span>{UPGRADE_COPY.automaticPrice}</span>
            </div>
            <div style={MUTED}>{UPGRADE_COPY.automaticNote}</div>
            <div style={{ ...MUTED, paddingTop: 8 }}>{UPGRADE_COPY.panelFootnote}</div>
            <ElsewhereLink go={elsewhere} />
        </div>
    );
}

/**
 * The Activate panel, for an install with nothing: buy Automatic, or enter a
 * code; `elsewhere` is "Pay on another device".
 */
export function openActivatePanel(actions: { buy: () => void; enterCode: () => void; elsewhere?: () => void; }): void {
    try {
        track("activate", forget => guardedOpen((props: any) => (
            <Modal
                {...props}
                title={UPGRADE_COPY.activateTitle}
                subtitle={UPGRADE_COPY.activateSubtitle}
                actions={[
                    { text: UPGRADE_COPY.enterCodeButton, variant: "secondary", onClick: () => { forget(); props.onClose(); actions.enterCode(); } },
                    { text: UPGRADE_COPY.automaticButton, variant: "primary", onClick: () => { forget(); props.onClose(); actions.buy(); } }
                ]}
            >
                <ActivatePanelBody elsewhere={actions.elsewhere && (() => { forget(); props.onClose(); actions.elsewhere!(); })} />
            </Modal>
        )));
    } catch {
        openPricingInstead();
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
