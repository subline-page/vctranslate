import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, OAuth2AuthorizeModal, openModal, React, RestAPI } from "@webpack/common";

/**
 * LINKING A DISCORD ACCOUNT (0.2.8).
 *
 * Every plan belongs to one Discord account. The reader links it once, with
 * Discord's own Authorize window opened inside Discord: Vencord's
 * `OAuth2AuthorizeModal`, exactly as Vencord's ReviewDB plugin signs in. The
 * scope is `identify` alone (who you are; no servers, no messages, no email),
 * and no bot is involved: the Discord app exists for this window only.
 *
 * Authorize sends Discord to the relay's callback URL with a one-time `code`.
 * The modal does not load that page; it hands the URL to `callback` as
 * `response.location`, and the code is taken from there. index.tsx sends it
 * to the relay (POST /v1/link, through the transport), which exchanges it
 * with Discord, links this install's account and answers like /v1/status.
 * Cancel closes the window and says nothing. Discord (2026-10) no longer
 * honours `cancelCompletesFlow: false`: it calls back on Cancel with
 * `canceled: true` (error=access_denied), which is ignored here.
 */

/** Subline's Discord app. Used for this Authorize window only, never as a bot. */
export const DISCORD_CLIENT_ID = "1559269900269260991";

/** Where Discord sends the code: the relay's static "you can close this window" page. */
export const LINK_REDIRECT_URI = "https://relay.subline.page/v1/link/callback";

export const LINK_SCOPES = ["identify"] as const;

/** Discord's codes are short URL-safe strings; anything else is not one. */
const CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/;

/**
 * The authorization code in the URL Discord answered with, or null. Only the
 * relay's own callback counts: a code meant for another URL is not ours.
 */
export function codeFromLocation(location: unknown): string | null {
    if (typeof location !== "string") return null;
    let url: URL;
    try {
        url = new URL(location);
    } catch {
        return null;
    }
    if (`${url.origin}${url.pathname}` !== LINK_REDIRECT_URI) return null;
    const code = url.searchParams.get("code");
    return code !== null && CODE_RE.test(code) ? code : null;
}

/** Discord's answer for Cancel: the relay callback with error=access_denied (OAuth2's "the user said no"). */
function isCancelLocation(location: unknown): boolean {
    if (typeof location !== "string") return false;
    try {
        const url = new URL(location);
        return `${url.origin}${url.pathname}` === LINK_REDIRECT_URI && url.searchParams.get("error") === "access_denied";
    } catch {
        return false;
    }
}

export interface LinkWindowHandlers {
    /** Authorize was pressed: the code for the relay. */
    onCode: (code: string) => void;
    /** Discord answered with no usable code (an error, or a URL that is not ours). */
    onNoCode: () => void;
    /**
     * The window closed, for any reason: Cancel, its X, Escape, or Discord
     * closing it after Authorize. Called after Discord's own close.
     */
    onClosed?: () => void;
    /** The window threw while rendering. It is already closed when this runs. */
    onCrash?: (error: unknown, componentStack: string) => void;
}

/**
 * Did Vencord find Discord's Authorize window? `OAuth2AuthorizeModal` is a
 * lazy component found by its code (Vencord's waitForComponent). When a
 * Discord update breaks that find, a release build does not throw: it renders
 * nothing, so the window would open empty and nothing would say why. Asking
 * at the press is what rendering would do anyway (the same lazy lookup).
 */
export function authorizeWindowFound(): boolean {
    try {
        const get = (OAuth2AuthorizeModal as { $$vencordGetWrappedComponent?: () => unknown; } | undefined)?.$$vencordGetWrappedComponent;
        if (typeof get !== "function") return OAuth2AuthorizeModal != null;
        return get() != null;
    } catch {
        return false;
    }
}

/**
 * Open Discord's Authorize window. Returns false when it could not be opened
 * at all, or Vencord cannot find it (the caller says so); Cancel calls nothing.
 */
