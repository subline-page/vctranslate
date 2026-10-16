import { PLUGIN_VERSION } from "../buildStamp";
import { HttpError } from "../httpError";
import type { BatchRequest, Result } from "../types";
import { offListFrom } from "../surfaces/features";
import { cleanPrefEntries, type PrefEntry, type PrefKey } from "../prefShape";

/**
 * Sent on every relay request so the relay can tell a client that knows about
 * the free trial and ✦ previews (v0.1.6 and later) from an older one. Its
 * PRESENCE is the signal, not the number: no earlier build ever sent it, so the
 * relay keeps treating a request without it exactly as it always has. It
 * identifies the build, never the user.
 */
export const CLIENT_HEADER = "x-subline-client";
export const CLIENT_ID = `vcTranslate/${PLUGIN_VERSION}`;

/**
 * The paid-only model, with account linking (0.2.8). Every request says so
 * with `x-subline-api: 3`, and names the install it comes from with
 * `x-subline-install: free_<hex>`, so the relay can join the install to its
 * account. API 3 means "this client can link a Discord account": the relay
 * then entitles nothing until the install is linked (`linked: false` on
 * status, 402/403 `not_linked` elsewhere). API 2 (0.2.7 and older) keeps
 * today's rules, and without the api header the relay answers exactly as it
 * did for v0.1.9 and earlier, which is what keeps older installs working until
 * they update.
 */
export const API_HEADER = "x-subline-api";
export const API_VERSION = "3";
export const INSTALL_HEADER = "x-subline-install";
/**
 * "This install was used before 0.2.0" (a local trial start, or an install id
 * older than the installer-seeded one). Only a hint: the relay grants the
 * early-user Automatic only if it already has a record of this id from before
 * its launch moment. Sent until the relay has answered once.
 */
export const PRIOR_HEADER = "x-subline-prior";
/**
 * "Check this code, do not link it": a typed code is checked first, so a
 * mistyped or someone else's code never takes one of an account's 3
 * computers. The reader confirms, then a normal status call links it.
 */
export const CHECK_HEADER = "x-subline-check";

/**
 * The app this plugin runs in (0.2.8): the desktop app's version from
 * app-version.json (`0.2.8`), or the browser add-on's (`addon/0.2.8`). The
 * owner page shows it beside the Subline version and counts add-on computers
 * (relay/src/versions.ts appVersionOf). It names the app, never the user.
 *
 * WHO SETS IT. Whatever process runs these requests: native.ts in Discord's
 * main process (desktop), the add-on's background.ts in the browser. Nothing
 * else does, so tests and any other process send no header, as before.
 */
export const APP_HEADER = "x-subline-app";
/** The relay's own check (relay/src/versions.ts APP_VERSION_RE): anything else is left out, never sent. */
const APP_HEADER_SHAPE = /^(?:addon\/)?\d{1,4}(?:\.\d{1,4}){1,3}$/;

let appSource: () => unknown = () => null;

/** Name the app for every relay request from now on. Asked on each request; it must be cheap. */
export function setRelayAppSource(source: () => string | null): void {
    appSource = source;
}

/** The header's value, or null to leave it out. Never throws: a request never fails over this. */
export function relayAppHeaderValue(): string | null {
    try {
        const v = appSource();
        return typeof v === "string" && APP_HEADER_SHAPE.test(v) ? v : null;
    } catch {
        return null;
    }
}

/** Optional extras on a v2 status request. */
export interface StatusOptions {
    prior?: boolean;
    check?: boolean;
}

/** The headers every v2 relay request carries. `install` is the install bearer ("free_<hex>"). */
export function relayHeaders(credential: string, install?: string, json = false, options: StatusOptions = {}): Record<string, string> {
    const h: Record<string, string> = {
        authorization: `Bearer ${credential}`,
        [CLIENT_HEADER]: CLIENT_ID,
        [API_HEADER]: API_VERSION
    };
    if (install) h[INSTALL_HEADER] = install;
    const app = relayAppHeaderValue();
    if (app !== null) h[APP_HEADER] = app;
    if (options.prior) h[PRIOR_HEADER] = "1";
    if (options.check) h[CHECK_HEADER] = "1";
    if (json) h["content-type"] = "application/json";
    return h;
}

/**
 * The relay's own error word ("device_limit", "claimed"...), when its body had
 * one. The checkout's "checkout unavailable" (it has a space) is filed as
 * "checkout_unavailable", so the renderer can tell it apart from a network
 * failure.
 */
