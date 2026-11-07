/**
 * Put a PNG on the system clipboard from Electron's main process, for the
 * "Share translation" image on the desktop (native.ts copyImagePng). The
 * renderer's own clipboard cannot hold an image in Discord's app, so the
 * image goes to the main process as a data URL and Electron writes it.
 *
 * Pure apart from the Electron parts it is handed, so the checks are tested
 * without Electron. The input is untrusted (any renderer code can call an
 * IPC handler): only a well-formed PNG data URL of a bounded size is read.
 */

export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
/** A share image is well under 2 MB as base64; anything near this is not one. */
export const MAX_PNG_DATA_URL_CHARS = 16_000_000;

/** The two Electron parts used: `clipboard` and `nativeImage`. */
export interface ElectronImageApi {
    clipboard: { writeImage(image: unknown): void; };
    nativeImage: { createFromDataURL(dataUrl: string): { isEmpty(): boolean; }; };
}

/** Why a copy did not happen, for the log. Null when it did. */
export type ImageClipFailure = "not a png data url" | "too large" | "no electron" | "empty image" | `failed: ${string}`;

/** Write the PNG to the clipboard. Null on success, else why not. Never throws. */
export function writePngToClipboard(dataUrl: unknown, electron: ElectronImageApi | null): ImageClipFailure | null {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return "not a png data url";
    if (dataUrl.length > MAX_PNG_DATA_URL_CHARS) return "too large";
    const body = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
    if (body.length === 0 || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return "not a png data url";
    if (electron === null) return "no electron";
    try {
        const image = electron.nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) return "empty image";
        electron.clipboard.writeImage(image);
        return null;
    } catch (e) {
        return `failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    }
}
