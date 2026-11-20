/**
 * THE BOOT GUARD (browser add-on). Owner rule: Discord never goes corrupt for
 * anyone. Owner rule too (2026-11-14): Discord without Subline is the EXTREME
 * last option, and a cause that is not Subline never switches Subline off.
 * If Discord's page stays blank with Subline in it (2026-11-07: add-on 0.2.9
 * left discord.com blank while every patch check passed), the guard gathers
 * evidence first, one stored step per reload:
 *   1. blank: reload once WITH Subline (rules out a network hiccup);
 *   2. still blank: reload once WITHOUT Subline;
 *   3. blank without Subline too: the cause is not Subline. The steps are
 *      cleared, nothing is held, Subline runs again from the next load, and a
 *      record (notSubline) is kept on the page; no report goes to the relay
 *      (its guard rows always mail the owner as a Subline failure);
 *   4. Discord renders without Subline: Subline is the cause. Subline stays off
 *      until Discord changes, the add-on changes, or a day has passed (then
 *      one more try), with the pause notice and the report, as before.
 *
 * It runs in the page, at document_start, before Vencord: the start of the
 * built bundle (dist/Vencord.js) calls sublineBootGuard and does not start
 * Vencord when it says skip. Nothing here depends on Discord's code.
 *
 *  - "Rendered" = Discord's #app-mount holds an element with a size: the login
 *    page, the loading screen, the app, or Discord's own crash screen. A blank
 *    page (the case this guards) holds nothing.
 *  - The clock starts at the window's load event (Discord's own scripts are
 *    in), and counts only while the tab is visible and the computer online: a
 *    background tab or a slow network never trips it.
 *  - Top frame only, and never a window Discord opened (a popped-out call:
 *    its opener is Discord); frames and popouts follow the stored state.
 *  - Never a loop. Each step is stored, and read back, before its reload; a
 *    step that could not be stored reloads nothing. At most two reloads per
 *    blank start (steps 1 and 2); step 3 and 4 reload nothing. A step older
 *    than STEP_TTL_MS or of another version is ignored. A "not Subline"
 *    record stops new steps on the same Discord build and version for
 *    RETRY_GAP_MS. A held trip and its one retry on a new Discord build (at
 *    most once per RETRY_GAP_MS) are as before.
 *  - No storage (blocked): never skip, never watch.
 * The stored trip carries report: true until the add-on's content script has
 * told the relay (content.js), which mails the owner (patch health, find
 * "guard:bootGuard").
 */

import { rewriteExactlyOnce } from "./vencordRewrites.mjs";

export const BOOT_GUARD_KEY = "subline:bootGuard";
/** Visible time after load before an empty page counts as blank. */
export const BOOT_WAIT_MS = 20_000;
/** A trip holds at most this long; then Subline gets one more try. */
export const BOOT_HOLD_MS = 24 * 3_600_000;
/** At most one retry on a changed Discord build in this time. */
export const BOOT_RETRY_GAP_MS = 6 * 3_600_000;
/** A stored evidence step counts for the load right after its reload; older is stale. */
export const BOOT_STEP_TTL_MS = 10 * 60_000;
/** The event the guard sends when it holds Subline off at step 4 (content.js reports then). */
export const BOOT_HELD_EVENT = "subline:bootGuardHeld";

export const BOOT_PAUSED_COPY = "Discord changed, and Subline could not start with it. Discord works as normal. Translation is paused until the fix is out.";
/** The version switch (relay versionSwitch.ts): a stored "off" for this version holds at most this long without a fresh answer. */
export const BOOT_OFF_HOLD_MS = 7 * 24 * 3_600_000;
export const BOOT_OFF_COPY = "Subline is off in this version until a fix is ready. Discord works as normal.";

/**
 * The guard itself. Written as one self-contained function: the build puts its
 * source text into the bundle (Function.prototype.toString), so it must not use
 * anything from this module. Returns { skip } at once; the watch runs later.
 */