function withErrorCode<E extends Error>(err: E, body: any): E {
    if (!body || typeof body.error !== "string") return err;
    // 0.2.8 details some refusals carry, each checked before it rides along:
    // the date a plan may move again, the pairing tries left, and "this
    // account moved that key away itself".
    if (typeof body.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.until)) (err as any).until = body.until;
    if (Number.isInteger(body.triesLeft) && body.triesLeft >= 0 && body.triesLeft <= 100) (err as any).triesLeft = body.triesLeft;
    if (body.moved === true) (err as any).moved = true;
    // A promo claimed too often from one network: the relay keeps the older
    // word ("rate_limited") and says why in `reason`.
    if (body.error === "rate_limited" && body.reason === "net_limited") (err as any).errorCode = "net_limited";
    else if (/^[a-z_]{1,40}$/.test(body.error)) (err as any).errorCode = body.error;
    else if (body.error === "checkout unavailable") (err as any).errorCode = "checkout_unavailable";
    return err;
}

/**
 * The Subline relay: keyless AI translation. The user's "key" is an opaque
 * CODE, not a provider key, and the request goes to Subline's own Worker, which
 * holds the paid Groq key and returns the SAME shape a direct provider call
 * would (see relay/). So this engine is a thin poster — the relay owns the
 * model and the prompt.
 *
 * REPLACE this URL with your deployed Worker's URL (see relay/README.md). It is
 * a compiled constant, not a setting, for the same reason RELEASE_FEED_URL is:
 * a translation endpoint that a config file could repoint is a way to exfiltrate
 * message text, and there must be nothing to repoint.
 */
export const RELAY_URL = "https://relay.subline.page/v1/translate";

/**
 * "How much of today's allowance has this credential spent?", asked without
 * spending any of it.
 *
 * A compiled constant for exactly the reason RELAY_URL is (see above): it
 * carries the same bearer, so a config file that could repoint it would be a
 * way to harvest install ids.
 *
 * Only the TASTE tier reads this. A paid code has no daily count worth showing,
 * and learns its per-minute ceiling from the translate responses it is already
 * making; an Automatic owner has five previews a day and has to know how many are
 * left after a Discord restart, without buying one to find out.
 */
export const RELAY_STATUS_URL = "https://relay.subline.page/v1/status";

/**
 * One relay round trip: the translations, plus the ceiling the relay states
 * for this code (`rpmLimit`, requests per minute). The ceiling is what lets
 * the renderer's rate gate run at the relay's real rate instead of its
 * untaught guess — see rateGate.ts. Absent on an older relay, and then the
 * gate simply keeps whatever it has.
 *
 * `used`/`cap` are the preview allowance's daily count (previews used today, out of
 * five). The relay states them on every success; they used to be parsed and
 * dropped here, which meant the only way for a free install to learn its own
 * count was to spend one. Absent for a paid code, and then nothing downstream
 * shows a count at all.
 */
export interface RelayOutcome {
    results: Result[];
    rpmLimit?: number;
    used?: number;
    cap?: number;
    /** The relay's own clock (epoch ms), stated to v0.1.6 clients. */
    serverNow?: number;
}

