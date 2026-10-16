/**
 * BUYING WITHOUT HANDLING A KEY.
 *
 * The reader picks a plan in the Upgrade panel. The relay creates a Dodo
 * checkout session tagged with a hash of this install's free id and returns its
 * URL, which opens in the browser. While that checkout is open this module asks
 * the relay's /v1/status every 5 seconds, for up to 30 minutes, then every 5
 * minutes for up to 48 hours: a subscription can sit in Pending while the bank
 * sets up the mandate (minutes in practice; Dodo documents up to 48 hours for
 * Indian mandates), and the key must still land without a restart. Once the
 * purchase is linked to the install, status carries the license key
 * (`purchase.code`), and the caller saves it as the Subline code. Nobody types
 * or pastes anything.
 *
 * If the relay ANSWERS that it cannot sell this now (503 "checkout
 * unavailable": the product is not set up, or Dodo is down), nothing opens:
 * the reader is told buying isn't available yet. The static Dodo checkout link
 * is only for a relay that could not be reached at all, and never while the
 * product id is still the placeholder (it would open a 404). It carries the
 * same install hash as `metadata_install` and a `redirect_url` back to the
 * site, both documented for static links
 * (https://docs.dodopayments.com/developer-resources/integration-guide#static-payment-links),
 * so the webhook can still link the purchase and polling still works.
 *
 * The static link names no Discord account, only the install hash, and the
 * relay hands its purchase to whichever account that install is linked to.
 * So it opens only for an install the last status answer said is linked
 * (staticLinkAllowed). On any other (the installer's id every local account
 * shares until one links it, or a link state not known yet) a purchase would
 * reach whichever account links that id later, not the one the account
 * confirm named (0.2.8 spec, decisions 2 and 3): nothing opens, and the
 * answer is "unreachable".
 *
 * Free of Discord and settings: every side effect is a dependency, so the flow
 * is tested on its own.
 */

export type Plan = "automatic" | "monthly" | "annual";

/**
 * The Dodo product for Automatic ($4.99 once). Set it here (and only here).
 * While it is still the placeholder the static link is never opened (see
 * isConfiguredProduct), and a test refuses the placeholder in a shipped build
 * (tests/placeholder.test.ts).
 */
export const AUTOMATIC_PRODUCT_ID = "pdt_0NofMhZ4QRA71V9lJw6K7";

/** A real Dodo product id, not the placeholder a build ships with before the owner sets it. */
export function isConfiguredProduct(id: string): boolean {
    return /^pdt_[A-Za-z0-9]+$/.test(id) && !/PENDING/.test(id);
}

export const PLAN_PRODUCTS: Record<Plan, string> = {
    automatic: AUTOMATIC_PRODUCT_ID,
    monthly: "pdt_0No1xmbcAqHdYAvt1RNPR",
    annual: "pdt_0No1yAve1ozdxryVGZvf6"
};

/**
 * Relay refusals that mean "this purchase is not for you", not "the relay is
 * down": the static link must NOT open for them, or a static link would sell
 * what the relay just refused (AI without Automatic, Automatic twice, a
 * second purchase while the first payment is still being confirmed, or a
 * purchase before the Discord account is linked: 403 not_linked, API 3).
 */
export const CHECKOUT_REFUSALS = new Set(["automatic_required", "already_owned", "purchase_pending", "not_linked"]);

/**
 * Where Dodo sends the buyer after paying: the site root, marked as a checkout
 * started from Discord, so the thanks view says "go back to Discord" rather
 * than showing a code to paste.
 */
export const CHECKOUT_RETURN_URL = "https://subline.page/?from=discord";

export const POLL_EVERY_MS = 5_000;
export const POLL_FOR_MS = 30 * 60_000;
/** After the first 30 minutes, a slower check for a purchase still pending. */
export const SLOW_POLL_EVERY_MS = 5 * 60_000;
export const SLOW_POLL_FOR_MS = 48 * 60 * 60_000;
/**
 * How long "Payment being confirmed" replaces the buy links (P4) after a
 * checkout opens, or after the relay last answered purchase_pending. The
 * fast poll's 30 minutes, which is also the relay's own window for a
 * checkout it cannot ask Dodo about (relay CKO_WINDOW_MS). Not the whole 48
 * hours of slow polling: an abandoned checkout must not hide Add AI for two
 * days. After it, a buy press asks the relay, which still answers
 * purchase_pending while money is really moving (and that shows it again).
 */
export const PENDING_SHOWN_FOR_MS = POLL_FOR_MS;

/**
 * The install hash the relay files a purchase under: the first 16 hex of
 * SHA-256 of the full bearer ("free_<32hex>"). Never the raw id.
 */
export async function installHash(bearer: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bearer));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function staticCheckoutUrl(plan: Plan, hash: string | null): string {
    const params = [`quantity=1`];
    if (hash !== null) params.push(`metadata_install=${encodeURIComponent(hash)}`);
    params.push(`redirect_url=${encodeURIComponent(CHECKOUT_RETURN_URL)}`);
    return `https://checkout.dodopayments.com/buy/${PLAN_PRODUCTS[plan]}?${params.join("&")}`;
}