export function sublineBootGuard(win, version, consts) {
    var KEY = consts.key, WAIT = consts.wait, HOLD = consts.hold, GAP = consts.gap, OFF_HOLD = consts.offHold, TTL = consts.stepTtl;
    // probe: this load runs without Subline only to see whether Discord renders
    // (step 2). The page then shows no pause notice until the guard knows:
    // the bundle sets out.notice, and the guard calls it at step 4.
    var out = { skip: false, off: false, probe: false, notice: null };
    var ls = null;
    try { ls = win.localStorage; } catch (e) { ls = null; }
    if (!ls) return out;
    var top = false;
    try { top = win.top === win; } catch (e) { top = false; }
    // A window Discord opened itself (a popped-out call or chat: same-origin
    // opener) draws through its opener, not into its own #app-mount: never
    // watched, so it can never store a trip. A cross-origin opener throws here
    // and counts as no popout.
    var popout = false;
    try { popout = !!win.opener && win.opener !== win && win.opener.location.host === win.location.host; } catch (e) { popout = false; }
    var watch = top && !popout;
    var read = function () {
        try {
            var v = JSON.parse(ls.getItem(KEY) || "null");
            return v && typeof v === "object" ? v : {};
        } catch (e) { return {}; }
    };
    var write = function (v) { try { ls.setItem(KEY, JSON.stringify(v)); } catch (e) { /* full or blocked */ } };
    // Stored and read back: a reload only ever follows a step that is really there.
    var stored = function (v) {
        var text = JSON.stringify(v);
        try { ls.setItem(KEY, text); return ls.getItem(KEY) === text; } catch (e) { return false; }
    };
    var say = function (m) { try { win.console.error("[Subline] " + m); } catch (e) { /* no console */ } };
    var doc = win.document;
    var buildOf = function () {
        try {
            var names = [], s = doc.getElementsByTagName("script");
            for (var i = 0; i < s.length; i++) {
                var m = /\/assets\/([\w.-]+\.js)(?:\?.*)?$/.exec(String(s[i].src || ""));
                if (m) names.push(m[1]);
            }
            if (!names.length) return null;
            names.sort();
            var t = names.join(","), h = 5381;
            for (var j = 0; j < t.length; j++) h = ((h * 33) ^ t.charCodeAt(j)) >>> 0;
            return h.toString(36);
        } catch (e) { return null; }
    };
    var onLoad = function (fn) {
        if (doc.readyState === "complete") fn();
        else win.addEventListener("load", fn, { once: true });
    };
    var now = Date.now();
    var st = read();
    // The version switch: the owner turned this version off (stored by the
    // add-on's content.js or the desktop switch check on an earlier start).
    var off = st.off;
    if (!!off && typeof off === "object" && off.v === version && typeof off.at === "number" && off.at <= now && now - off.at < OFF_HOLD) {
        out.skip = true;
        out.off = true;
        return out;
    }
    // No trip here (the desktop app, guardDesktopBoot): the version switch above
    // still holds, but the guard never skips Subline, never watches, never
    // reloads, and a trip stored before is ignored.
    if (consts.trip === false) return out;
    var bad = st.bad;
    var held = !!bad && typeof bad === "object" && bad.v === version && typeof bad.at === "number" && bad.at <= now && now - bad.at < HOLD;
    if (held) {
        out.skip = true;
        if (watch) onLoad(function () {
            var b = buildOf();
            var lastRetry = typeof st.retryAt === "number" ? st.retryAt : 0;
            // Discord changed since the trip: one more try on the new build.
            if (b && bad.build && b !== bad.build && Date.now() - lastRetry >= GAP) {
                var next = read();
                next.retryAt = Date.now();
                delete next.bad;
                write(next);
                try { win.location.reload(); } catch (e) { /* stays plain */ }
            }
        });
        return out;
    }
    if (!watch) return out;
    // The evidence step this load is (see the header): 0 none, 1 reloaded with
    // Subline, 2 reloaded without it.
    var step = st.step;
    var n = !!step && typeof step === "object" && step.v === version && typeof step.at === "number" && step.at <= now && now - step.at < TTL && (step.n === 1 || step.n === 2) ? step.n : 0;
    if (n === 2) {
        out.skip = true;
        out.probe = true;
    }
    onLoad(function () {
        var seen = 0, last = Date.now();
        var rendered = function () {
            try {
                var m = doc.getElementById("app-mount");
                if (!m) return false;
                var all = m.getElementsByTagName("*");
                for (var i = 0; i < all.length && i < 400; i++) {
                    var r = all[i].getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return true;
                }
                return false;
            } catch (e) { return true; }
        };
        var reload = function () { try { win.location.reload(); } catch (e) { /* stays as it is */ } };
        var tick = function () {
            var next;
            if (rendered()) {
                if (n === 0) return;
                next = read();
                delete next.step;
                if (n === 1) {
                    // Step 1 drew: it was a hiccup. Subline stays on.
                    write(next);
                    return;
                }
                // Step 4: Discord renders without Subline, so Subline is the cause.
                next.bad = { v: version, id: consts.id, at: Date.now(), build: buildOf() };
                next.trips = (typeof next.trips === "number" ? next.trips : 0) + 1;
                next.report = true;
                write(next);
                say("Discord starts without Subline but not with it. Subline stays off for now.");
                try { if (typeof out.notice === "function") out.notice(); } catch (e) { /* no notice, Discord works */ }
                try { win.dispatchEvent(new win.Event(consts.heldEvent)); } catch (e) { /* reported on the next load */ }
                return;
            }
            var t = Date.now();
            var visible = doc.visibilityState === undefined || doc.visibilityState === "visible";
            var online = !win.navigator || win.navigator.onLine !== false;
            if (visible && online) seen += t - last;
            last = t;
            if (seen < WAIT) { win.setTimeout(tick, 500); return; }
            next = read();
            var build = buildOf();
            if (n === 2) {
                // Step 3: blank without Subline too. Not Subline: clear, hold nothing.
                delete next.step;
                var was = next.notSubline;
                next.notSubline = { v: version, id: consts.id, at: Date.now(), build: build, count: (!!was && typeof was === "object" && typeof was.count === "number" ? was.count : 0) + 1 };
                write(next);
                say("Discord stays blank without Subline too: the cause is not Subline. Subline runs again from the next load.");
                return;
            }
            if (n === 0) {
                var ns = next.notSubline;
                if (!!ns && typeof ns === "object" && ns.v === version && ns.build === build && typeof ns.at === "number" && ns.at <= t && t - ns.at < GAP) {
                    say("Discord is blank again on the Discord build that was blank without Subline too. Subline stays on; no reload.");
                    return;
                }
            }
            // Step 1 (reload with Subline) or step 2 (reload without it), stored first.
            next.step = { v: version, n: n + 1, at: Date.now(), build: build };
            if (!stored(next)) {
                say("Discord did not start, and the guard could not store its step. No reload.");
                return;
            }
            say(n === 0 ? "Discord did not start. Reloading once with Subline." : "Discord did not start again. Reloading once without Subline.");
            reload();
        };
        tick();
    });
    return out;
}