/** What /v1/status says about this credential. See RELAY_STATUS_URL. */
export interface RelayStatus {
    /** "taste" for a free install id; whatever the relay calls a paid code. */
    plan: string;
    /** Messages spent today. */
    used: number;
    /** The day's allowance (3 on the taste tier). */
    cap: number;
    /**
     * When this free install's trial ends (or ended), epoch ms, as the relay
     * recorded it. Only a relay that knows about trials states it, and only
     * for a free install id; absent otherwise.
     */
    trialEndsAt?: number;
    /** The relay's own clock (epoch ms), for the skew correction in freePlan.ts. */
    serverNow?: number;
    /** The relay has not started a trial for this id yet: `trialEndsAt` is only "now + 7 days". */
    trialProvisional?: boolean;
    /**
     * A purchase made from this install (a checkout the plugin opened), once the
     * relay has linked it: the license key to save as the Subline code. Only
     * ever sent to the holder of the free id the checkout was opened with.
     */
    purchase?: { code: string; plan: string };
    /* ---- v2 (paid-only) fields. Present together, or not at all. ---- */
    /** Whether the account behind this install owns Automatic. */
    automatic?: boolean;
    /** Whether it has AI (✦ on everything) right now. */
    ai?: boolean;
    /** When the AI period ends (epoch ms), if stated. */
    aiUntil?: number;
    /** A code this install should save (a purchase, a promo or an early-user grant). */
    code?: string;
    /** Today's ✦ previews for an Automatic owner. */
    previews?: { used: number; cap: number };
    /** The relay's signed entitlement token, and when it (and so Automatic offline) runs out. */
    token?: string;
    tokenExpiresAt?: number;
    /** The code presented is dead (lapsed, refunded, revoked, unknown). */
    deadCode?: string;
    /** "early": this answer first granted the early-user Automatic. */
    grant?: "early";
    /** The answer to a check-only request (x-subline-check): nothing was linked. */
    check?: { valid: boolean; automatic: boolean; ai: boolean };
    /**
     * API 3: whether this install's account is linked to a Discord account.
     * False means nothing is entitled until it is. Absent from an older relay,
     * which is "not stated", never "not linked".
     */
    linked?: boolean;
    /**
     * A link answer only: the saved code was left out of the link, and why
     * (another Discord account's, or held by another computer). The app
     * drops it, as it would on a status 409.
     */
    codeRefused?: "code_on_other_account" | "code_in_use";
    /** A link answer only: the left-out code is one this account moved away itself (Move my plan), not a stranger's. */
    codeMoved?: boolean;
    /**
     * API 3, not linked: this computer had the plan before 0.2.8 (a prior
     * payer). The plan is answered as usual and keeps working; the app shows
     * the Link bar until it links. Never a block.
     */
    mustLink?: boolean;
    /**
     * API 3, not linked, nothing owned: a purchase was started from this
     * install (a 0.2.7 checkout whose webhooks have not landed). It will
     * reach whichever account links this install, so the Link asks the
     * account confirm first and is never made silently.
     */
    pendingPurchase?: boolean;
    /** A Move my plan answer: the plan moved into this account. */
    moved?: boolean;
    /**
     * The owner's off switch: the features switched off for everyone. Absent
     * when the relay left it out (its read failed) or sent it malformed; the
     * plugin then keeps the last list it had.
     */
    off?: string[];
}

/** POST /v1/redeem: a promo code for this install. A compiled constant, like RELAY_URL. */
export const RELAY_REDEEM_URL = "https://relay.subline.page/v1/redeem";

/**
 * Redeem a promo code for this install. Returns the Subline code the relay
 * minted. Throws an HttpError carrying the relay's error word (`errorCode`:
 * "not_found", "claimed", "already", "rate_limited", "unavailable").
 */
export async function fetchRelayRedeem(
    install: string,
    promo: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = CHECKOUT_TIMEOUT_MS
): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_REDEEM_URL, {
            method: "POST",
            headers: relayHeaders(install, install, true),
            body: JSON.stringify({ code: promo }),
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (!res.ok || !body || body.ok !== true || typeof body.code !== "string" || body.code.trim() === "" || body.code.length > 200) {
            const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
            throw withErrorCode(new HttpError(`relay redeem: HTTP ${res.status}${detail}`, res.status), body);
        }
        return body.code.trim();
    } finally {
        clearTimeout(timer);
    }
}

/** POST /v1/patch-health: which Subline patches did not apply (patchHealth.ts). A compiled constant, like RELAY_URL. */
export const RELAY_PATCH_HEALTH_URL = "https://relay.subline.page/v1/patch-health";

/** A patch report is diagnostics: it never waits long. */
export const PATCH_HEALTH_TIMEOUT_MS = 10_000;

/**
 * Send one patch health report for this install. Resolves true when the relay
 * took it (200), "rejected" when it refused the report's shape (400: an older
 * relay that does not know a plugin name this client reports), false on
 * anything else. Never throws, never rejects.
 */
export async function postPatchHealth(
    install: string,
    reportJson: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = PATCH_HEALTH_TIMEOUT_MS
): Promise<boolean | "rejected"> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_PATCH_HEALTH_URL, {
            method: "POST",
            headers: relayHeaders(install, install, true),
            body: reportJson,
            signal: controller.signal
        });
        return res.ok ? true : res.status === 400 ? "rejected" : false;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * POST /v1/feedback: what the reader chose to send from Subline's settings
 * (feedback.ts). Built from RELAY_URL, so it always goes to the same relay as
 * translation and moves with it. A compiled constant, like RELAY_URL.
 */
export const RELAY_FEEDBACK_URL = new URL("/v1/feedback", RELAY_URL).href;

/** Sending feedback waits a little longer than a patch report: a person is watching. */
export const FEEDBACK_TIMEOUT_MS = 15_000;

/** The relay's answer to a feedback post. `error` is a short word, never remote prose. */
export type FeedbackPostResult =
    | { ok: true; id: string }
    | { ok: false; error: "rate_limited" | "rejected" | "unavailable" | "network"; status?: number };

/**
 * Send one feedback item for this install. Never throws, never rejects: any
 * failure is a short word the settings box turns into a calm sentence.
 */
