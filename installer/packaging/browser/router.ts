/*
 * Subline browser add-on: what the background does with a call from Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The plugin runs in Discord's page and does no network itself (see the
 * plugin's transport.ts). On the desktop its calls go to Electron's main
 * process; in the browser they come here, to the add-on's background, which
 * has host permissions for exactly two hosts and so needs no CORS from either:
 *
 *   page (pageBridge.js) → content script (content.js) → background (this)
 *
 * The background runs the plugin's own native.ts functions, so a browser
 * answer is the desktop answer: the same relay headers, the same retries,
 * the same scrubbing, the same shapes.
 *
 * Pure: no browser API in this file, so the tests drive it directly.
 */

/** The calls the bridge carries. The same names as native.ts's exports. */
export const BRIDGE_METHODS = [
    "translateBatch",
    "relayStatus",
    "relayLink",
    "relayLinkPoll",
    "relayMoveStart",
    "relayMoveFinish",
    "relayCheckout",
    "relayRedeem",
    "relayPatchHealth",
    "relaySendFeedback",
    "relayChannels",
    "relayPrefs"
] as const;

export type BridgeMethod = typeof BRIDGE_METHODS[number];

/**
 * The only origins the background may fetch: the relay and Google's
 * translate host (engines/relay.ts and engines/google.ts). Also the add-on's
 * host permissions, apart from Discord itself (see webManifest.mjs).
 */
export const ALLOWED_ORIGINS = ["https://relay.subline.page", "https://translate-pa.googleapis.com"] as const;

/**
 * The engines the add-on runs. The key engines (Claude, Gemini, Groq) are not
 * offered in Settings and their hosts are not in the manifest.
 */
export const BROWSER_ENGINES = ["relay", "google"] as const;

/**
 * The add-on's `x-subline-app` value (0.2.8): `addon/<version>`, from the
 * add-on's own manifest, so the owner page counts add-on computers
 * (relay/src/versions.ts). Null for a version the relay would not accept
 * (its APP_VERSION_RE), so nothing odd is ever sent.
 */
export function addonAppHeader(version: unknown): string | null {
    return typeof version === "string" && /^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(version) ? `addon/${version}` : null;
}

/** What the content script sends the background. */
export const CALL_TAG = "subline:call";

/** The background's reply: the native answer, or why the call was refused. */
export type BridgeReply = { ok: true; value: unknown } | { ok: false; refused: string };

/** The native.ts functions the background runs. The first argument is the IPC event, unused. */
export type NativeFunctions = Record<BridgeMethod, (event: undefined, ...args: any[]) => Promise<unknown>>;

/** Who sent a runtime message, as the browser describes it. */
export interface Sender {
    id?: string;
    url?: string;
}

/**
 * The largest call accepted, in characters over all its strings. A batch of
 * long messages is well under this; a call over it is not the plugin.
 */
export const MAX_CALL_CHARS = 2_000_000;

/** The answer to a key engine in the browser. Shaped like any engine failure. */
export const ENGINE_UNAVAILABLE = { ok: false, error: "engine not available in the browser" } as const;

/** Whether `sender` is a content script of this add-on on Discord's site. */
export function isFromDiscord(sender: Sender, ownId: string): boolean {
    if (sender.id !== ownId || typeof sender.url !== "string") return false;
    let url: URL;
    try {
        url = new URL(sender.url);
    } catch {
        return false;
    }
    return url.protocol === "https:" && (url.hostname === "discord.com" || url.hostname.endsWith(".discord.com"));
}

type ArgKind = "string" | "string?" | "boolean?" | "statusOptions?";

/** Each method's arguments, as native.ts takes them (without the IPC event). */
const SIGNATURES: Record<BridgeMethod, readonly ArgKind[]> = {
    translateBatch: ["string", "string", "string", "string?", "boolean?", "string?"],
    relayStatus: ["string", "string?", "statusOptions?"],
    relayLink: ["string", "string", "string", "string"],
    relayLinkPoll: ["string", "string", "string", "string", "string?", "string?"],
    relayMoveStart: ["string", "string"],
    relayMoveFinish: ["string", "string", "string", "string", "string"],
    relayCheckout: ["string", "string", "string?"],
    relayRedeem: ["string", "string"],
    relayPatchHealth: ["string", "string"],
    relaySendFeedback: ["string", "string"],
    relayChannels: ["string", "string", "string?"],
    relayPrefs: ["string", "string", "string?"]
};

/**
 * The arguments, checked against the method's signature, or null.
 *
 * Optional arguments may arrive as null: Chrome's runtime messaging is JSON,
 * which turns an `undefined` inside an array into null. They are handed on as
 * undefined, which is what the desktop's IPC would have delivered. Status
 * options are rebuilt from their two booleans, so nothing else rides along.
 */
