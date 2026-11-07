/**
 * "Share translation": the preview window. The image (shareRender.ts) is
 * shown exactly as it will be copied, with Copy image and Cancel. Nothing is
 * copied before the reader has seen it, and nothing is ever sent anywhere:
 * the image goes to this computer's clipboard, or to a saved file when the
 * clipboard refuses it.
 *
 * The window is a guarded modal (linkPanels.tsx openGuardedModal): a crash
 * inside it closes it and never reaches Discord.
 */
import { Modal, React } from "@webpack/common";

import { openGuardedModal } from "./linkPanels";
import type { ShareCard } from "./shareCard";
import { copyPng, type CopyEnv, drawShareCard, type PngSource, pngOf, savePng } from "./shareRender";
import { toast } from "./toast";
import { isDesktop, transport } from "./transport";
import { SHARE_COPY } from "./upgradeCopy";

/** Where a failure is logged (index.tsx's logger), set at start. */
let log: (why: string) => void = () => { };

export function setShareLog(fn: ((why: string) => void) | null): void {
    log = fn ?? (() => { });
}

/** The page's clipboard, read at the click. */
function copyEnv(): CopyEnv {
    const g = globalThis as any;
    return {
        desktop: isDesktop(),
        copyDesktop: url => transport.copyImagePng(url),
        clipboard: g.navigator?.clipboard ?? null,
        ClipboardItem: typeof g.ClipboardItem === "function" ? g.ClipboardItem : null,
        log: why => log(why)
    };
}

type Mode = "copy" | "save";

/** A copy or save is running: a second press waits for it (one window at a time). */
let busy = false;

/** The window: the image, then Cancel and Copy image (Save image once copying failed). */
export function SharePreview({ modal, canvas, png }: { modal: any; canvas: HTMLCanvasElement; png: PngSource; }) {
    const [mode, setMode] = React.useState<Mode>("copy");
    const doc = (globalThis as any).document;

    const primary = async () => {
        if (busy) return;
        busy = true;
        try {
            if (mode === "copy") {
                if (await copyPng(png, copyEnv())) {
                    toast(SHARE_COPY.copied, "success");
                    modal.onClose();
                    return;
                }
                toast(SHARE_COPY.copyFailed, "failure");
                setMode("save");
                return;
            }
            if (await savePng(png, doc, why => log(why))) {
                toast(SHARE_COPY.saved, "success");
                modal.onClose();
                return;
            }
            toast(SHARE_COPY.saveFailed, "failure");
        } finally {
            busy = false;
        }
    };

    return (
        <Modal
            {...modal}
            title={SHARE_COPY.title}
            subtitle={SHARE_COPY.subtitle}
            actions={[
                { text: SHARE_COPY.cancel, variant: "secondary", onClick: () => modal.onClose() },
                { text: mode === "copy" ? SHARE_COPY.copy : SHARE_COPY.save, variant: "primary", onClick: () => { void primary(); } }
            ]}
        >
            <div
                data-subline-share=""
                style={{ maxHeight: "60vh", overflowY: "auto", borderRadius: 8 }}
                ref={(el: any) => {
                    // The canvas itself, not a copy: what is shown is what is copied.
                    if (el && canvas.parentNode !== el) {
                        canvas.style.width = "100%";
                        canvas.style.height = "auto";
                        canvas.style.display = "block";
                        el.appendChild(canvas);
                    }
                }}
            />
        </Modal>
    );
}

/**
 * Draw the card and open the preview. False when nothing could be shown (no
 * canvas, or no window): the reader gets a short toast and the cause is
 * logged. Never throws.
 */
export function openSharePreview(card: ShareCard): boolean {
    try {
        const doc = (globalThis as any).document;
        const canvas = drawShareCard(card, doc);
        if (canvas === null) {
            log("the share image could not be drawn (no canvas here)");
            toast(SHARE_COPY.saveFailed, "failure");
            return false;
        }
        const png = pngOf(canvas);
        const key = openGuardedModal(props => <SharePreview modal={props} canvas={canvas} png={png} />);
        if (key === null) {
            log("the share window could not be opened");
            toast(SHARE_COPY.saveFailed, "failure");
            return false;
        }
        return true;
    } catch (e) {
        log(`the share window failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        return false;
    }
}
