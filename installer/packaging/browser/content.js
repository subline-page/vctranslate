/*
 * Subline browser add-on: the content script (the add-on's isolated world).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two jobs:
 *  1. Tell Vencord where the add-on's files are (upstream Vencord's content.js,
 *     unchanged in what it sends). Vencord loads its stylesheet from there.
 *  2. Carry the plugin's calls from the page (pageBridge.js) to the add-on's
 *     background and the answers back. Only the bridge methods (router.ts BRIDGE_METHODS) pass;
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
        "relayPrefs",
        "relayEvent",
        "relaySwitch"
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

    // THE BOOT GUARD'S REPORT (installer/scripts/bootGuard.mjs). A trip the
    // page stored (report: true) is told to the relay once, as a patch health
    // report with the row "guard:bootGuard", which mails the owner. Sent from
    // here because the page holds no Subline while the guard keeps it off.
    // Kept for the next load when the add-on or the relay cannot take it now.
    // An install id of its own (never the plugin's), for the relay's count.
    const GUARD_KEY = "subline:bootGuard";
    const GUARD_REPORT_DELAY_MS = 5_000;
    let guardSending = false;
    const reportBootTrip = () => {
        if (guardSending) return;
        let ls, rec;
        try {
            ls = window.localStorage;
            rec = JSON.parse(ls.getItem(GUARD_KEY) || "null");
        } catch {
            return;
        }
        if (!rec || typeof rec !== "object" || rec.report !== true || !rec.bad || typeof rec.bad !== "object") return;
        const version = String(rec.bad.v ?? ""), id = String(rec.bad.id ?? "");
        if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{16}$/.test(id)) return;
        let install = typeof rec.install === "string" && /^free_[0-9a-f]{32}$/.test(rec.install) ? rec.install : null;
        if (install === null) {
            try {
                install = "free_" + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
                rec.install = install;
                ls.setItem(GUARD_KEY, JSON.stringify(rec));
            } catch {
                return;
            }
        }
        const host = String(window.location.hostname || "");
        const channel = host.startsWith("ptb.") ? "ptb" : host.startsWith("canary.") ? "canary" : "stable";
        const report = { v: 1, plugin: version, build: id, channel, discordBuild: 0, failed: [{ plugin: "VcTranslate", find: "guard:bootGuard", state: "threw" }] };
        let sent;
        try {
            sent = api.runtime.sendMessage({ tag: BACKGROUND_TAG, method: "relayPatchHealth", args: [install, JSON.stringify(report)] });
        } catch {
            return;
        }
        guardSending = true;
        Promise.resolve(sent).finally(() => { guardSending = false; }).catch(() => { });
        Promise.resolve(sent).then(reply => {
            // true: the relay took it. "rejected": it never will. Anything else: try on the next load.
            if (!reply || reply.ok !== true || (reply.value !== true && reply.value !== "rejected")) return;
            try {
                const now = JSON.parse(ls.getItem(GUARD_KEY) || "null");
                if (now && typeof now === "object") {
                    now.report = false;
                    ls.setItem(GUARD_KEY, JSON.stringify(now));
                }
            } catch { /* told again on the next load */ }
        }, () => { });
    };
    window.addEventListener("load", () => setTimeout(reportBootTrip, GUARD_REPORT_DELAY_MS), { once: true });
    // The guard holds Subline off only after a load without Subline drew
    // (bootGuard.mjs step 4), which can be after the report above ran: it then
    // sends this event, and the report goes out at once. Told once: report
    // turns false when the relay took it.
    window.addEventListener("subline:bootGuardHeld", () => setTimeout(reportBootTrip, 0));

    /*
     * The version switch (relay versionSwitch.ts): ask once per start whether
     * the owner turned this add-on version off, and store the answer where the
     * boot guard reads it before Vencord starts on the NEXT start
     * (installer/scripts/bootGuard.mjs, `off`). Asked while switched off too, so
     * turning the version back on reaches this computer. An unknown answer
     * (no network, relay down) keeps what is stored. Top frame only.
     */
    const SWITCH_DELAY_MS = 3_000;
    const checkSwitch = () => {
        let top = false;
        try { top = window.top === window; } catch { top = false; }
        if (!top) return;
        let ls;
        try { ls = window.localStorage; } catch { return; }
        const version = String(api.runtime.getManifest().version || "");
        if (!/^\d+\.\d+\.\d+$/.test(version)) return;
        let sent;
        try {
            sent = api.runtime.sendMessage({ tag: BACKGROUND_TAG, method: "relaySwitch", args: ["addon/" + version] });
        } catch {
            return;
        }
        Promise.resolve(sent).then(reply => {
            if (!reply || reply.ok !== true || typeof reply.value !== "boolean") return;
            try {
                const rec = JSON.parse(ls.getItem(GUARD_KEY) || "null");
                const next = rec && typeof rec === "object" ? rec : {};
                if (reply.value) next.off = { v: version, at: Date.now() };
                else if (next.off === undefined) return;
                else delete next.off;
                ls.setItem(GUARD_KEY, JSON.stringify(next));
            } catch { /* asked again on the next start */ }
        }, () => { });
    };
    window.addEventListener("load", () => setTimeout(checkSwitch, SWITCH_DELAY_MS), { once: true });
})();