/**
 * The guard's call, as the bundle runs it: `var sublineBoot = (...)(window, "0.2.12", {...});`.
 * trip: false keeps only the version switch (the desktop app, see guardDesktopBoot).
 */
export function bootGuardCall(version, buildId, { trip = true } = {}) {
    if (!/^[0-9a-f]{16}$/.test(String(buildId))) throw new Error(`bootGuardCall: "${buildId}" is not a Subline build id`);
    const consts = { key: BOOT_GUARD_KEY, wait: BOOT_WAIT_MS, hold: BOOT_HOLD_MS, gap: BOOT_RETRY_GAP_MS, offHold: BOOT_OFF_HOLD_MS, stepTtl: BOOT_STEP_TTL_MS, heldEvent: BOOT_HELD_EVENT, id: buildId, ...(trip ? {} : { trip: false }) };
    return `var sublineBoot=(${sublineBootGuard.toString()})(window,${JSON.stringify(version)},${JSON.stringify(consts)});`;
}

/**
 * Put the guard at the start of the built bundle, after guardSecondVencord
 * (vencordRewrites.mjs): the guard runs first, and a skip starts no Vencord and
 * says so on the page (the same notice as the second-Vencord case).
 */
export function guardBoot(bundle, version, buildId) {
    let out = rewriteExactlyOnce(bundle, BUNDLE_NOTICE_ANCHOR, `"use strict";${bootGuardCall(version, buildId)}function sublineSecondVencord(m){`, {
        file: "dist/Vencord.js",
        what: "boot guard (start)"
    });
    out = rewriteExactlyOnce(out, BUNDLE_START_ANCHOR, `if(sublineBoot.skip){if(sublineBoot.probe)sublineBoot.notice=function(){sublineSecondVencord(${JSON.stringify(BOOT_PAUSED_COPY)})};else sublineSecondVencord(sublineBoot.off?${JSON.stringify(BOOT_OFF_COPY)}:${JSON.stringify(BOOT_PAUSED_COPY)})}else if(window.Vencord!==void 0)sublineSecondVencord(`, {
        file: "dist/Vencord.js",
        what: "boot guard (skip)"
    });
    return out;
}
/**
 * THE DESKTOP APP. Vencord's preload runs renderer.js in Discord's page before
 * Discord's own scripts (webFrame.executeJavaScript), and reads it from disk
 * again on every reload: the same place the add-on's bundle runs. So the
 * desktop guard is the same guard at the start of renderer.js. A skip starts
 * no Vencord, shows the pause notice, and tells the relay through the plugin's
 * own main-process helper (VencordNative.pluginHelpers.VcTranslate, which the
 * preload sets up without the renderer), as content.js does in the add-on.
 *
 * THE DESKTOP TRIP IS OFF (2026-11-14): its real-Discord check (runs
 * 43202793800, 43202797899) failed, so it is unproven. renderer.js keeps the
 * version switch only (trip: false): a stored off for this version still
 * starts no Vencord, with its notice; a blank window is never watched,
 * reloaded or skipped by the guard.
 */
