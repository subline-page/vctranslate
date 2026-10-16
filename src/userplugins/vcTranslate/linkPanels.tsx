/**
 * The 0.2.8 linking windows: the account confirm, "Use another account",
 * the pairing code of the browser fallback, Move my plan, and "Pay on another
 * device" with its QR code.
 *
 * Built on the modal Vencord itself uses (`Modal` + `openModal` from
 * @webpack/common, as upgradePanel.tsx). NEVER A CRASH: every window renders
 * inside an ErrorBoundary that closes it and calls `onCrash` instead of
 * letting an error reach Discord's own top-level boundary ("Well, this is
 * awkward"), exactly as link.ts guards Discord's Authorize window. A window
 * that cannot be opened at all says so (false) and the caller falls back.
 *
 * Every button is in the modal's own `actions`. Copy: upgradeCopy.ts. Names
 * and avatars come from Discord's local UserStore and are never sent.
 */
import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, Modal, openModal, React } from "@webpack/common";

import { qrMatrix, qrSvgPath, qrViewSize } from "./qr";
import { ACCOUNT_COPY, ELSEWHERE_COPY, FALLBACK_COPY, MOVE_COPY, UPGRADE_COPY } from "./upgradeCopy";

const MUTED = { color: "var(--text-muted)", fontSize: "0.9rem" };
const NORMAL = { color: "var(--text-default, var(--text-normal))" };

/** "{name}" and friends filled in. */
export function fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Who a window names: the signed-in Discord account, read locally. */
export interface AccountView {
    name: string;
    /** Discord's avatar URL for the account, when Discord gave one. */
    avatarUrl?: string;
}

/** Called when a window crashed and was closed (the error and where, for the log). */
export type CrashHandler = (error: unknown, componentStack: string) => void;

let onCrash: CrashHandler | null = null;

/** index.tsx: what to do when one of these windows crashes (log it, record an error code). */
export function setPanelCrashHandler(handler: CrashHandler | null): void {
    onCrash = handler;
}

const quietly = (run: () => void) => {
    try { run(); } catch { /* a handler's failure is its own */ }
};

/**
 * Open a modal inside an ErrorBoundary. Returns its key, or null when it
 * could not be opened at all. `onClosed` runs however it closes (a button,
 * its X, Escape, a click outside: Discord's onCloseCallback).
 */
export function openGuardedModal(render: (props: any) => any, onClosed?: () => void): string | null {
    let key: string | null = null;
    try {
        key = openModal((props: any) => React.createElement(ErrorBoundary as any, {
            noop: true,
            onError: ({ error, errorInfo }: { error: unknown; errorInfo?: { componentStack?: string; }; }) => {
                quietly(() => { if (key !== null) closeModal(key); });
                quietly(() => onCrash?.(error, typeof errorInfo?.componentStack === "string" ? errorInfo.componentStack : ""));
            }
        }, render(props)), onClosed ? { onCloseCallback: () => quietly(onClosed) } : undefined);
        return key;
    } catch {
        return null;
    }
}

function Avatar({ url }: { url?: string; }) {
    if (typeof url !== "string" || !/^https:\/\//.test(url)) return null;
    return <img src={url} alt="" width={40} height={40} style={{ borderRadius: "50%", flex: "0 0 auto" }} />;
}

/* --------------------------------------------------- the account confirm -- */

/**
 * "This plan will belong to @name" with the avatar, before anything binds.
 * `yes` runs after the window closes, inside the click (so a browser tab can
 * still open there). "Use another account" explains how to switch and stores
 * nothing. Returns false when nothing could be shown (the caller binds
 * nothing then).
 */
export function openAccountConfirm(who: AccountView, handlers: { yes: () => void; other?: () => void; }): boolean {
    let done = false;
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={fill(ACCOUNT_COPY.confirmTitle, { name: who.name })}
            actions={[
                {
                    text: ACCOUNT_COPY.other, variant: "secondary", onClick: () => {
                        if (done) return;
                        done = true;
                        props.onClose();
                        quietly(() => handlers.other?.());
                        openUseAnotherAccount();
                    }
                },
                {
                    text: fill(ACCOUNT_COPY.yes, { name: who.name }), variant: "primary", onClick: () => {
                        if (done) return;
                        done = true;
                        props.onClose();
                        handlers.yes();
                    }
                }
            ]}
        >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Avatar url={who.avatarUrl} />
                <div style={NORMAL}>{ACCOUNT_COPY.confirmBody}</div>
            </div>
        </Modal>
    )) !== null;
}