/**
 * Only a Dodo https URL is opened from a relay answer. openExternal hands the
 * URL to the operating system, so a relay answer must never be able to open
 * anything else (a file: URL, a custom protocol, another site).
 */
export function isDodoCheckoutUrl(url: unknown): url is string {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && (u.hostname === "dodopayments.com" || u.hostname.endsWith(".dodopayments.com"));
    } catch {
        return false;
    }
}

export interface Purchase { code: string; plan: string; }

/**
 * A browser tab opened for a checkout whose address is not known yet.
 *
 * IN A BROWSER (the add-on) a page may open a tab only within a few seconds
 * of a click (Chrome: 5 s). The checkout's address comes after the relay call
 * (up to CHECKOUT_TIMEOUT_MS, 10 s, then the static link), so opening it then
 * is dropped by the popup blocker, silently. The tab is therefore opened
 * blank at the click and sent to the address once it is known, or closed when
 * nothing opens. On the desktop openExternal hands the address to the
 * operating system, which always opens it, and no tab is reserved.
 */
export interface ReservedTab {
    go(url: string): void;
    close(): void;
}

/**
 * Open a blank tab now, with `open` (the page's window.open). Null when the
 * browser refused it (a blocked popup returns null). The new tab gets no
 * `opener`, so the checkout page cannot reach Discord's page.
 */
export function reserveTab(open: ((url: string, target: string) => any) | undefined): ReservedTab | null {
    let tab: any = null;
    try { tab = open?.("about:blank", "_blank") ?? null; } catch { tab = null; }
    if (tab === null || typeof tab !== "object") return null;
    try { tab.opener = null; } catch { /* the tab still works */ }
    return {
        go: url => { try { tab.location.href = url; } catch { /* closed by the reader */ } },
        close: () => { try { tab.close(); } catch { /* already closed */ } }
    };
}

export interface CheckoutDeps {
    /** This install's free bearer ("free_<32hex>"). */
    bearer: () => Promise<string>;
    /** POST /v1/checkout through the main process. */
    /** `status` is the relay's HTTP status when it answered; absent when it could not be reached. */
    createCheckout: (bearer: string, plan: Plan) => Promise<{ ok: true; url: string } | { ok: false; error: string; errorCode?: string; status?: number }>;
    /**
     * True only when this install is known to be linked to the signed-in
     * Discord account (the last status answer said linked). Asked when the
     * relay could not be reached, before the static link would open. A throw
     * counts as false.
     */
    staticLinkAllowed: () => boolean;
    /** GET /v1/status through the main process; `purchase` once linked. */
    status: (bearer: string) => Promise<{ ok: boolean; purchase?: Purchase }>;
    openExternal: (url: string) => void;
    /**
     * In a browser: open a blank tab NOW, inside the click (ReservedTab), or
     * null when the browser blocked it. Undefined on the desktop, where
     * openExternal always opens. Called before anything is awaited.
     */
    reserveWindow?: () => ReservedTab | null | undefined;
    /** A linked purchase arrived: save it. Returns false when it was not saved (for example a
     *  code the reader cleared, which the relay still links), and the poll then
     *  keeps going so a later, different purchase still lands. */
    onPurchase: (purchase: Purchase) => boolean;
    log?: (message: string) => void;
    now?: () => number;
    /** P4: a payment started (true) or is no longer being waited for (false). Called on changes only. */
    onPendingChange?: (pending: boolean) => void;
}

export interface CheckoutFlow {
    /**
     * Open checkout for a plan and start (or restart) polling. Resolves true
     * when a checkout page was opened, the relay's refusal word when it
     * refused the purchase (see CHECKOUT_REFUSALS), "unavailable" when buying
     * is not possible right now (nothing opened), "unreachable" when the relay
     * could not be reached and the static link may not open (an install not
     * known to be linked, see staticLinkAllowed), "blocked" when the browser
     * blocked the checkout tab (nothing asked, nothing pending), or false if
     * superseded. Call it straight from the click: a browser tab is reserved
     * before anything is awaited (ReservedTab).
     */
    start: (plan: Plan) => Promise<true | false | string>;
    /**
     * "Pay on another device" (0.2.8): the same checkout as start(), asked
     * of the relay in the same way and waited for in the same way, but its
     * address is handed back (for a link and a QR code) instead of opened
     * here. No tab is reserved. Resolves `{ url }`, or what start() would
     * answer instead of opening.
     */
    startElsewhere: (plan: Plan) => Promise<{ url: string; } | false | string>;
    stop: () => void;
    isPolling: () => boolean;
    /** P4: a payment from this install is on its way (see PENDING_SHOWN_FOR_MS). */
    isPending: () => boolean;
}