export function sublineBootSkipped(win, copy, key) {
    var doc = win.document;
    var ls = null;
    try { ls = win.localStorage; } catch (e) { ls = null; }
    try { win.console.error("[Subline] " + copy); } catch (e) { /* no console */ }
    var show = function () {
        try {
            var d = doc.createElement("div");
            d.setAttribute("role", "alert");
            d.textContent = copy;
            d.style.cssText = "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:12px 16px;border-radius:8px;background:#1e1f22;color:#f2f3f5;font:14px/1.4 sans-serif;cursor:pointer";
            d.addEventListener("click", function () { d.remove(); });
            doc.body.appendChild(d);
        } catch (e) { /* no notice, Discord still works */ }
    };
    if (doc.body) show(); else doc.addEventListener("DOMContentLoaded", show, { once: true });
    var report = function () {
        if (!ls) return;
        var rec;
        try { rec = JSON.parse(ls.getItem(key) || "null"); } catch (e) { return; }
        if (!rec || typeof rec !== "object" || rec.report !== true || !rec.bad || typeof rec.bad !== "object") return;
        var version = String(rec.bad.v || ""), id = String(rec.bad.id || "");
        if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{16}$/.test(id)) return;
        var helpers = null;
        try { helpers = win.VencordNative.pluginHelpers.VcTranslate; } catch (e) { helpers = null; }
        if (!helpers || typeof helpers.relayPatchHealth !== "function") return;
        var install = typeof rec.install === "string" && /^free_[0-9a-f]{32}$/.test(rec.install) ? rec.install : null;
        if (install === null) {
            try {
                var b = win.crypto.getRandomValues(new Uint8Array(16)), h = "";
                for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
                install = "free_" + h;
                rec.install = install;
                ls.setItem(key, JSON.stringify(rec));
            } catch (e) { return; }
        }
        var host = String((win.location && win.location.hostname) || "");
        var channel = host.indexOf("ptb.") === 0 ? "ptb" : host.indexOf("canary.") === 0 ? "canary" : "stable";
        var body = { v: 1, plugin: version, build: id, channel: channel, discordBuild: 0, failed: [{ plugin: "VcTranslate", find: "guard:bootGuard", state: "threw" }] };
        var sent;
        try { sent = helpers.relayPatchHealth(install, JSON.stringify(body)); } catch (e) { return; }
        Promise.resolve(sent).then(function (value) {
            // true: the relay took it. "rejected": it never will. Anything else: try on the next load.
            if (value !== true && value !== "rejected") return;
            try {
                var now = JSON.parse(ls.getItem(key) || "null");
                if (now && typeof now === "object") { now.report = false; ls.setItem(key, JSON.stringify(now)); }
            } catch (e) { /* told again on the next load */ }
        }, function () { /* told again on the next load */ });
    };
    var later = function () { win.setTimeout(report, 5000); };
    if (doc.readyState === "complete") later(); else win.addEventListener("load", later, { once: true });
}