export async function postFeedback(
    install: string,
    payloadJson: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = FEEDBACK_TIMEOUT_MS
): Promise<FeedbackPostResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_FEEDBACK_URL, {
            method: "POST",
            headers: relayHeaders(install, install, true),
            body: payloadJson,
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (res.ok && body && body.ok === true && typeof body.id === "string" && body.id.length <= 40) return { ok: true, id: body.id };
        const error = res.status === 429 ? "rate_limited" : res.status === 400 || res.status === 413 ? "rejected" : "unavailable";
        return { ok: false, error, status: res.status };
    } catch {
        return { ok: false, error: "network" };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Create a Dodo checkout session through the relay, tagged with this install
 * (see checkout.ts). A compiled constant for the same reason RELAY_URL is.
 */
export const RELAY_CHECKOUT_URL = "https://relay.subline.page/v1/checkout";

/** How long a checkout request may take before the static link is used instead. */
export const CHECKOUT_TIMEOUT_MS = 10_000;

/**
 * POST /v1/checkout. Returns the checkout URL, or throws an HttpError that
 * the caller treats as "use the static link".
 */
export async function fetchRelayCheckout(
    code: string,
    plan: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = CHECKOUT_TIMEOUT_MS,
    install?: string
): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_CHECKOUT_URL, {
            method: "POST",
            headers: relayHeaders(code, install, true),
            body: JSON.stringify({ plan }),
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (!res.ok || !body || body.ok !== true || typeof body.url !== "string") {
            const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
            throw withErrorCode(new HttpError(`relay checkout: HTTP ${res.status}${detail}`, res.status), body);
        }
        return body.url;
    } finally {
        clearTimeout(timer);
    }
}

/** A well-formed `purchase` from a status body, or undefined. */
function purchaseFrom(value: unknown): { code: string; plan: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { code, plan } = value as { code?: unknown; plan?: unknown };
    if (typeof code !== "string" || code.trim() === "" || code.length > 200) return undefined;
    return { code: code.trim(), plan: typeof plan === "string" ? plan : "" };
}

