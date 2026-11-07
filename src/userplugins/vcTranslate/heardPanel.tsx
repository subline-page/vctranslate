/**
 * "Where did you hear about Subline?": one window with one button per
 * answer, and Skip. A press sends that answer (heardFrom.ts decides when the
 * window shows; index.tsx sends the event). Skip, the X, Escape and a click
 * outside send nothing. A guarded modal (linkPanels.tsx): a crash inside it
 * closes it and never reaches Discord.
 */
import { Modal, React } from "@webpack/common";

import type { HeardEvent } from "./engines/relay";
import { HEARD_OPTIONS } from "./heardFrom";
import { openGuardedModal } from "./linkPanels";
import { HEARD_COPY } from "./upgradeCopy";

const OPTION = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    marginTop: 6,
    borderRadius: 6,
    border: "1px solid var(--border-subtle, var(--background-modifier-accent, #4e5058))",
    background: "var(--background-secondary, #2b2d31)",
    color: "var(--text-default, var(--text-normal, #dbdee1))",
    fontSize: "1rem",
    cursor: "pointer"
} as const;

/** Open the question. `answer` runs at most once, with the answer pressed. False when no window could open. */
export function openHeardPanel(answer: (event: HeardEvent) => void): boolean {
    let done = false;
    return openGuardedModal(props => {
        const pick = (event: HeardEvent) => {
            if (done) return;
            done = true;
            props.onClose();
            answer(event);
        };
        return (
            <Modal
                {...props}
                title={HEARD_COPY.title}
                subtitle={HEARD_COPY.subtitle}
                actions={[{ text: HEARD_COPY.skip, variant: "secondary", onClick: () => { done = true; props.onClose(); } }]}
            >
                <div data-subline-heard="">
                    {HEARD_OPTIONS.map(o => (
                        <button key={o.event} type="button" style={OPTION} data-subline-heard-option={o.event} onClick={() => pick(o.event)}>
                            {o.label}
                        </button>
                    ))}
                </div>
            </Modal>
        );
    }) !== null;
}
