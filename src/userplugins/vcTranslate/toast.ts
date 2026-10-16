/**
 * THE ONE PLACE SUBLINE SHOWS A DISCORD TOAST.
 *
 * Every toast in the plugin goes through toast() below, never through
 * Vencord's showToast directly, so the next time Discord changes its toast
 * API there is one line to fix.
 *
 * Why it exists: on 2026-10-13 a Discord change to its toast module made
 * every toast crash Discord (scripts/vencordWatch.mjs). Upstream Vencord
 * answered with c0fe7b1 "Update to new Toasts API": showToast now takes
 * Discord's own ToastData object, { text, variant: "default" | "success" |
 * "critical", position?: "top" | "bottom", duration? }, and hands it to
 * Discord's toast function unchanged. The old string form (text, then a
 * type such as "failure") no longer exists, and an old-style variant
 * such as "failure" or "message" is exactly the kind of mismatch that
 * crashed Discord.
 *
 * A throw inside Discord's toast code never reaches the caller: it is
 * logged with its cause and the toast is dropped. A missed toast is a lost
 * sentence; a throw out of a click handler or a Flux listener can break the
 * flow that was trying to report something.
 */
import { Logger } from "@utils/Logger";
import { showToast } from "@webpack/common";

const logger = new Logger("VcTranslate");

/** What a toast means to Subline. Mapped to Discord's variant in one place. */
export type ToastKind = "info" | "success" | "failure";

/** Discord's toast variants (Vencord's ToastVariant since c0fe7b1). */
export type ToastVariant = "default" | "success" | "critical";

export const TOAST_VARIANTS: readonly ToastVariant[] = ["default", "success", "critical"];

const VARIANT: Record<ToastKind, ToastVariant> = {
    info: "default",
    success: "success",
    failure: "critical"
};

export interface ToastOptions {
    position?: "top" | "bottom";
    duration?: number;
}

/** Vencord's ToastData (packages/discord-types toasts.d.ts at c0fe7b1), the fields Subline uses. */
interface ToastData extends ToastOptions {
    text: string;
    variant: ToastVariant;
}

/**
 * The type-check checkout of Vencord (tsconfig.json "paths") can be older
 * than the pin we build, so the call is typed against the ToastData shape
 * above rather than whatever showToast signature that checkout declares.
 */
const show = showToast as unknown as (data: ToastData) => void;

/** Show one toast. Never throws. */
export function toast(text: string, kind: ToastKind = "info", options?: ToastOptions): void {
    try {
        const data: ToastData = { text, variant: VARIANT[kind] ?? "default" };
        if (options?.position !== undefined) data.position = options.position;
        if (options?.duration !== undefined) data.duration = options.duration;
        show(data);
    } catch (err) {
        logger.error(`Toast not shown (${kind}): Discord's toast threw.`, err);
    }
}