/** A non-negative, finite integer the relay stated, or undefined. */
function countFrom(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

/**
 * Read today's count for a credential without spending one.
 *
 * Throws an HttpError on any failure, exactly as translateWithRelayDetailed
 * does, so native.ts can map it the same way. The caller treats a failure as
 * "count unknown" — never as "nothing left" — because a status endpoint that
 * is briefly unreachable must not take a paid install's plan away.
 */
/**
 * How long one /v1/status call may take (P9). Without it a relay that
 * accepted the connection and never answered held the call for Node's 300s
 * headers timeout, and the entitlement retry (which waits for the call to
 * end) with it.
 */
export const STATUS_TIMEOUT_MS = 15_000;

export async function fetchRelayStatus(
    code: string,
    fetchImpl: typeof fetch = fetch,
    install?: string,
    options: StatusOptions = {},
    timeoutMs: number = STATUS_TIMEOUT_MS
): Promise<RelayStatus> {
    const res = await fetchImpl(RELAY_STATUS_URL, {
        method: "GET",
        headers: relayHeaders(code, install, false, options),
        ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? { signal: AbortSignal.timeout(timeoutMs) }
            : {})
    });

    let body: any = null;
    try { body = await res.json(); } catch { /* fall through to the status check */ }

    if (!res.ok || !body || body.ok !== true) {
        const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
        throw withErrorCode(new HttpError(
            `relay: HTTP ${res.status}${detail}`,
            res.status,
            body && typeof body.retryAfterMs === "number" ? body.retryAfterMs : undefined
        ), body);
    }

    // A v2 answer (the paid-only model): the entitlement, and no daily count
    // unless the install is an Automatic owner with previews.
    // (An API 3 "not linked" answer counts too, even without `automatic`.)
    if (typeof body.automatic === "boolean" || typeof body.linked === "boolean") return v2StatusFrom(body);

    // Validated rather than blind-cast, on the same principle as the results
    // array below: a malformed count reaching the renderer would be shown to
    // the user as the number of tastes they have left.
    const used = countFrom(body.used);
    const cap = countFrom(body.cap);
    if (used === undefined || cap === undefined || cap === 0) {
        throw new HttpError("relay: malformed status", 502);
    }
    const trialEndsAt = typeof body.trialEndsAt === "number" && Number.isFinite(body.trialEndsAt) && body.trialEndsAt > 0
        ? body.trialEndsAt
        : undefined;
    const serverNow = typeof body.now === "number" && Number.isFinite(body.now) && body.now > 0 ? body.now : undefined;
    return {
        plan: typeof body.plan === "string" ? body.plan : "", used, cap, trialEndsAt, serverNow,
        trialProvisional: body.trialProvisional === true ? true : undefined,
        purchase: purchaseFrom(body.purchase)
    };
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** A v2 status body, field by field. Anything malformed is dropped, never trusted. */
function v2StatusFrom(body: any): RelayStatus {
    const used = countFrom(body.previews?.used);
    const cap = countFrom(body.previews?.cap);
    const previews = used !== undefined && cap !== undefined ? { used, cap } : undefined;
    const code = typeof body.code === "string" && body.code.trim() !== "" && body.code.length <= 200 ? body.code.trim() : undefined;
    return {
        plan: typeof body.plan === "string" ? body.plan : "",
        used: previews?.used ?? 0,
        cap: previews?.cap ?? 0,
        serverNow: positive(body.now) ? body.now : undefined,
        automatic: body.automatic === true,
        ai: body.ai === true,
        aiUntil: positive(body.aiUntil) ? body.aiUntil : undefined,
        code,
        previews,
        token: typeof body.token === "string" && body.token.length <= 4096 ? body.token : undefined,
        tokenExpiresAt: positive(body.tokenExpiresAt) ? body.tokenExpiresAt : undefined,
        purchase: purchaseFrom(body.purchase),
        deadCode: typeof body.deadCode === "string" && body.deadCode.trim() !== "" && body.deadCode.length <= 200
            ? body.deadCode.trim() : undefined,
        grant: body.grant === "early" ? "early" : undefined,
        check: body.check && typeof body.check === "object" && typeof body.check.valid === "boolean"
            ? { valid: body.check.valid, automatic: body.check.automatic === true, ai: body.check.ai === true }
            : undefined,
        linked: typeof body.linked === "boolean" ? body.linked : undefined,
        codeRefused: body.codeRefused === "code_on_other_account" || body.codeRefused === "code_in_use" ? body.codeRefused : undefined,
        codeMoved: body.codeMoved === true ? true : undefined,
        mustLink: body.mustLink === true ? true : undefined,
        pendingPurchase: body.pendingPurchase === true ? true : undefined,
        moved: body.moved === true ? true : undefined,
        off: offListFrom(body.off)
    };
}

/**
 * POST /v1/link: the code Discord's Authorize window handed back (link.ts),
 * for the relay to exchange with Discord and link this install's account to
 * that Discord account. A compiled constant, like RELAY_URL.
 */
export const RELAY_LINK_URL = "https://relay.subline.page/v1/link";

/** A link waits on the relay AND on Discord behind it, while a person watches. */
export const LINK_TIMEOUT_MS = 20_000;

/**
 * Link this install's account to the Discord account that authorized `code`.
 * The usual headers (the saved code or the install bearer as the credential,
 * the install bearer as x-subline-install) and `{ code, expect }`: `expect`
 * is the signed-in Discord account's id (0.2.8, EVERY BIND NAMES THE
 * ACCOUNT). The relay compares it with the account Discord authorized before
 * it binds anything, and never stores it. The answer is a status answer (plus
 * `linked: true`), read exactly as fetchRelayStatus reads one. Throws an
 * HttpError carrying the relay's word on a refusal ("bad_code",
 * "discord_refused", "discord_unreachable", "unavailable", "rate_limited",
 * "wrong_account", "plan_held").
 */
export async function fetchRelayLink(
    credential: string,
    install: string,
    code: string,
    expect: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = LINK_TIMEOUT_MS
): Promise<RelayStatus> {
    return postForStatus(RELAY_LINK_URL, "relay link", credential, install, { code, expect }, fetchImpl, timeoutMs);
}

/** POST `payload` with the usual headers: a status-shaped answer, or an HttpError with the relay's word. */
async function postForStatus(
    url: string, what: string, credential: string, install: string, payload: unknown, fetchImpl: typeof fetch, timeoutMs: number
): Promise<RelayStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: "POST",
            headers: relayHeaders(credential, install, true),
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (!res.ok || !body || body.ok !== true || (typeof body.automatic !== "boolean" && typeof body.linked !== "boolean")) {
            const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
            throw withErrorCode(new HttpError(`${what}: HTTP ${res.status}${detail}`, res.status), body);
        }
        return v2StatusFrom(body);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * POST /v1/link/poll: the browser fallback (linkFallback.ts). When Discord's
 * Authorize window cannot open inside Discord, the app opens Discord's
 * authorize page in the browser with a random `state`, and asks here every 2
 * seconds whether Discord's redirect has reached the relay. A compiled
 * constant, like RELAY_URL.
 */
export const RELAY_LINK_POLL_URL = "https://relay.subline.page/v1/link/poll";

/** What one poll said: still waiting, the pairing code is needed, or linked. */
export type LinkPollOutcome =
    | { kind: "pending"; }
    | { kind: "pair_needed"; }
    | { kind: "linked"; status: RelayStatus; };

/**
 * One poll: `{ state, expect }`, plus the pairing code the browser showed
 * (`pair`) and a move ticket (`ticket`, Move my plan) when given. 202
 * `pending` and 202 `pair_needed` are waits; 200 is the link answer, read
 * like a status. Anything else throws an HttpError with the relay's word
 * ("pair_wrong" with triesLeft, "state_expired", "state_taken",
 * "wrong_account", and the link and move refusals).
 */
export async function fetchRelayLinkPoll(
    credential: string,
    install: string,
    request: { state: string; expect: string; pair?: string; ticket?: string; },
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = LINK_TIMEOUT_MS
): Promise<LinkPollOutcome> {
    const payload: Record<string, string> = { state: request.state, expect: request.expect };
    if (request.pair !== undefined) payload.pair = request.pair;
    if (request.ticket !== undefined) payload.ticket = request.ticket;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_LINK_POLL_URL, {
            method: "POST",
            headers: relayHeaders(credential, install, true),
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (res.status === 202 && body && body.ok === false && (body.error === "pending" || body.error === "pair_needed")) {
            return { kind: body.error };
        }
        if (res.status !== 200 || !body || body.ok !== true || (typeof body.automatic !== "boolean" && typeof body.linked !== "boolean")) {
            const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
            throw withErrorCode(new HttpError(`relay link poll: HTTP ${res.status}${detail}`, res.status), body);
        }
        return { kind: "linked", status: v2StatusFrom(body) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * MOVE MY PLAN (0.2.8): POST /v1/move/start from a linked computer of the
 * account that holds the plan answers a one-time ticket (10 minutes); POST
 * /v1/move/finish `{ ticket, code, expect }` from the new account, after its
 * Authorize, moves the plan. Compiled constants, like RELAY_URL.
 */
export const RELAY_MOVE_START_URL = "https://relay.subline.page/v1/move/start";
export const RELAY_MOVE_FINISH_URL = "https://relay.subline.page/v1/move/finish";
/** A move ticket as the relay makes them: 32 random bytes, base64url. */
export const MOVE_TICKET_RE = /^[A-Za-z0-9_-]{43}$/;

/** The ticket, or an HttpError with the relay's word ("move_too_soon" with `until`, "no_plan", "not_linked"). */
export async function fetchRelayMoveStart(
    credential: string,
    install: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = CHECKOUT_TIMEOUT_MS
): Promise<{ ticket: string; expiresAt: number; }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_MOVE_START_URL, {
            method: "POST",
            headers: relayHeaders(credential, install, true),
            body: "{}",
            signal: controller.signal
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (!res.ok || !body || body.ok !== true || typeof body.ticket !== "string" || !MOVE_TICKET_RE.test(body.ticket)) {
            const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
            throw withErrorCode(new HttpError(`relay move start: HTTP ${res.status}${detail}`, res.status), body);
        }
        return { ticket: body.ticket, expiresAt: positive(body.expiresAt) ? body.expiresAt : 0 };
    } finally {
        clearTimeout(timer);
    }
}

/** The new account's status answer (plus `moved: true`), or an HttpError with the relay's word. */
export async function fetchRelayMoveFinish(
    credential: string,
    install: string,
    ticket: string,
    code: string,
    expect: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = LINK_TIMEOUT_MS
): Promise<RelayStatus> {
    return postForStatus(RELAY_MOVE_FINISH_URL, "relay move finish", credential, install, { ticket, code, expect }, fetchImpl, timeoutMs);
}

/** How long one ✦ batch may take. An LLM answer can take seconds; a stall is not that. */
export const TRANSLATE_TIMEOUT_MS = 30_000;

export async function translateWithRelay(
    req: BatchRequest,
    code: string,
    fetchImpl: typeof fetch = fetch
): Promise<Result[]> {
    return (await translateWithRelayDetailed(req, code, fetchImpl)).results;
}

export async function translateWithRelayDetailed(
    req: BatchRequest,
    code: string,
    fetchImpl: typeof fetch = fetch,
    install?: string,
    // A stalled socket (wake from sleep, a Wi-Fi switch) otherwise waits out
    // Node's 300s headers timeout while the batch sits in flight. An abort is
    // a transport failure, so the usual cooldown and retry paths take it.
    timeoutMs: number = TRANSLATE_TIMEOUT_MS
): Promise<RelayOutcome> {
    const res = await fetchImpl(RELAY_URL, {
        method: "POST",
        headers: relayHeaders(code, install, true),
        body: JSON.stringify(req),
        ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? { signal: AbortSignal.timeout(timeoutMs) }
            : {})
    });

    // The relay speaks NativeResponse: { ok:true, results } | { ok:false, error, retryAfterMs }.
    // Throw an HttpError on any failure so native.ts's translateBatch maps it to
    // { ok:false, error, retryAfterMs } exactly as it does for the keyed engines
    // — including the 429 → pause-the-queue path (httpStatus reads "HTTP 429").
    let body: any = null;
    try { body = await res.json(); } catch { /* fall through to the status check */ }

    if (!res.ok || !body || body.ok !== true) {
        const detail = body && typeof body.error === "string" ? ` ${body.error}` : "";
        const err = new HttpError(
            `relay: HTTP ${res.status}${detail}`,
            res.status,
            body && typeof body.retryAfterMs === "number" ? body.retryAfterMs : undefined,
            // A rate-limit 429 states the ceiling it enforced; native.ts hands
            // it to the renderer, which retunes its gate to it (enterCooldown).
            body && typeof body.quotaLimitPerMinute === "number" && body.quotaLimitPerMinute > 0
                ? body.quotaLimitPerMinute
                : undefined
        );
        // The relay's own error word ("ai_required", "device_limit"...), so
        // the renderer can tell an entitlement refusal from a network fault.
        withErrorCode(err, body);
        if (body && typeof body.now === "number") (err as any).serverNow = body.now;
        throw err;
    }
    // Validate rather than blind-cast: the relay is our own server, but a
    // corrupted or hostile response must not inject malformed entries into the
    // store. Keep only rows that match the Result union; anything else is
    // dropped, and native.ts treats a short/empty array as it treats any
    // partial engine result.
    if (!Array.isArray(body.results)) throw new HttpError("relay: malformed response", 502);
    const results = (body.results as unknown[]).filter((r): r is Result => {
        if (!r || typeof r !== "object" || typeof (r as any).id !== "string") return false;
        const o = r as any;
        if (o.failed === true) return true;
        if (o.skip === true) return true;
        return o.skip === false && typeof o.lang === "string" && typeof o.text === "string";
    }).map(r => {
        // A preview flag that is anything but `true` is dropped, so nothing
        // downstream can mistake a malformed flag for a full translation or
        // the other way round.
        if ("truncated" in r && (r as { truncated?: unknown }).truncated !== true) {
            const { truncated: _drop, ...rest } = r as Result & { truncated?: unknown };
            return rest as Result;
        }
        return r;
    });
    const rpmLimit = typeof body.rpmLimit === "number" && body.rpmLimit > 0 ? body.rpmLimit : undefined;
    // Same validation as fetchRelayStatus, for the same reason: these two
    // numbers are shown to a free user as "how many tastes are left today".
    const cap = countFrom(body.cap);
    return {
        results,
        rpmLimit,
        used: countFrom(body.used),
        cap: cap === 0 ? undefined : cap,
        serverNow: typeof body.now === "number" && Number.isFinite(body.now) && body.now > 0 ? body.now : undefined
    };
}

/**
 * THE 🌐 CHOICES OF A LINKED ACCOUNT (relay/src/channels.ts). GET answers the
 * account's salt and its entries (hash -> { s, at }); POST `{ salt, changes }`
 * merges changes in (last write wins). A compiled constant, like RELAY_URL.
 */
export const RELAY_CHANNELS_URL = "https://relay.subline.page/v1/channels";
/** Sync is background work: a stalled call gives way, and the next sync tries again. */
export const CHANNELS_TIMEOUT_MS = 10_000;

export type ChannelSyncState = "on" | "off" | "default";
export interface ChannelSyncEntry { s: ChannelSyncState; at: number; }

/**
 * A channels answer. `error` is a short word: "not_linked" (keep the choices
 * here only), "salt_changed" (the list was reset: fetch again), "rejected"
 * (400/413: these changes will never be taken), "rate_limited", "unavailable"
 * (5xx or an answer that makes no sense), "network" (no answer: offline, a
 * timeout). Never remote prose.
 */
export type RelayChannelsResult =
    | { ok: true; salt: string; ch?: Record<string, ChannelSyncEntry>; now?: number; }
    | { ok: false; error: "not_linked" | "salt_changed" | "rejected" | "rate_limited" | "unavailable" | "network"; status?: number; };

const CHANNEL_HASH_RE = /^[0-9a-f]{16}$/;
const CHANNEL_STATES: readonly string[] = ["on", "off", "default"];

/** The entries of an answer, each checked; anything malformed is left out. */
export function cleanChannelEntries(raw: unknown): Record<string, ChannelSyncEntry> {
    const out: Record<string, ChannelSyncEntry> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [h, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!CHANNEL_HASH_RE.test(h) || !v || typeof v !== "object") continue;
        const { s, at } = v as { s?: unknown; at?: unknown; };
        if (typeof s === "string" && CHANNEL_STATES.includes(s) && typeof at === "number" && Number.isFinite(at) && at >= 0) {
            out[h] = { s: s as ChannelSyncState, at };
        }
    }
    return out;
}

/**
 * GET /v1/channels (no `bodyJson`) or POST it (`bodyJson`). Never throws,
 * never rejects.
 */
export async function fetchRelayChannels(
    credential: string,
    install: string,
    bodyJson?: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = CHANNELS_TIMEOUT_MS
): Promise<RelayChannelsResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_CHANNELS_URL, bodyJson === undefined
            ? { method: "GET", headers: relayHeaders(credential, install), signal: controller.signal }
            : { method: "POST", headers: relayHeaders(credential, install, true), body: bodyJson, signal: controller.signal });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (res.ok && body && body.ok === true && typeof body.salt === "string" && CHANNEL_HASH_RE.test(body.salt)) {
            return {
                ok: true,
                salt: body.salt,
                ...(bodyJson === undefined ? { ch: cleanChannelEntries(body.ch) } : {}),
                ...(positive(body.now) ? { now: body.now } : {})
            };
        }
        const word = body && typeof body.error === "string" ? body.error : "";
        const error = res.status === 409 && word === "not_linked" ? "not_linked"
            : res.status === 409 && word === "salt_changed" ? "salt_changed"
                : res.status === 400 || res.status === 413 ? "rejected"
                    : res.status === 429 ? "rate_limited"
                        : "unavailable";
        return { ok: false, error, status: res.status };
    } catch {
        return { ok: false, error: "network" };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * THE SUBLINE SETTINGS OF A LINKED ACCOUNT (relay/src/prefs.ts). GET answers
 * the account's settings (key -> { value, at }); POST `{ prefs }` merges them
 * in (last write wins per setting) and answers the merged settings.
 */
export const RELAY_PREFS_URL = "https://relay.subline.page/v1/prefs";
/** Sync is background work: a stalled call gives way, and the next sync tries again. */
export const PREFS_TIMEOUT_MS = 10_000;

/**
 * A prefs answer. `error` is a short word: "not_linked" (keep the settings
 * here only), "rejected" (400/413: never taken), "rate_limited", "missing"
 * (404: a relay without this endpoint yet), "unavailable" (5xx or an answer
 * that makes no sense), "network" (no answer: offline, a timeout). Never
 * remote prose.
 */
export type RelayPrefsResult =
    | { ok: true; prefs: Partial<Record<PrefKey, PrefEntry>>; now?: number; }
    | { ok: false; error: "not_linked" | "rejected" | "rate_limited" | "missing" | "unavailable" | "network"; status?: number; };

/**
 * GET /v1/prefs (no `bodyJson`) or POST it (`bodyJson`). Unknown or
 * malformed settings in the answer are left out. Never throws, never rejects.
 */
export async function fetchRelayPrefs(
    credential: string,
    install: string,
    bodyJson?: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = PREFS_TIMEOUT_MS
): Promise<RelayPrefsResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(RELAY_PREFS_URL, bodyJson === undefined
            ? { method: "GET", headers: relayHeaders(credential, install), signal: controller.signal }
            : { method: "POST", headers: relayHeaders(credential, install, true), body: bodyJson, signal: controller.signal });
        let body: any = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (res.ok && body && body.ok === true && body.prefs && typeof body.prefs === "object" && !Array.isArray(body.prefs)) {
            return { ok: true, prefs: cleanPrefEntries(body.prefs), ...(positive(body.now) ? { now: body.now } : {}) };
        }
        const word = body && typeof body.error === "string" ? body.error : "";
        const error = res.status === 409 && word === "not_linked" ? "not_linked"
            : res.status === 400 || res.status === 413 ? "rejected"
                : res.status === 404 ? "missing"
                    : res.status === 429 ? "rate_limited"
                        : "unavailable";
        return { ok: false, error, status: res.status };
    } catch {
        return { ok: false, error: "network" };
    } finally {
        clearTimeout(timer);
    }
}
