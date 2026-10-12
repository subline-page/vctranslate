/**
 * The feedback box, drawn in two places:
 *   - at the bottom of Subline → Settings (a COMPONENT setting, settings.ts);
 *   - in a Discord modal opened from a message's right-click menu, "Report
 *     translation", with that one message's translation attached.
 *
 * All the rules live in feedback.ts; this file only draws them. Review builds
 * the payload once (toReview), the review step lists every field of it, and
 * Send sends that same object. Nothing is sent from anywhere else.
 *
 * Nothing here runs at module load except constant definitions, so loading
 * the settings page can never be what stops Discord from starting.
 */
import { Modal, openModal, React } from "@webpack/common";

import { BUILD_ID, PLUGIN_VERSION } from "./buildStamp";
import { entitlementLevel } from "./entitlement";
import {
    afterSend, type BoxState, errorEntries, FEEDBACK_COPY, type FeedbackContext, initialBox, MAX_EMAIL_CHARS, MAX_MESSAGE_CHARS,
    osName, previewRows, sendPayload, type SendResult, toReview, type TranslationReport
} from "./feedback";
import { recentErrorCodes } from "./recentErrors";
import { installIdOnce, tasteBearer } from "./taste";

const TEXT = { color: "var(--text-default, var(--text-normal, #dbdee1))" } as const;
const MUTED = { color: "var(--text-muted)", fontSize: "0.9rem" } as const;
const FIELD = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    marginTop: 4,
    borderRadius: 4,
    border: "1px solid var(--border-subtle, var(--background-modifier-accent, #4e5058))",
    background: "var(--input-background, var(--background-secondary, #1e1f22))",
    color: "var(--text-default, var(--text-normal, #dbdee1))",
    fontSize: "1rem",
    fontFamily: "inherit"
} as const;
const BUTTON = {
    padding: "6px 16px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 500
} as const;
const PRIMARY = { ...BUTTON, background: "var(--button-filled-brand-background, var(--brand-500, #5865f2))", color: "var(--white, #fff)" } as const;
const SECONDARY = { ...BUTTON, background: "var(--button-secondary-background, #4e5058)", color: "var(--white, #fff)" } as const;
const ROW_LABEL = { ...MUTED, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.02em", marginTop: 8 } as const;
const ROW_VALUE = { ...TEXT, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflowY: "auto" } as const;

/** What the box can attach, read fresh each time Review is pressed. */
export function feedbackContext(report?: TranslationReport): FeedbackContext {
    return {
        report,
        errors: errorEntries(recentErrorCodes()),
        app: {
            version: PLUGIN_VERSION,
            build: BUILD_ID,
            os: osName((globalThis as any).navigator?.platform),
            plan: entitlementLevel()
        }
    };
}

/** The native call, read when Send is pressed. A missing native half is "unavailable". */
function nativeSend(install: string, json: string): Promise<SendResult> {
    const native = (globalThis as any).VencordNative?.pluginHelpers?.VcTranslate;
    if (typeof native?.relaySendFeedback !== "function") return Promise.resolve({ ok: false, error: "unavailable" });
    return native.relaySendFeedback(install, json);
}

const SEND_DEPS = { install: async () => tasteBearer(await installIdOnce()), send: nativeSend };

/** The settings box's state, kept while Discord runs so leaving the tab keeps the text. */
let settingsBox: BoxState | null = null;

function Check({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean; }) {
    return (
        <label style={{ ...TEXT, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={(e: any) => onChange(!!e?.target?.checked)} />
            <span>{label}</span>
        </label>
    );
}

/**
 * The box. `report` is present only when opened from a message. `onClose`
 * is the modal's close, absent in the settings tab.
 */
export function FeedbackBox({ report, onClose }: { report?: TranslationReport; onClose?: () => void; }) {
    const inSettings = report === undefined;
    const [state, setStateRaw] = React.useState<BoxState>(() => (inSettings && settingsBox) || initialBox());
    const setState = (next: BoxState) => {
        if (inSettings) settingsBox = next;
        setStateRaw(next);
    };
    const { draft, phase } = state;
    const setDraft = (patch: Partial<typeof draft>) => setState({ ...state, notice: null, draft: { ...draft, ...patch } });
    const setInclude = (key: keyof typeof draft.include, v: boolean) => setDraft({ include: { ...draft.include, [key]: v } });
    const errorCount = phase === "edit" ? errorEntries(recentErrorCodes()).length : 0;

    const notice = state.notice !== null && (
        <div role="status" style={{ ...TEXT, marginTop: 8 }}>{state.notice}</div>
    );

    if (phase === "sent") {
        return (
            <div data-subline-feedback="sent">
                <div style={{ ...TEXT, marginTop: 8 }}>{FEEDBACK_COPY.sent}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {onClose
                        ? <button type="button" style={SECONDARY} onClick={onClose}>{FEEDBACK_COPY.close}</button>
                        : <button type="button" style={SECONDARY} onClick={() => setState(initialBox())}>{FEEDBACK_COPY.sendAnother}</button>}
                </div>
            </div>
        );
    }

    if ((phase === "review" || phase === "sending") && state.payload) {
        const payload = state.payload;
        const send = async () => {
            if (state.phase === "sending") return;
            const sending: BoxState = { ...state, phase: "sending", notice: null };
            setState(sending);
            setState(afterSend(sending, await sendPayload(payload, SEND_DEPS)));
        };
        return (
            <div data-subline-feedback="review">
                <div style={{ ...TEXT, fontWeight: 600, marginTop: 8 }}>{FEEDBACK_COPY.reviewTitle}</div>
                <div style={{ padding: "4px 12px 10px", marginTop: 6, borderRadius: 6, background: "var(--background-secondary, #2b2d31)" }}>
                    {previewRows(payload).map(row => (
                        <div key={row.label}>
                            <div style={ROW_LABEL}>{row.label}</div>
                            <div style={ROW_VALUE}>{row.value}</div>
                        </div>
                    ))}
                </div>
                {notice}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="button" style={SECONDARY} disabled={phase === "sending"} onClick={() => setState({ ...state, phase: "edit", payload: null, notice: null })}>
                        {FEEDBACK_COPY.edit}
                    </button>
                    <button type="button" style={PRIMARY} disabled={phase === "sending"} onClick={() => { void send(); }}>
                        {phase === "sending" ? FEEDBACK_COPY.sending : FEEDBACK_COPY.send}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div data-subline-feedback="edit">
            {report && (
                <Check checked={draft.include.report} label={FEEDBACK_COPY.includeReport} onChange={v => setInclude("report", v)} />
            )}
            <div style={{ ...MUTED, marginTop: 10 }}>{FEEDBACK_COPY.messageLabel}</div>
            <textarea
                rows={4}
                maxLength={MAX_MESSAGE_CHARS}
                value={draft.message}
                placeholder={report ? FEEDBACK_COPY.reportMessagePlaceholder : FEEDBACK_COPY.messagePlaceholder}
                style={{ ...FIELD, resize: "vertical" }}
                onChange={(e: any) => setDraft({ message: String(e?.target?.value ?? "") })}
            />
            <div style={{ ...MUTED, fontSize: "0.8rem", textAlign: "right" }}>
                {FEEDBACK_COPY.counter.replace("{n}", draft.message.length.toLocaleString("en-US")).replace("{max}", MAX_MESSAGE_CHARS.toLocaleString("en-US"))}
            </div>
            <div style={{ ...MUTED, marginTop: 6 }}>{FEEDBACK_COPY.emailLabel}</div>
            <input
                type="email"
                maxLength={MAX_EMAIL_CHARS}
                value={draft.email}
                placeholder={FEEDBACK_COPY.emailPlaceholder}
                spellCheck={false}
                style={FIELD}
                onChange={(e: any) => setDraft({ email: String(e?.target?.value ?? "") })}
            />
            <Check
                checked={draft.include.errors && errorCount > 0}
                disabled={errorCount === 0}
                label={errorCount === 0 ? `${FEEDBACK_COPY.includeErrors}. ${FEEDBACK_COPY.noErrors}` : FEEDBACK_COPY.includeErrors}
                onChange={v => setInclude("errors", v)}
            />
            <Check checked={draft.include.app} label={FEEDBACK_COPY.includeApp} onChange={v => setInclude("app", v)} />
            {notice}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" style={PRIMARY} onClick={() => setState(toReview(state, feedbackContext(report)))}>
                    {FEEDBACK_COPY.review}
                </button>
            </div>
        </div>
    );
}

/** The section at the bottom of Subline → Settings. */
export function FeedbackSection() {
    return (
        <div style={{ marginTop: 16 }} data-subline-feedback-section="">
            <div style={{ ...TEXT, fontWeight: 600, fontSize: "1rem" }}>{FEEDBACK_COPY.title}</div>
            <div style={{ ...MUTED, marginTop: 4 }}>{FEEDBACK_COPY.intro}</div>
            <FeedbackBox />
        </div>
    );
}

/** The right-click "Report translation" modal, with that message's translation attached. */
export function openReportModal(report: TranslationReport): void {
    try {
        openModal((props: any) => (
            <Modal {...props} title={FEEDBACK_COPY.reportTitle} subtitle={FEEDBACK_COPY.reportIntro}>
                <FeedbackBox report={report} onClose={props.onClose} />
            </Modal>
        ));
    } catch { /* no modal: the settings box is still there */ }
}