/**
 * The desktop version switch check (the add-on's is in content.js): once per
 * start, 3 s after load, ask the relay through the plugin's main-process
 * helper whether this version is switched off, and store the answer for the
 * guard's NEXT start. Runs whether Subline started or not. Top window only.
 * localStorage is taken at once: Discord removes it from the page later.
 */
export function sublineSwitchCheck(win, version, key) {
    var ls = null;
    try { ls = win.localStorage; } catch (e) { ls = null; }
    if (!ls) return;
    var top = false;
    try { top = win.top === win; } catch (e) { top = false; }
    if (!top) return;
    var ask = function () {
        var helpers = null;
        try { helpers = win.VencordNative.pluginHelpers.VcTranslate; } catch (e) { helpers = null; }
        if (!helpers || typeof helpers.relaySwitch !== "function") return;
        var sent;
        try { sent = helpers.relaySwitch(version); } catch (e) { return; }
        Promise.resolve(sent).then(function (value) {
            if (typeof value !== "boolean") return;
            try {
                var rec = JSON.parse(ls.getItem(key) || "null");
                var next = rec && typeof rec === "object" ? rec : {};
                if (value) next.off = { v: version, at: Date.now() };
                else if (next.off === undefined) return;
                else delete next.off;
                ls.setItem(key, JSON.stringify(next));
            } catch (e) { /* asked again on the next start */ }
        }, function () { /* asked again on the next start */ });
    };
    var later = function () { win.setTimeout(ask, 3000); };
    if (win.document.readyState === "complete") later(); else win.addEventListener("load", later, { once: true });
}

/** Vencord's desktop renderer.js, start and end (the build fails if either moved). */
export const DESKTOP_HEAD_ANCHOR = "\"use strict\";var Vencord=";
export const DESKTOP_TAIL_ANCHOR = "})();\n//# sourceURL=file:///VencordRenderer";

/** renderer.js with the guard in front: a skip starts no Vencord (see sublineBootSkipped). */
export function guardDesktopBoot(renderer, version, buildId) {
    let out = rewriteExactlyOnce(renderer, DESKTOP_HEAD_ANCHOR,
        `"use strict";${bootGuardCall(version, buildId, { trip: false })}(${sublineSwitchCheck.toString()})(window,${JSON.stringify(version)},${JSON.stringify(BOOT_GUARD_KEY)});`
        + `if(sublineBoot.skip){var sublineSkipped=function(){(${sublineBootSkipped.toString()})(window,sublineBoot.off?${JSON.stringify(BOOT_OFF_COPY)}:${JSON.stringify(BOOT_PAUSED_COPY)},${JSON.stringify(BOOT_GUARD_KEY)})};if(sublineBoot.probe)sublineBoot.notice=sublineSkipped;else sublineSkipped()}else{var Vencord=`, {
            file: "renderer.js",
            what: "boot guard (start)"
        });
    out = rewriteExactlyOnce(out, DESKTOP_TAIL_ANCHOR, "})();}\n//# sourceURL=file:///VencordRenderer", {
        file: "renderer.js",
        what: "boot guard (end)"
    });
    return out;
}

export const BUNDLE_NOTICE_ANCHOR = "\"use strict\";function sublineSecondVencord(m){";
export const BUNDLE_START_ANCHOR = "if(window.Vencord!==void 0)sublineSecondVencord(";