export function cleanArgs(method: BridgeMethod, args: unknown): unknown[] | null {
    if (!Array.isArray(args)) return null;
    const signature = SIGNATURES[method];
    if (args.length > signature.length) return null;
    const out: unknown[] = [];
    let chars = 0;
    for (let i = 0; i < signature.length; i++) {
        const kind = signature[i];
        const value = i < args.length ? args[i] : undefined;
        const absent = value === undefined || value === null;
        if (kind === "string") {
            if (typeof value !== "string") return null;
            chars += value.length;
            out.push(value);
        } else if (kind === "string?") {
            if (absent) { out.push(undefined); continue; }
            if (typeof value !== "string") return null;
            chars += value.length;
            out.push(value);
        } else if (kind === "boolean?") {
            if (absent) { out.push(undefined); continue; }
            if (typeof value !== "boolean") return null;
            out.push(value);
        } else {
            if (absent) { out.push(undefined); continue; }
            if (typeof value !== "object" || Array.isArray(value)) return null;
            const o = value as { prior?: unknown; check?: unknown; };
            out.push({ prior: o.prior === true, check: o.check === true });
        }
    }
    if (chars > MAX_CALL_CHARS) return null;
    // Trailing undefined arguments are dropped, so a native default applies
    // exactly as when the desktop caller left them out.
    while (out.length > 0 && out[out.length - 1] === undefined) out.pop();
    return out;
}

/**
 * The Firefox data category a patch health report is (Firefox Add-ons:
 * "device and browser info, extension usage and settings data, crash and
 * error reports"). Firefox lets an add-on collect it only as OPTIONAL data
 * the user switched on, so the Firefox manifest lists it under `optional`.
 */
export const TECHNICAL_DATA = "technicalAndInteraction";

/**
 * Whether the user allowed the optional technical data (Firefox's built-in
 * data consent): `permissions.getAll()` lists it under `data_collection`. A
 * Firefox without that key (older than the built-in consent) has no way to
 * ask, so the answer is no. Never throws.
 */
export async function technicalDataAllowed(permissions: { getAll(): Promise<{ data_collection?: unknown; [other: string]: unknown; }>; } | undefined): Promise<boolean> {
    try {
        const all = await permissions?.getAll();
        return Array.isArray(all?.data_collection) && all.data_collection.includes(TECHNICAL_DATA);
    } catch {
        return false;
    }
}

/** What the user allowed, asked by `route` before a call that needs it. */
export interface Consent {
    /** A patch health report may be sent (TECHNICAL_DATA). */
    technical(): Promise<boolean>;
}

/**
 * Run one call from Discord's page. Never throws: a refusal names its reason,
 * and the page side turns it into the method's ordinary failure answer. A
 * patch health report the user did not allow (`consent`) is not sent and
 * answers `false`, as an unsent report does on the desktop.
 */
export async function route(native: NativeFunctions, message: unknown, sender: Sender, ownId: string, consent?: Consent): Promise<BridgeReply> {
    if (!isFromDiscord(sender, ownId)) return { ok: false, refused: "sender" };
    if (message === null || typeof message !== "object") return { ok: false, refused: "message" };
    const { tag, method, args } = message as { tag?: unknown; method?: unknown; args?: unknown; };
    if (tag !== CALL_TAG) return { ok: false, refused: "message" };
    if (typeof method !== "string" || !(BRIDGE_METHODS as readonly string[]).includes(method)) {
        return { ok: false, refused: "unknown method" };
    }
    const name = method as BridgeMethod;
    const clean = cleanArgs(name, args);
    if (clean === null) return { ok: false, refused: "arguments" };
    if (name === "translateBatch" && !(BROWSER_ENGINES as readonly string[]).includes(clean[0] as string)) {
        return { ok: true, value: ENGINE_UNAVAILABLE };
    }
    if (name === "relayPatchHealth" && consent !== undefined && !(await consent.technical())) return { ok: true, value: false };
    try {
        return { ok: true, value: await native[name](undefined, ...clean) };
    } catch (err) {
        // native.ts's functions do not throw; this is a bug, named in the log.
        console.error(`[Subline] ${name} threw in the add-on background`, err);
        return { ok: false, refused: "failed" };
    }
}

/** Whether `input` is a URL on one of ALLOWED_ORIGINS. */
export function isAllowedUrl(input: unknown): boolean {
    let href: string;
    if (typeof input === "string") href = input;
    else if (input instanceof URL) href = input.href;
    else if (input !== null && typeof input === "object" && typeof (input as { url?: unknown; }).url === "string") href = (input as { url: string; }).url;
    else return false;
    try {
        return (ALLOWED_ORIGINS as readonly string[]).includes(new URL(href).origin);
    } catch {
        return false;
    }
}

/**
 * `fetch`, limited to ALLOWED_ORIGINS. Host permissions decide what the
 * background may read across origins; this makes the two hosts the only ones
 * it can reach at all, whatever a call asks for. A redirect is an error rather
 * than followed, so an allowed host cannot hand the request on to another one
 * (neither host redirects these requests).
 */
export function guardFetch(inner: typeof fetch): typeof fetch {
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (!isAllowedUrl(input)) return Promise.reject(new TypeError("Subline: this host is not allowed"));
        return inner(input, { ...init, redirect: "error" });
    }) as typeof fetch;
}
