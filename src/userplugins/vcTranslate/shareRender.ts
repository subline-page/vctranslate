import { layoutLines, type ShareCard } from "./shareCard";

/**
 * Draw the "Share translation" card (shareCard.ts) on a canvas, and copy or
 * save it as a PNG. Everything drawn is text and plain shapes: no image is
 * ever loaded (no avatar, no emoji sheet), so the canvas is never tainted and
 * nothing is fetched.
 *
 * COPYING, by platform:
 *  - the desktop app: the PNG goes to the main process as a data URL, where
 *    Electron writes it to the clipboard (native.ts copyImagePng);
 *  - the browser add-on: `navigator.clipboard.write` with a ClipboardItem
 *    holding a PROMISE of the PNG, so the click's permission is used at once,
 *    while the PNG is still being made;
 *  - if that fails: Save image, a download of the same PNG.
 * Every failure is logged with its cause, and never thrown.
 */

export type ShareTheme = "dark" | "light";

const COLORS: Record<ShareTheme, { bg: string; text: string; muted: string; accent: string; avatar: string; rule: string; }> = {
    dark: { bg: "#313338", text: "#dbdee1", muted: "#949ba4", accent: "#b9a5ff", avatar: "#5c5f66", rule: "#3f4147" },
    light: { bg: "#ffffff", text: "#313338", muted: "#5c5e66", accent: "#6e56cf", avatar: "#c4c9ce", rule: "#e3e5e8" }
};

/** The card's width in CSS pixels; drawn at SHARE_SCALE for sharp text. */
export const SHARE_WIDTH = 560;
export const SHARE_SCALE = 2;
const PAD = 28;
const AVATAR = 36;
const TEXT_PX = 16;
const LINE_PX = 22;
const SMALL_PX = 12;
const BAR = 3;
const FALLBACK_FONT = "\"gg sans\", \"Noto Sans\", system-ui, -apple-system, \"Segoe UI\", sans-serif";
/** The file name of a saved image. */
export const SHARE_FILE_NAME = "subline-translation.png";

/** Discord's theme from the page: light only when Discord says so. */
export function themeOf(doc: { documentElement?: { classList?: { contains(c: string): boolean; }; }; } | undefined): ShareTheme {
    try {
        return doc?.documentElement?.classList?.contains("theme-light") === true ? "light" : "dark";
    } catch {
        return "dark";
    }
}

/** Discord's own font stack, then system fonts. */
export function fontOf(doc: any): string {
    try {
        const family = doc?.defaultView?.getComputedStyle?.(doc.body)?.fontFamily;
        if (typeof family === "string" && family.trim() !== "") return `${family}, system-ui, sans-serif`;
    } catch { /* below */ }
    return FALLBACK_FONT;
}

/**
 * The card on a new canvas, or null when the page cannot make one (no
 * document, no 2D context). Never throws.
 */