/** "Switch to that account in Discord (click your avatar, bottom left), then open Subline's Settings." */
export function openUseAnotherAccount(): boolean {
    return openMessage(ACCOUNT_COPY.otherTitle, ACCOUNT_COPY.otherBody);
}

/**
 * A short message with OK. Used where a toast could be drawn under Subline's
 * Settings and never seen (the old "Copied" toast): a window is always on top.
 */
export function openMessage(title: string, text: string): boolean {
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={title}
            actions={[{ text: ACCOUNT_COPY.ok, variant: "primary", onClick: () => props.onClose() }]}
        >
            <div style={NORMAL}>{text}</div>
        </Modal>
    )) !== null;
}

/* ------------------------------------------------------ the pairing code -- */

const INPUT_STYLE = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    marginTop: 8,
    borderRadius: 4,
    border: "1px solid var(--border-subtle, var(--background-modifier-accent, #4e5058))",
    background: "var(--input-background, var(--background-secondary, #1e1f22))",
    color: "var(--text-default, var(--text-normal, #dbdee1))",
    fontSize: "1.2rem",
    letterSpacing: "0.1em"
} as const;

/** The 6 digits typed, spaces dropped, or null when it is not 6 digits. */
export function cleanPair(typed: string): string | null {
    const digits = typed.replace(/\s+/g, "");
    return /^[0-9]{6}$/.test(digits) ? digits : null;
}

/**
 * "Type the code from your browser". Resolves the 6 digits, or null when the
 * window was closed (or could not open). `triesLeft` after a wrong code.
 */
export function askPairCode(triesLeft: number | null): Promise<string | null> {
    return new Promise(resolve => {
        let value = "";
        let settled = false;
        const settle = (v: string | null) => {
            if (settled) return;
            settled = true;
            resolve(v);
        };
        const key = openGuardedModal(props => {
            const submit = () => {
                const digits = cleanPair(value);
                if (digits === null) return;
                settle(digits);
                props.onClose();
            };
            return (
                <Modal
                    {...props}
                    title={FALLBACK_COPY.pairTitle}
                    subtitle={triesLeft === null ? FALLBACK_COPY.pairBody : fill(FALLBACK_COPY.pairWrong, { n: String(triesLeft) })}
                    actions={[{ text: FALLBACK_COPY.pairButton, variant: "primary", onClick: submit }]}
                >
                    <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        maxLength={7}
                        placeholder={FALLBACK_COPY.pairPlaceholder}
                        style={INPUT_STYLE}
                        onChange={(e: any) => { value = String(e?.target?.value ?? ""); }}
                        onKeyDown={(e: any) => { if (e?.key === "Enter") { e.preventDefault?.(); submit(); } }}
                    />
                </Modal>
            );
        }, () => settle(null));
        if (key === null) settle(null);
    });
}

/* ------------------------------------------------------------ move my plan -- */

/**
 * On the account that has the plan: what a move does, and Start. `start`
 * asks the relay for the ticket; it resolves null when it worked (the
 * "Now switch accounts" window follows), or the sentence to show.
 */
