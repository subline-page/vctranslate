import type { AppSignals } from "./appSignals";
import type { FeedbackPostResult, RelayChannelsResult, RelayPrefsResult, StatusOptions } from "./engines/relay";
import type { AskResult } from "./helperKick";
import type {
    NativeResponse, RelayCheckoutResponse, RelayLinkPollResponse, RelayMoveStartResponse, RelayRedeemResponse, RelayStatusResponse
} from "./native";
import type { EngineId } from "./types";

/**
 * EVERY NETWORK CALL THE PLUGIN MAKES, AND THE ONE PLACE THAT KNOWS HOW.
 *
 * The renderer does no network itself. On the desktop app the calls go to the
 * main process: Vencord exposes every export of native.ts on
 * `VencordNative.pluginHelpers.VcTranslate`, and that is where fetch runs (no
 * CORS, and the credential never touches Discord's page). In a browser there
 * is no main process: Vencord's web build has an empty `pluginHelpers`, so the
 * browser add-on puts a WEB TRANSPORT on `globalThis.__sublineWebTransport`
 * instead, which sends each call to the add-on's background (host permissions
 * for the relay and Google, so the relay opens no CORS either).
 *
 * The choice is made on EVERY call, not once at load: the desktop helpers win
 * whenever they exist, and the web transport is used only when they do not.
 *
 * THE WEB TRANSPORT CONTRACT. `globalThis.__sublineWebTransport` is an object
 * with these functions, taking the SAME arguments as the native ones (without
 * the IPC event) and resolving the SAME result shapes (see native.ts):
 *
 *   translateBatch(engine, apiKey, reqJson, model?, debug?, install?) -> NativeResponse
 *   relayStatus(code, install?, options?: { prior?, check? })         -> RelayStatusResponse
 *   relayLink(credential, install, code, expect)                      -> RelayStatusResponse (plus linked)
 *   relayLinkPoll(credential, install, state, expect, pair?, ticket?) -> RelayLinkPollResponse
 *   relayMoveStart(credential, install)                               -> RelayMoveStartResponse
 *   relayMoveFinish(credential, install, ticket, code, expect)        -> RelayStatusResponse (plus moved)
 *   relayCheckout(code, plan, install?)                               -> RelayCheckoutResponse
 *   relayRedeem(install, promo)                                       -> RelayRedeemResponse
 *   relayPatchHealth(install, json)                                   -> true | false | "rejected"
 *   relaySendFeedback(install, json)                                  -> FeedbackPostResult
 *   relayChannels(credential, install, json?)                         -> RelayChannelsResult (GET without json, POST with it)
 *   relayPrefs(credential, install, json?)                            -> RelayPrefsResult (GET without json, POST with it)
 *
 * Each returns a Promise and should never reject (a failure is `{ ok: false }`
 * or `false`, as on the desktop). Every request to the relay carries the
 * headers engines/relay.ts builds (relayHeaders: x-subline-api 3, the client,
 * the install), so the simplest web transport runs native.ts's own engine
 * functions in the background with the background's fetch.
 *
 * DESKTOP ONLY. The status file, the staged build, the app signals and the
 * ask for a new build (helperKick.ts) belong to the installed app and its
 * background helper. Without the desktop helpers they are safe no-ops: no
 * beacon is written, no update is staged, no app signals, no helper to ask
 * (the store updates the add-on).
 *
 * A call whose function exists nowhere fails the way a broken IPC call does:
 * the network functions reject (every caller already treats that as "no
 * answer"), the two never-throw reports resolve their failure value.
 */
export interface SublineTransport {
    translateBatch(engine: EngineId, apiKey: string, reqJson: string, model?: string, debug?: boolean, install?: string): Promise<NativeResponse>;
    relayStatus(code: string, install?: string, options?: StatusOptions): Promise<RelayStatusResponse>;
    relayLink(credential: string, install: string, code: string, expect: string): Promise<RelayStatusResponse>;
    relayLinkPoll(credential: string, install: string, state: string, expect: string, pair?: string, ticket?: string): Promise<RelayLinkPollResponse>;
    relayMoveStart(credential: string, install: string): Promise<RelayMoveStartResponse>;
    relayMoveFinish(credential: string, install: string, ticket: string, code: string, expect: string): Promise<RelayStatusResponse>;
    relayCheckout(code: string, plan: string, install?: string): Promise<RelayCheckoutResponse>;
    relayRedeem(install: string, promo: string): Promise<RelayRedeemResponse>;
    relayPatchHealth(install: string, json: string): Promise<boolean | "rejected">;
    relaySendFeedback(install: string, json: string): Promise<FeedbackPostResult>;
    relayChannels(credential: string, install: string, json?: string): Promise<RelayChannelsResult>;
    relayPrefs(credential: string, install: string, json?: string): Promise<RelayPrefsResult>;
}