export function drawShareCard(card: ShareCard, doc: any, theme: ShareTheme = themeOf(doc), font: string = fontOf(doc)): HTMLCanvasElement | null {
    try {
        const canvas = doc?.createElement?.("canvas") as HTMLCanvasElement | undefined;
        const ctx = canvas?.getContext?.("2d");
        if (!canvas || !ctx) return null;
        const c = COLORS[theme];
        const inner = SHARE_WIDTH - 2 * PAD;
        const textFont = `${TEXT_PX}px ${font}`;
        ctx.font = textFont;
        const measure = (s: string) => ctx.measureText(s).width;
        const original = layoutLines(card.original, measure, inner);
        const translation = layoutLines(card.translation, measure, inner - BAR - 12);

        const head = AVATAR + 14;
        const langs = card.languages !== "" ? SMALL_PX + 10 : 0;
        const height = PAD + head + original.length * LINE_PX + 14 + langs + translation.length * LINE_PX + 18 + 1 + 12 + SMALL_PX + PAD;

        canvas.width = SHARE_WIDTH * SHARE_SCALE;
        canvas.height = Math.ceil(height * SHARE_SCALE);
        ctx.scale(SHARE_SCALE, SHARE_SCALE);
        ctx.fillStyle = c.bg;
        ctx.fillRect(0, 0, SHARE_WIDTH, height);
        ctx.textBaseline = "alphabetic";

        // Who: a plain grey circle and "Someone". Never Discord's avatar or name.
        let y = PAD;
        ctx.fillStyle = c.avatar;
        ctx.beginPath();
        ctx.arc(PAD + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c.text;
        ctx.font = `600 ${TEXT_PX}px ${font}`;
        ctx.direction = "ltr";
        ctx.textAlign = "left";
        ctx.fillText(card.author, PAD + AVATAR + 12, y + AVATAR / 2 + 6);
        y += head;

        const block = (lines: string[], rtl: boolean, left: number, right: number, color: string) => {
            ctx.font = textFont;
            ctx.fillStyle = color;
            ctx.direction = rtl ? "rtl" : "ltr";
            ctx.textAlign = rtl ? "right" : "left";
            for (const line of lines) {
                y += LINE_PX;
                ctx.fillText(line, rtl ? right : left, y - 6);
            }
        };
        block(original, card.originalRtl, PAD, SHARE_WIDTH - PAD, c.text);
        y += 14;

        if (langs > 0) {
            ctx.font = `${SMALL_PX}px ${font}`;
            ctx.fillStyle = c.muted;
            ctx.direction = "ltr";
            ctx.textAlign = "left";
            y += SMALL_PX;
            ctx.fillText(card.languages, PAD, y);
            y += 10;
        }

        // The translation, marked by a bar on its starting side.
        const top = y;
        const barX = card.translationRtl ? SHARE_WIDTH - PAD - BAR : PAD;
        block(translation, card.translationRtl, PAD + BAR + 12, SHARE_WIDTH - PAD - BAR - 12, c.text);
        ctx.fillStyle = c.accent;
        ctx.fillRect(barX, top + 2, BAR, y - top);
        y += 18;

        ctx.fillStyle = c.rule;
        ctx.fillRect(PAD, y, inner, 1);
        y += 1 + 12 + SMALL_PX;
        ctx.font = `${SMALL_PX}px ${font}`;
        ctx.fillStyle = c.muted;
        ctx.direction = "ltr";
        ctx.textAlign = "left";
        ctx.fillText(card.footer, PAD, y);
        return canvas;
    } catch {
        return null;
    }
}

/** The PNG, two ways: a data URL (the desktop's IPC) and a Blob (the browser's clipboard). */
export interface PngSource {
    dataUrl(): string | null;
    blob(): Promise<Blob | null>;
}

export function pngOf(canvas: HTMLCanvasElement): PngSource {
    return {
        dataUrl: () => {
            try {
                return canvas.toDataURL("image/png");
            } catch {
                return null;
            }
        },
        blob: () => new Promise(resolve => {
            try {
                canvas.toBlob(b => resolve(b), "image/png");
            } catch {
                resolve(null);
            }
        })
    };
}

/** What copying needs, so it can be tested without a browser. */
export interface CopyEnv {
    desktop: boolean;
    /** The desktop's main-process write (transport.copyImagePng). */
    copyDesktop(dataUrl: string): Promise<boolean>;
    /** The page's `navigator.clipboard`, when there is one. */
    clipboard?: { write(items: unknown[]): Promise<void>; } | null;
    /** The page's `ClipboardItem`, when there is one. */
    ClipboardItem?: (new (items: Record<string, Promise<Blob> | Blob>) => unknown) | null;
    log(why: string): void;
}

const why = (e: unknown) => e instanceof Error ? `${e.name}: ${e.message}` : String(e);

/** Copy the PNG to the clipboard. True when it is there. Never throws; every failure is logged with its cause. */
export async function copyPng(png: PngSource, env: CopyEnv): Promise<boolean> {
    if (env.desktop) {
        const url = png.dataUrl();
        if (url === null) {
            env.log("the share image could not be made into a PNG");
            return false;
        }
        try {
            if (await env.copyDesktop(url) === true) return true;
            env.log("the desktop clipboard did not take the share image (see the main process log)");
        } catch (e) {
            env.log(`the desktop clipboard call failed: ${why(e)}`);
        }
        return false;
    }
    if (!env.clipboard || typeof env.clipboard.write !== "function" || typeof env.ClipboardItem !== "function") {
        env.log("this browser has no image clipboard");
        return false;
    }
    try {
        // A promise, not the Blob: the write starts inside the click.
        const blob = png.blob().then(b => b ?? Promise.reject(new Error("no PNG from the canvas")));
        await env.clipboard.write([new env.ClipboardItem({ "image/png": blob })]);
        return true;
    } catch (e) {
        env.log(`the browser clipboard refused the share image: ${why(e)}`);
        return false;
    }
}

/**
 * Save the PNG as a download (SHARE_FILE_NAME). True when the download was
 * started. Never throws; a failure is logged with its cause.
 */
export async function savePng(png: PngSource, doc: any, log: (why: string) => void): Promise<boolean> {
    try {
        const URLs = doc?.defaultView?.URL ?? (globalThis as any).URL;
        const blob = await png.blob();
        let href: string | null = null;
        let revoke = () => { };
        if (blob !== null && typeof URLs?.createObjectURL === "function") {
            const url = URLs.createObjectURL(blob) as string;
            href = url;
            revoke = () => { try { URLs.revokeObjectURL(url); } catch { /* gone with the page */ } };
        } else {
            href = png.dataUrl();
        }
        if (href === null) {
            log("the share image could not be made into a PNG to save");
            return false;
        }
        const a = doc.createElement("a");
        a.href = href;
        a.download = SHARE_FILE_NAME;
        a.rel = "noopener";
        a.style.display = "none";
        doc.body.appendChild(a);
        a.click();
        a.remove();
        // Late enough for the download to have read it.
        setTimeout(revoke, 60_000);
        return true;
    } catch (e) {
        log(`the share image could not be saved: ${why(e)}`);
        return false;
    }
}