export function createCheckoutFlow(deps: CheckoutDeps): CheckoutFlow {
    const now = deps.now ?? (() => Date.now());
    const log = deps.log ?? (() => { });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadline = 0;
    let slowDeadline = 0;
    let generation = 0;
    let pending = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const setPending = (next: boolean) => {
        if (!next && pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null; }
        if (next === pending) return;
        pending = next;
        deps.onPendingChange?.(next);
    };
    /** A payment is on its way: say so for PENDING_SHOWN_FOR_MS from now. */
    const markPending = () => {
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { pendingTimer = null; setPending(false); }, PENDING_SHOWN_FOR_MS);
        setPending(true);
    };

    /** Stop polling. "Payment being confirmed" is the caller's to settle. */
    const halt = () => {
        generation++;
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const stop = () => {
        halt();
        setPending(false);
    };

    const schedule = (gen: number, bearer: string) => {
        if (gen !== generation) return;
        if (now() >= slowDeadline) {
            log("checkout: stopped waiting after 48 hours");
            timer = null;
            setPending(false);
            return;
        }
        const every = now() < deadline ? POLL_EVERY_MS : SLOW_POLL_EVERY_MS;
        timer = setTimeout(async () => {
            timer = null;
            if (gen !== generation) return;
            let res: { ok: boolean; purchase?: Purchase } | null = null;
            try {
                res = await deps.status(bearer);
            } catch (e) {
                log(`checkout: status check failed: ${String((e as any)?.message ?? e)}`);
            }
            if (gen !== generation) return;
            const p = res?.ok ? res.purchase : undefined;
            if (p && typeof p.code === "string" && p.code.trim() !== ""
                && deps.onPurchase({ code: p.code.trim(), plan: p.plan })) {
                stop();
                return;
            }
            schedule(gen, bearer);
        }, every);
    };

    const start = async (plan: Plan): Promise<true | false | string> => {
        // Before any await: still inside the click (ReservedTab).
        const tab = deps.reserveWindow?.();
        if (tab === null) {
            log("checkout: the browser blocked the checkout tab");
            return "blocked";
        }
        try {
            const chosen = await choose(plan);
            if ("answer" in chosen) {
                tab?.close();
                return chosen.answer;
            }
            if (tab) tab.go(chosen.url);
            else deps.openExternal(chosen.url);
            return true;
        } catch (e) {
            tab?.close();
            throw e;
        }
    };

    /**
     * Ask the relay for a checkout. The address to open (the poll then
     * starts), or what to answer instead when nothing opens.
     */
    const choose = async (plan: Plan): Promise<{ url: string } | { answer: false | string }> => {
        const wasPolling = timer !== null;
        halt();
        const gen = generation;
        const bearer = await deps.bearer();
        let url: string | null = null;
        try {
            const res = await deps.createCheckout(bearer, plan);
            if (!res.ok && res.errorCode !== undefined && CHECKOUT_REFUSALS.has(res.errorCode)) {
                log(`checkout: the relay refused this plan (${res.errorCode})`);
                // A payment from this install is still being confirmed: open
                // nothing, and keep (or start) waiting for it. An existing
                // poll keeps its deadlines; it is not restarted.
                if (res.errorCode === "purchase_pending" && gen === generation) {
                    if (!wasPolling) {
                        deadline = now() + POLL_FOR_MS;
                        slowDeadline = now() + SLOW_POLL_FOR_MS;
                    }
                    markPending();
                    schedule(gen, bearer);
                } else if (gen === generation) {
                    // Nothing is on its way: the poll was halted above.
                    setPending(false);
                }
                return { answer: res.errorCode };
            }
            if (res.ok && isDodoCheckoutUrl(res.url)) url = res.url;
            else if (res.ok || res.status !== undefined) {
                // The relay answered and cannot sell this now: nothing opens.
                log(`checkout: not available (${res.ok ? "not a Dodo URL" : res.error})`);
                if (gen === generation) setPending(false);
                return { answer: "unavailable" };
            } else log(`checkout: relay unreachable (${res.error}), trying the static link`);
        } catch (e) {
            log(`checkout: relay call failed (${String((e as any)?.message ?? e)}), trying the static link`);
        }
        if (url === null) {
            let allowed = false;
            try { allowed = deps.staticLinkAllowed() === true; } catch { allowed = false; }
            if (!allowed) {
                log("checkout: relay unreachable and this install is not known to be linked, not opening the static link");
                if (gen === generation) setPending(false);
                return { answer: "unreachable" };
            }
            if (!isConfiguredProduct(PLAN_PRODUCTS[plan])) {
                log("checkout: no product set up for this plan, not opening a static link");
                if (gen === generation) setPending(false);
                return { answer: "unavailable" };
            }
            let hash: string | null = null;
            try { hash = await installHash(bearer); } catch { hash = null; }
            url = staticCheckoutUrl(plan, hash);
        }
        if (gen !== generation) return { answer: false };
        deadline = now() + POLL_FOR_MS;
        slowDeadline = now() + SLOW_POLL_FOR_MS;
        markPending();
        schedule(gen, bearer);
        return { url };
    };

    const startElsewhere = async (plan: Plan): Promise<{ url: string; } | false | string> => {
        const chosen = await choose(plan);
        return "answer" in chosen ? chosen.answer : { url: chosen.url };
    };

    return { start, startElsewhere, stop, isPolling: () => timer !== null, isPending: () => pending };
}