/** What only the desktop helpers can do (files beside the installed app). */
export interface DesktopOnly {
    reportStatus(json: string): Promise<boolean>;
    readStagedBuildId(): Promise<string | null>;
    readAppSignals(): Promise<AppSignals>;
    askHelperForUpdate(buildId: string, pluginVersion: string): Promise<AskResult>;
}

/** Where the browser add-on puts its transport. */
export const WEB_TRANSPORT_GLOBAL = "__sublineWebTransport";

/** No app signals: the same answer appSignals.ts gives for an unmanaged install. */
const NO_APP_SIGNALS: AppSignals = { managed: false, appVersion: null, cannotRepair: false };

/** The desktop helpers (native.ts in the main process), or null in a browser. */
function desktop(): Record<string, unknown> | null {
    const helpers = (globalThis as any).VencordNative?.pluginHelpers?.VcTranslate;
    return helpers !== null && typeof helpers === "object" ? helpers : null;
}

function web(): Record<string, unknown> | null {
    const t = (globalThis as any)[WEB_TRANSPORT_GLOBAL];
    return t !== null && typeof t === "object" ? t : null;
}

/** Whether the desktop helpers are here (the desktop app), rather than a browser. */
export function isDesktop(): boolean {
    return desktop() !== null;
}

/**
 * In a browser: call `fn` once if the add-on is updated under this page (the
 * web transport's `onAddonGone`, see pageBridge.js). Nothing on the desktop,
 * or with a transport that cannot tell. Returns the unsubscribe. Never throws.
 */
export function onWebAddonGone(fn: () => void): () => void {
    if (desktop() !== null) return () => { };
    try {
        const subscribe = web()?.onAddonGone;
        if (typeof subscribe !== "function") return () => { };
        const off = subscribe(fn);
        return () => {
            try { if (typeof off === "function") off(); } catch { /* nothing to undo */ }
        };
    } catch {
        return () => { };
    }
}

/** Whether any transport is here at all. */
export function hasTransport(): boolean {
    return desktop() !== null || web() !== null;
}

/** The function `name` of whichever transport is in use, or null. */
function pick(name: keyof SublineTransport): ((...args: any[]) => any) | null {
    const source = desktop() ?? web();
    const fn = source?.[name];
    return typeof fn === "function" ? fn as (...args: any[]) => any : null;
}

/** Call `name`, or reject when no transport has it (as a failed IPC call would). */
async function call<T>(name: keyof SublineTransport, args: unknown[]): Promise<T> {
    const fn = pick(name);
    if (fn === null) throw new Error(`Subline: no transport for ${name}`);
    return await fn(...args) as T;
}

/** A desktop-only call, or `fallback` without the desktop helpers. */
async function desktopCall<T>(name: keyof DesktopOnly, args: unknown[], fallback: T): Promise<T> {
    const helpers = desktop();
    if (helpers === null) return fallback;
    // On the desktop a missing function fails as it always did (the caller
    // catches it): an older main process, not a browser.
    return await (helpers[name] as (...a: unknown[]) => Promise<T>)(...args);
}

export const transport: SublineTransport & DesktopOnly = {
    translateBatch: (...args) => call("translateBatch", args),
    relayStatus: (...args) => call("relayStatus", args),
    relayLink: (...args) => call("relayLink", args),
    relayLinkPoll: (...args) => call("relayLinkPoll", args),
    relayMoveStart: (...args) => call("relayMoveStart", args),
    relayMoveFinish: (...args) => call("relayMoveFinish", args),
    relayCheckout: (...args) => call("relayCheckout", args),
    relayRedeem: (...args) => call("relayRedeem", args),
    relayPatchHealth: async (...args) => {
        const fn = pick("relayPatchHealth");
        return fn === null ? false : await fn(...args);
    },
    relaySendFeedback: async (...args) => {
        const fn = pick("relaySendFeedback");
        return fn === null ? { ok: false, error: "unavailable" } : await fn(...args);
    },
    relayChannels: async (...args) => {
        // An older main process without it: no sync, the choices stay on this computer.
        const fn = pick("relayChannels");
        return fn === null ? { ok: false, error: "unavailable" } : await fn(...args);
    },
    relayPrefs: async (...args) => {
        // An older main process or add-on without it: no sync, the settings stay on this computer.
        const fn = pick("relayPrefs");
        return fn === null ? { ok: false, error: "unavailable" } : await fn(...args);
    },
    reportStatus: (...args) => desktopCall("reportStatus", args, false),
    readStagedBuildId: (...args) => desktopCall("readStagedBuildId", args, null),
    readAppSignals: (...args) => desktopCall("readAppSignals", args, NO_APP_SIGNALS),
    askHelperForUpdate: (...args) => desktopCall("askHelperForUpdate", args, "no-helper")
};