export function openMoveStart(from: AccountView, start: () => Promise<string | null>): boolean {
    let busy = false;
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={MOVE_COPY.startTitle}
            actions={[
                { text: MOVE_COPY.cancel, variant: "secondary", onClick: () => props.onClose() },
                {
                    text: MOVE_COPY.startButton, variant: "primary", onClick: () => {
                        if (busy) return;
                        busy = true;
                        void start().then(error => {
                            props.onClose();
                            if (error === null) openMessage(MOVE_COPY.switchTitle, MOVE_COPY.switchBody);
                            else openMessage(MOVE_COPY.startTitle, error);
                        }, () => { busy = false; });
                    }
                }
            ]}
        >
            <div style={NORMAL}>{fill(MOVE_COPY.startBody, { name: from.name })}</div>
        </Modal>
    )) !== null;
}

/**
 * On the account the plan moves to: the confirm naming both accounts.
 * `move` runs inside the click (Discord's Authorize window opens there).
 */
export function openMoveHere(from: string, to: AccountView, move: () => void): boolean {
    let done = false;
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={MOVE_COPY.hereTitle}
            actions={[
                { text: MOVE_COPY.later, variant: "secondary", onClick: () => props.onClose() },
                {
                    text: fill(MOVE_COPY.hereButton, { to: to.name }), variant: "primary", onClick: () => {
                        if (done) return;
                        done = true;
                        props.onClose();
                        move();
                    }
                }
            ]}
        >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Avatar url={to.avatarUrl} />
                <div style={NORMAL}>{fill(MOVE_COPY.hereBody, { from, to: to.name })}</div>
            </div>
        </Modal>
    )) !== null;
}

/** The day a plan may move again, as the reader's own calendar says it; the relay's YYYY-MM-DD if that fails. */
export function moveDate(until: string): string {
    try {
        const d = new Date(`${until}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return until;
        return d.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
    } catch {
        return until;
    }
}

/* ------------------------------------------------- pay on another device -- */

/** The QR code of `url`, drawn as one SVG path on white (scanners need dark on light, in either theme). */
export function QrCode({ url }: { url: string; }) {
    const matrix = qrMatrix(url);
    if (matrix === null) return null;
    const n = qrViewSize(matrix);
    return (
        <svg
            viewBox={`0 0 ${n} ${n}`}
            width={220}
            height={220}
            role="img"
            aria-label={ELSEWHERE_COPY.title}
            shapeRendering="crispEdges"
            style={{ display: "block", margin: "8px auto", background: "#fff", borderRadius: 4 }}
        >
            <rect width={n} height={n} fill="#fff" />
            <path d={qrSvgPath(matrix)} fill="#000" />
        </svg>
    );
}

/**
 * The checkout link as a QR code and as text (selectable; no Copy button,
 * whose toast would be drawn under Settings), and Done. The checkout is
 * already waited for: Subline switches on here by itself when it is paid.
 */
export function openPayElsewhere(url: string): boolean {
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={ELSEWHERE_COPY.title}
            subtitle={ELSEWHERE_COPY.body}
            actions={[{ text: ELSEWHERE_COPY.done, variant: "primary", onClick: () => props.onClose() }]}
        >
            <QrCode url={url} />
            <div style={{ ...MUTED, userSelect: "all", wordBreak: "break-all", textAlign: "center", marginTop: 4 }} data-subline-pay-link="">{url}</div>
        </Modal>
    )) !== null;
}

/** Add AI has two plans: which one to pay for on another device. */
export function openElsewherePlanChoice(choose: (plan: "monthly" | "annual") => void): boolean {
    return openGuardedModal(props => (
        <Modal
            {...props}
            title={ELSEWHERE_COPY.title}
            subtitle={ELSEWHERE_COPY.choose}
            actions={[
                { text: UPGRADE_COPY.monthlyButton, variant: "secondary", onClick: () => { props.onClose(); choose("monthly"); } },
                { text: UPGRADE_COPY.annualButton, variant: "primary", onClick: () => { props.onClose(); choose("annual"); } }
            ]}
        />
    )) !== null;
}
