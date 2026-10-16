/*
 * Subline browser add-on: the web transport, in Discord's page.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs in the page's own world, before Vencord. It puts the object the plugin's
 * transport.ts looks for on `globalThis.__sublineWebTransport`. Each function
 * takes the arguments of the native.ts function of the same name and resolves
 * the same shape. A call travels:
 *
 *   here → window message → content.js → the add-on background (router.ts)
 *
 * NEVER REJECTS. A call the add-on could not answer (the add-on was updated
 * under the page, the background refused it, nobody working on it) resolves
 * the method's ordinary failure: `{ ok: false, error: "unavailable" }`, or
 * `false` for the health report. No `status` in it, so the plugin reads it as
 * "no answer", the offline case: a stored plan stays as it is.
 *
 * NO FIXED TIME LIMIT. While the background works on a call, the content
 * script says so every 15 s ("subline:page-busy"). A call gives up only after
 * IDLE_MS with no word at all (the content script is gone). The desktop has no
 * limit either: a long catch-up queued behind Google's shared gate is
 * delivered, not dropped while its work runs on.
 *
 * UPDATED UNDER THE PAGE. When the content script reports that it lost the
 * add-on for good ("add-on reloaded": the store updated the add-on while this
 * tab stayed open), nothing will work again until the tab reloads. The
 * transport's `onAddonGone(fn)` (not a bridge method: never sent anywhere)
 * calls `fn` once when that happens, so the plugin can ask for a reload.
 */
(() => {
    const GLOBAL = "__sublineWebTransport";
    const CALL = "subline:page-call";
    const REPLY = "subline:page-reply";
    const BUSY = "subline:page-busy";
    // Four of the content script's 15 s "still working" messages missed: it
    // is gone, and nobody will ever answer this call.
    const IDLE_MS = 60_000;

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

    const failureFor = method => method === "relayPatchHealth" ? false : { ok: false, error: "unavailable" };

    try {
        if (window[GLOBAL] !== undefined) return;

        const pending = new Map();
        const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join("");
        let next = 0;

        let gone = false;
        const goneListeners = [];
        const markGone = () => {
            if (gone) return;
            gone = true;
            console.warn("[Subline] The add-on was updated under this page. Reload the tab to use it again.");
            for (const fn of goneListeners.splice(0)) {
                try { fn(); } catch { /* a listener's failure is its own */ }
            }
        };

        /** (Re)start the call's silence timer: it gives up after IDLE_MS with no word. */
        const arm = (id, entry) => {
            clearTimeout(entry.timer);
            const timer = setTimeout(() => {
                if (pending.get(id)?.timer !== timer) return;
                pending.delete(id);
                console.warn(`[Subline] The add-on stopped answering ${entry.method}`);
                entry.resolve(failureFor(entry.method));
            }, IDLE_MS);
            entry.timer = timer;
        };

        window.addEventListener("message", event => {
            if (event.source !== window) return;
            const data = event.data;
            if (data === null || typeof data !== "object" || (data.type !== REPLY && data.type !== BUSY)) return;
            const entry = pending.get(data.id);
            if (entry === undefined) return;
            if (data.type === BUSY) {
                arm(data.id, entry);
                return;
            }
            pending.delete(data.id);
            clearTimeout(entry.timer);
            const reply = data.reply;
            if (reply !== null && typeof reply === "object" && reply.ok === true) {
                entry.resolve(reply.value);
            } else {
                console.warn(`[Subline] The add-on could not run ${entry.method}: ${reply?.refused ?? "no answer"}`);
                if (reply?.refused === "add-on reloaded") markGone();
                entry.resolve(failureFor(entry.method));
            }
        });

        const call = (method, args) => new Promise(resolve => {
            const id = `${nonce}-${next++}`;
            const entry = { method, resolve, timer: undefined };
            pending.set(id, entry);
            arm(id, entry);
            try {
                window.postMessage({ type: CALL, id, method, args }, window.location.origin);
            } catch (err) {
                pending.delete(id);
                clearTimeout(entry.timer);
                console.warn(`[Subline] Could not send ${method} to the add-on`, err);
                resolve(failureFor(method));
            }
        });

        const transport = {};
        for (const method of METHODS) transport[method] = (...args) => call(method, args);
        // Not enumerable: the bridge methods stay exactly the ten above.
        Object.defineProperty(transport, "onAddonGone", {
            enumerable: false,
            value: fn => {
                if (typeof fn !== "function") return () => { };
                if (gone) {
                    try { fn(); } catch { /* a listener's failure is its own */ }
                    return () => { };
                }
                goneListeners.push(fn);
                return () => {
                    const i = goneListeners.indexOf(fn);
                    if (i >= 0) goneListeners.splice(i, 1);
                };
            }
        });

        Object.defineProperty(window, GLOBAL, { value: Object.freeze(transport), writable: false, configurable: false, enumerable: false });
    } catch (err) {
        // Without the transport the plugin reads every call as "no answer".
        // Discord itself loads all the same.
        console.error("[Subline] Could not set up the add-on transport", err);
    }
})();
