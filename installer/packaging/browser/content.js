/*
 * Subline browser add-on: the content script (the add-on's isolated world).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two jobs:
 *  1. Tell Vencord where the add-on's files are (upstream Vencord's content.js,
 *     unchanged in what it sends). Vencord loads its stylesheet from there.
 *  2. Carry the plugin's calls from the page (pageBridge.js) to the add-on's
 *     background and the answers back. Only the ten bridge methods pass;
 *     anything else is refused here, and again in the background.
 */
(() => {
    const api = typeof browser !== "undefined" ? browser : chrome;
    const CALL = "subline:page-call";
    const REPLY = "subline:page-reply";
    const BUSY = "subline:page-busy";
    const BACKGROUND_TAG = "subline:call";
    // While a call is with the background, the page hears this often that it
    // is still being worked on (pageBridge.js gives up only on silence).
    const BUSY_EVERY_MS = 15_000;

    const METHODS = [
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
    ];

    document.addEventListener(
        "DOMContentLoaded",
        () => {
            window.postMessage({
                type: "vencord:meta",
                meta: {
                    EXTENSION_VERSION: api.runtime.getManifest().version,
                    EXTENSION_BASE_URL: api.runtime.getURL(""),
                    RENDERER_CSS_URL: api.runtime.getURL("dist/Vencord.css")
                }
            });
        },
        { once: true }
    );

    window.addEventListener("message", event => {
        if (event.source !== window) return;
        let id, method, args;
        try {
            const data = event.data;
            if (data === null || typeof data !== "object" || data.type !== CALL || typeof data.id !== "string") return;
            ({ id, method } = data);
            // A plain copy made here, in this world: what the browser sends on
            // to the background is then data this script owns (Firefox hands a
            // content script the page's objects through a wrapper). JSON, as
            // Chromium's messaging is anyway; the background reads a null
            // optional argument as left out.
            args = data.args === undefined ? [] : JSON.parse(JSON.stringify(data.args));
        } catch {
            if (typeof id === "string") window.postMessage({ type: REPLY, id, reply: { ok: false, refused: "arguments" } }, window.location.origin);
            return;
        }
        const answer = reply => window.postMessage({ type: REPLY, id, reply }, window.location.origin);

        if (!METHODS.includes(method)) {
            answer({ ok: false, refused: "unknown method" });
            return;
        }
        // The add-on was updated or removed under this page: this script is
        // cut off from it for good (Chromium: "Extension context
        // invalidated", and no runtime id). Only a reload brings it back.
        const lost = err => {
            let orphaned = /context invalidated/i.test(String(err?.message ?? err));
            try { orphaned ||= !api.runtime?.id; } catch { orphaned = true; }
            answer({ ok: false, refused: orphaned ? "add-on reloaded" : "add-on unavailable" });
        };
        let sent;
        try {
            sent = api.runtime.sendMessage({ tag: BACKGROUND_TAG, method, args });
        } catch (err) {
            lost(err);
            return;
        }
        const busy = setInterval(() => window.postMessage({ type: BUSY, id }, window.location.origin), BUSY_EVERY_MS);
        Promise.resolve(sent).then(
            reply => { clearInterval(busy); answer(reply !== null && typeof reply === "object" ? reply : { ok: false, refused: "no answer" }); },
            err => { clearInterval(busy); lost(err); }
        );
    });
})();
