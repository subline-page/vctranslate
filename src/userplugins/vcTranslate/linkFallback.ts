import { DISCORD_CLIENT_ID, LINK_REDIRECT_URI, LINK_SCOPES } from "./link";
import type { RelayLinkPollResponse, RelayRefusal } from "./native";

/**
 * LINKING IN THE BROWSER (0.2.8 spec, "Authorize fallback").
 *
 * Linking is the way in for every new user, and it rests on one Discord
 * component that Vencord finds by its code (`OAuth2AuthorizeModal`). A Discord
 * update that moves it, or a window that throws, must not stop anyone from
 * starting. So, when the window is missing or broke:
 *
 *  1. A random `state` (32 random bytes, base64url) is made here.
 *  2. The first poll (POST /v1/link/poll) goes out BEFORE the browser opens:
 *     it registers the state to this install, so Discord's code reaches only
 *     this computer (relay link.ts THE CODE REACHES ONLY THE COMPUTER THAT
 *     STARTED THE AUTHORIZE).
 *  3. Discord's authorize page opens in the default browser (desktop:
 *     Vencord's openExternal; the add-on: a tab reserved at the click).
 *  4. The poll repeats every 2 seconds for up to 5 minutes. When the
 *     relay could not tie the browser's redirect to this computer, the page
 *     shows a 6-digit code and the poll answers pair_needed: the reader
 *     types it here (askPair), and a wrong one is said with the tries left.
 *  5. The relay links exactly as for the window inside Discord, with the
 *     same account check (`expect`): a browser signed in to another Discord
 *     account is 409 wrong_account, and nothing changes.
 *
 * Free of Discord: every side effect is a dependency, so it is tested alone.
 * Never throws.
 */

/** Discord's own authorize page. */
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const FALLBACK_POLL_EVERY_MS = 2_000;
export const FALLBACK_POLL_FOR_MS = 5 * 60_000;

/** 32 random bytes as base64url (43 characters), as the relay's LINK_STATE_RE accepts. */
export function newLinkState(fill: (bytes: Uint8Array) => Uint8Array = b => crypto.getRandomValues(b)): string {
    const bytes = fill(new Uint8Array(32));
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Discord's authorize page for Subline's app, scope identify, a code to the relay's callback, and `state`. */
export function authorizeUrl(state: string): string {
    const q = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        response_type: "code",
        redirect_uri: LINK_REDIRECT_URI,
        scope: LINK_SCOPES.join(" "),
        state
    });
    return `${DISCORD_AUTHORIZE_URL}?${q.toString()}`;
}

export type FallbackResult =
    /** The relay linked (or moved): its status answer. */
    | { kind: "linked"; answer: Extract<RelayLinkPollResponse, { ok: true; plan: string; }>; }
    /** The relay refused for good: wrong_account, state_expired, discord_refused, rate_limited, a move refusal... */
    | { kind: "refused"; answer: RelayRefusal; }
    /** Nothing came back in 5 minutes. */
    | { kind: "timeout"; }
    /** The browser could not be opened (a blocked tab). */
    | { kind: "blocked"; }
    /**
     * The reader closed the pairing box, or this sign-in no longer belongs
     * here (account switch, stop). Never for a poll that answered linked:
     * the relay linked the sender then, and that is handed back as "linked"
     * even after a switch, so the caller binds the right account.
     */
    | { kind: "cancelled"; };

export interface FallbackDeps {
    /** One poll through the transport (`pair` once the reader typed it). Never throws in practice; a throw is "no answer". */
    poll(state: string, pair?: string): Promise<RelayLinkPollResponse>;
    /** Open the authorize page. False when it could not be opened. */
    open(url: string): boolean | Promise<boolean>;
    /** Ask the reader for the code the browser shows; `triesLeft` after a wrong one. Null: they gave up. */
    askPair(triesLeft: number | null): Promise<string | null>;
    /** Still this sign-in's to finish (the same Discord account, the plugin running). */
    alive(): boolean;
    /** Tests: the random state. */
    state?: string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    log?: (message: string) => void;
}

/**
 * Answers that end the sign-in: anything but a wait, a network fault or a
 * relay hiccup. A 5xx with no code is a page that is not the relay's answer
 * (Cloudflare's edge, a Worker that threw): waited out like a 503. The
 * relay's own refusals always carry a code.
 */
function isFinalRefusal(res: RelayRefusal): boolean {
    if (res.errorCode === undefined) return res.status !== undefined && res.status < 500;
    return res.errorCode !== "unavailable" && res.errorCode !== "discord_unreachable" && res.errorCode !== "pending";
}

/** A poll that answered linked (or moved): the relay did it, whoever is signed in by now. */
function isLinked(res: RelayLinkPollResponse | null): res is Extract<RelayLinkPollResponse, { ok: true; plan: string; }> {
    return res !== null && res.ok && !("waiting" in res);
}

/** See the header. Resolves when the sign-in links, ends, or runs out of time. Never throws. */
export async function runBrowserLink(deps: FallbackDeps): Promise<FallbackResult> {
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const log = deps.log ?? (() => { });
    const state = deps.state ?? newLinkState();
    const deadline = now() + FALLBACK_POLL_FOR_MS;
    let pair: string | undefined;

    const ask = async (): Promise<RelayLinkPollResponse | null> => {
        try {
            return await deps.poll(state, pair);
        } catch {
            return null;
        }
    };

    // 2. Register the state before the browser can send the code.
    const first = await ask();
    if (isLinked(first)) return { kind: "linked", answer: first };
    if (!deps.alive()) return { kind: "cancelled" };
    if (first !== null && !first.ok && isFinalRefusal(first)) return { kind: "refused", answer: first };
    if (first === null || !first.ok) log("browser sign-in: the first poll did not register the state; the page may show a pairing code");

    // 3. The browser.
    let opened: boolean;
    try {
        opened = await deps.open(authorizeUrl(state));
    } catch {
        opened = false;
    }
    if (!opened) return { kind: "blocked" };

    // 4. Wait for Discord's redirect.
    let triesLeft: number | null = null;
    let needsPair = first !== null && first.ok && "waiting" in first && first.waiting === "pair_needed";
    while (now() < deadline) {
        if (needsPair) {
            let typed: string | null;
            try {
                typed = await deps.askPair(triesLeft);
            } catch {
                typed = null;
            }
            if (typed === null || !deps.alive()) return { kind: "cancelled" };
            pair = typed;
            needsPair = false;
        } else {
            await sleep(FALLBACK_POLL_EVERY_MS);
            if (!deps.alive()) return { kind: "cancelled" };
        }
        const res = await ask();
        // Linked while the account switched: still handed back (see "cancelled").
        if (isLinked(res)) return { kind: "linked", answer: res };
        if (!deps.alive()) return { kind: "cancelled" };
        if (res === null) continue;
        if (res.ok) {
            if (res.waiting === "pair_needed") needsPair = true;
            continue;
        }
        if (res.errorCode === "pair_wrong") {
            triesLeft = typeof res.triesLeft === "number" ? res.triesLeft : null;
            needsPair = true;
            continue;
        }
        if (isFinalRefusal(res)) return { kind: "refused", answer: res };
    }
    return { kind: "timeout" };
}