export function openLinkWindow(handlers: LinkWindowHandlers): boolean {
    if (!authorizeWindowFound()) return false;
    const quietly = (run: () => void) => {
        try {
            run();
        } catch {
            // A handler's failure is its own; the window still closes.
        }
    };
    try {
        let key: string | null = null;
        // GUARD. A render error inside Discord's window would otherwise reach
        // Discord's own top-level boundary: the whole app shows "Well, this is
        // awkward". The boundary closes the window instead and draws nothing.
        // It only catches errors inside this subtree (the window's render);
        // an error Discord throws elsewhere, while closing it, is not ours to catch.
        key = openModal((props: any) => React.createElement(ErrorBoundary as any, {
            noop: true,
            onError: ({ error, errorInfo }: { error: unknown; errorInfo?: { componentStack?: string; }; }) => {
                quietly(() => { if (key !== null) closeModal(key); });
                quietly(() => handlers.onCrash?.(error, typeof errorInfo?.componentStack === "string" ? errorInfo.componentStack : ""));
            }
        }, React.createElement(OAuth2AuthorizeModal as any, {
            ...props,
            // Every close: Discord's own first, then ours (the Link bar comes back).
            onClose: () => {
                try {
                    props.onClose?.();
                } finally {
                    quietly(() => handlers.onClosed?.());
                }
            },
            scopes: [...LINK_SCOPES],
            responseType: "code",
            redirectUri: LINK_REDIRECT_URI,
            permissions: 0n,
            clientId: DISCORD_CLIENT_ID,
            cancelCompletesFlow: false,
            callback: (response: { location?: unknown; canceled?: unknown; } | undefined) => {
                try {
                    // Cancel: Discord (2026-10) calls back on Cancel too, then
                    // closes the window. Nothing to say; onClosed puts the bar back.
                    if (response?.canceled === true || isCancelLocation(response?.location)) return;
                    const code = codeFromLocation(response?.location);
                    if (code === null) handlers.onNoCode();
                    else handlers.onCode(code);
                } catch {
                    // A handler's failure is its own; the window still closes.
                }
            }
        })));
        return true;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------- silent re-link -- */

/** How long Discord gets to answer each silent step before the Link bar shows instead. */
export const SILENT_LINK_TIMEOUT_MS = 8_000;

/** The query of Discord's /oauth2/authorize, the same for its check and its approval. */
const silentQuery = () => ({ client_id: DISCORD_CLIENT_ID, response_type: "code", redirect_uri: LINK_REDIRECT_URI, scope: LINK_SCOPES.join(" ") });

function withinTime<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), SILENT_LINK_TIMEOUT_MS); });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * LINK WITH NO WINDOW, for a Discord account that already approved Subline
 * (on another computer, or in the browser). The reader presses Authorize once
 * per Discord account, ever; every other install links by itself.
 *
 * BASIS: Discord's own OAuth2 `prompt=none` behaviour. Discord's client asks
 * GET /oauth2/authorize first; when its body says `authorized: true` (this
 * account approved this app with these scopes), it POSTs the approval with no
 * window, and its own Authorize window auto-submits the same way. These are
 * the same two calls, made with Discord's own HTTP client (Vencord's RestAPI),
 * signed in as the reader.
 *
 * CONSENT RULE (hard): the approval is POSTed ONLY when the GET answered
 * `authorized === true` exactly. Missing, false, any other value, an error or
 * no answer within SILENT_LINK_TIMEOUT_MS: nothing is sent, and the caller
 * shows the Link bar. Subline never approves for an account that has not
 * pressed Authorize itself. A location that codeFromLocation rejects gives no
 * code either.
 *
 * Never throws. `reason` says why there is no code, for the log (no ids, no codes).
 */
export async function silentLinkAttempt(): Promise<{ code: string; reason: "" } | { code: null; reason: string; }> {
    let info: unknown;
    try {
        info = await withinTime(Promise.resolve(RestAPI.get({ url: "/oauth2/authorize", query: silentQuery() })));
    } catch {
        return { code: null, reason: "Discord could not be asked" };
    }
    const body = (info as { body?: unknown; } | null | undefined)?.body;
    if ((body as { authorized?: unknown; } | null | undefined)?.authorized !== true) {
        return { code: null, reason: "this Discord account has not approved Subline yet" };
    }
    let answer: unknown;
    try {
        answer = await withinTime(Promise.resolve(RestAPI.post({ url: "/oauth2/authorize", query: silentQuery(), body: { authorize: true, permissions: "0" } })));
    } catch {
        return { code: null, reason: "Discord did not confirm the approval" };
    }
    const code = codeFromLocation((answer as { body?: { location?: unknown; }; } | null | undefined)?.body?.location);
    return code === null ? { code: null, reason: "Discord's answer had no code for Subline" } : { code, reason: "" };
}

/** The code from a silent re-link, or null (then the Link bar). */
export async function trySilentLink(): Promise<string | null> {
    return (await silentLinkAttempt()).code;
}
