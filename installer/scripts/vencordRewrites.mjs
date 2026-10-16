/**
 * Source rewrites applied to the pinned Vencord checkout before it is built.
 *
 * Each rewrite is ANCHORED: the text it replaces must appear exactly once, or
 * the build fails. A pin bump that moves the code then stops the build instead
 * of silently shipping without the change.
 *
 * Pure functions over source text, so a test can run them on the pinned file
 * without a checkout or a network.
 */

/** Replace `from` with `to`, requiring exactly one occurrence of `from`. */
export function rewriteExactlyOnce(source, from, to, { file, what }) {
    const seen = source.split(from).length - 1;
    if (seen !== 1) {
        throw new Error(
            `Cannot rewrite ${file}: expected exactly one ${what}, found ${seen}. `
            + "The pinned Vencord commit has changed this code; re-derive the anchor against the new source and rebuild."
        );
    }
    return source.replace(from, () => to);
}

export const PERSIST_FILE = "src/main/persistAfterDiscordUpdates.ts";

const PERSIST_IMPORT = `import { copyFileSync, existsSync, readdirSync, renameSync } from "original-fs";`;
const PERSIST_IMPORT_WITH_RW = `import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "original-fs";`;

/** The two lines upstream runs on a Windows host update. The marker block goes right after them. */
export const PERSIST_ANCHOR = "        renameSync(newAppAsar, newAppAsarBackup);\n        copyFileSync(oldVencordAsar, newAppAsar);\n";

/**
 * Plain JavaScript (no type syntax), so a test can execute it as is. Free
 * names: existsSync, readFileSync, writeFileSync, join, oldResources,
 * resources, newAppAsarBackup, console.
 *
 * WHY: upstream copies the OLD folder's app.asar (Subline's stub) into the NEW
 * app-x.y.z folder and nothing else, so the new folder had no
 * subline-patch.json and Subline's helper and uninstall did not know it as
 * Subline's (field logs 2026-09 and 2026-10). The marker is not copied
 * verbatim: discordVersion, backupPath and patchedAt describe the folder it
 * sits in, so they are rewritten for the new one. Its own try, so a marker
 * failure never undoes or blocks the stub copy that keeps Discord translating.
 */
export const MARKER_CARRY_BLOCK = [
    "        // Subline: carry the ownership marker into the new app folder.",
    "        try {",
    "            const sublineOldMarker = join(oldResources, \"subline-patch.json\");",
    "            if (existsSync(sublineOldMarker)) {",
    "                const sublineMarker = JSON.parse(readFileSync(sublineOldMarker, \"utf8\"));",
    "                if (sublineMarker !== null && typeof sublineMarker === \"object\" && sublineMarker.product === \"subline\") {",
    "                    try {",
    "                        const sublineVersion = JSON.parse(readFileSync(join(resources, \"build_info.json\"), \"utf8\")).version;",
    "                        if (typeof sublineVersion === \"string\") sublineMarker.discordVersion = sublineVersion;",
    "                    } catch { }",
    "                    sublineMarker.backupPath = newAppAsarBackup;",
    "                    sublineMarker.patchedAt = new Date().toISOString();",
    "                    writeFileSync(join(resources, \"subline-patch.json\"), JSON.stringify(sublineMarker, null, 4) + \"\\n\", \"utf8\");",
    "                }",
    "            }",
    "        } catch (sublineErr) {",
    "            console.error(\"[Subline] Could not carry the patch marker to the new Discord folder\", sublineErr);",
    "        }",
    ""
].join("\n");

/** The import the quit hook needs, added after upstream's events import. */
export const EVENTS_IMPORT = `import EventEmitter from "events";\n`;
export const SPAWN_IMPORT = `import { spawn as sublineSpawn } from "child_process";\n`;

/** Upstream's before-quit line. The quit hook goes right after it, inside the same platform block. */
export const BEFORE_QUIT_ANCHOR = "    app.on(\"before-quit\", patchLatest);\n";

/**
 * Start Subline's background helper as Discord REALLY quits, on Windows
 * (audit 2026-10-06 #28). A repair that needs app.asar written waits for
 * Discord to be closed; the helper only looked every 5 minutes, so a quit
 * and reopen inside that gap was never caught and the same "quit Discord"
 * notice came back day after day.
 *
 * will-quit fires on a real quit only (closing the window to the tray is
 * not one). It writes discord-quit.json in Subline's folder (only when that
 * folder exists: Subline is installed for this account), so the helper knows
 * Discord is on its way out and waits up to 30 s for it to finish exiting,
 * then runs `schtasks /Run` on the helper task: a fixed command, detached and
 * hidden, so Discord's quit is never held up. A task that is not there, or
 * a run already going (IgnoreNew), is a no-op. Its own try: it can never
 * stop Discord quitting.
 *
 * Plain JavaScript (no type syntax). Free names: app, existsSync,
 * writeFileSync, join, sublineSpawn, process, console.
 */
export const QUIT_HOOK_BLOCK = [
    "",
    "    // Subline: start the background helper as Discord really quits (Windows).",
    "    if (process.platform === \"win32\") app.on(\"will-quit\", () => {",
    "        try {",
    "            const sublineLocal = process.env.LOCALAPPDATA;",
    "            if (!sublineLocal) return;",
    "            const sublineDir = join(sublineLocal, \"Subline\");",
    "            if (!existsSync(sublineDir)) return;",
    "            writeFileSync(join(sublineDir, \"discord-quit.json\"), JSON.stringify({ at: Date.now(), pid: process.pid }) + \"\\n\", \"utf8\");",
    "            sublineSpawn(\"schtasks.exe\", [\"/Run\", \"/TN\", \"\\\\Subline\\\\Helper\"], { detached: true, stdio: \"ignore\", windowsHide: true }).unref();",
    "        } catch (sublineErr) {",
    "            console.error(\"[Subline] Could not start the background helper on quit\", sublineErr);",
    "        }",
    "    });",
    ""
].join("\n");

/** persistAfterDiscordUpdates.ts with the marker carried across a host update, and the quit hook. */
export function carryMarkerOnHostUpdate(source) {
    let out = rewriteExactlyOnce(source, PERSIST_IMPORT, PERSIST_IMPORT_WITH_RW, {
        file: PERSIST_FILE,
        what: "original-fs import line"
    });
    out = rewriteExactlyOnce(out, PERSIST_ANCHOR, PERSIST_ANCHOR + MARKER_CARRY_BLOCK, {
        file: PERSIST_FILE,
        what: "host-update rename and copy block"
    });
    out = rewriteExactlyOnce(out, EVENTS_IMPORT, EVENTS_IMPORT + SPAWN_IMPORT, {
        file: PERSIST_FILE,
        what: "events import line"
    });
    out = rewriteExactlyOnce(out, BEFORE_QUIT_ANCHOR, BEFORE_QUIT_ANCHOR + QUIT_HOOK_BLOCK, {
        file: PERSIST_FILE,
        what: "before-quit line"
    });
    return out;
}

export const WEB_STUB_FILE = "browser/VencordNativeStub.ts";

/** Upstream's web settings read: the browser add-on's settings.json. */
export const WEB_SETTINGS_GET_ANCHOR = [
    "        get: () => {",
    "            try {",
    "                return JSON.parse(localStorage.getItem(\"VencordSettings\") || \"{}\");",
    "            } catch (e) {",
    "                console.error(\"Failed to parse settings from localStorage: \", e);",
    "                return {};",
    "            }",
    "        },",
    ""
].join("\n");

const WEB_SETTINGS_GET_SEEDED = [
    "        get: () => {",
    "            let sublineStored = {};",
    "            try {",
    "                sublineStored = JSON.parse(localStorage.getItem(\"VencordSettings\") || \"{}\");",
    "            } catch (e) {",
    "                console.error(\"Failed to parse settings from localStorage: \", e);",
    "            }",
    "            sublineSettingsBase = JSON.parse(JSON.stringify(sublineStored));",
    "            return sublineSeedSettings(sublineStored);",
    "        },",
    ""
].join("\n");

/** Upstream's web settings write: the whole object this tab holds, over whatever is stored. */
export const WEB_SETTINGS_SET_ANCHOR = "        set: async (s: Settings) => localStorage.setItem(\"VencordSettings\", JSON.stringify(s)),\n";

const WEB_SETTINGS_SET_MERGED = "        set: async (s: Settings) => sublineWriteSettings(s),\n";

/**
 * The browser add-on's version of what the installer writes into Vencord's
 * settings.json on the desktop: `plugins.VcTranslate.enabled = true`, merged,
 * nothing else touched (language.ts setTargetLanguage). The add-on has no
 * installer, so the web settings store seeds it on every read instead. The
 * reading language and the install id need no seed: the plugin defaults the
 * first from Discord's locale and makes the second itself (taste.ts).
 *
 * Plain JavaScript (no type syntax), so a test can execute it as is. Never
 * throws: a stored value that is not an object becomes a fresh one, which is
 * what upstream does with settings it cannot parse.
 */
export const WEB_SEED_BLOCK = [
    "",
    "// Subline: the plugin is on by default, as the desktop installer seeds it.",
    "function sublineSeedSettings(stored) {",
    "    const isObject = v => v !== null && typeof v === \"object\" && !Array.isArray(v);",
    "    const root = isObject(stored) ? stored : {};",
    "    if (!isObject(root.plugins)) root.plugins = {};",
    "    if (!isObject(root.plugins.VcTranslate)) root.plugins.VcTranslate = {};",
    "    root.plugins.VcTranslate.enabled = true;",
    "    return root;",
    "}",
    "",
    "// Subline: two Discord tabs share one stored settings object, and each",
    "// writes the WHOLE object it holds on every change. A code saved in one tab",
    "// was lost when the other wrote. Each write is merged instead: what this tab",
    "// changed since it last read or wrote wins, and every other value stays as",
    "// stored (another tab may have changed it). The base is what this tab's own",
    "// copy held at its last read or write, so a value it never saw stays stale",
    "// in its copy and is never written back.",
    "var sublineSettingsBase = null;",
    "function sublineMergeSettings(base, mine, theirs) {",
    "    const isObject = v => v !== null && typeof v === \"object\" && !Array.isArray(v);",
    "    if (!isObject(base) || !isObject(mine) || !isObject(theirs)) return mine;",
    "    const out = {};",
    "    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])) {",
    "        const b = base[k], m = mine[k], t = theirs[k];",
    "        let v;",
    "        if (isObject(m) && isObject(t)) v = sublineMergeSettings(isObject(b) ? b : {}, m, t);",
    "        // New here and already stored by another tab: a default this tab filled in, not a choice.",
    "        else if (b === undefined && t !== undefined) v = t;",
    "        else if (JSON.stringify(m) !== JSON.stringify(b)) v = m;",
    "        else v = t;",
    "        if (v !== undefined) out[k] = v;",
    "    }",
    "    return out;",
    "}",
    "function sublineWriteSettings(mine) {",
    "    let merged = mine;",
    "    try {",
    "        const theirs = JSON.parse(localStorage.getItem(\"VencordSettings\") || \"{}\");",
    "        if (sublineSettingsBase !== null) merged = sublineMergeSettings(sublineSettingsBase, JSON.parse(JSON.stringify(mine)), theirs);",
    "    } catch (e) {",
    "        console.error(\"[Subline] Could not merge settings with another tab's, writing this tab's: \", e);",
    "    }",
    "    localStorage.setItem(\"VencordSettings\", JSON.stringify(merged));",
    "    sublineSettingsBase = JSON.parse(JSON.stringify(mine));",
    "}",
    ""
].join("\n");

/**
 * VencordNativeStub.ts with the plugin enabled by default, and settings
 * writes merged with other tabs' (browser add-on only).
 */
export function seedWebSettings(source) {
    let out = rewriteExactlyOnce(source, WEB_SETTINGS_GET_ANCHOR, WEB_SETTINGS_GET_SEEDED, {
        file: WEB_STUB_FILE,
        what: "settings.get block"
    });
    out = rewriteExactlyOnce(out, WEB_SETTINGS_SET_ANCHOR, WEB_SETTINGS_SET_MERGED, {
        file: WEB_STUB_FILE,
        what: "settings.set line"
    });
    return out + WEB_SEED_BLOCK;
}

/*
 * TWO VENCORDS IN ONE TAB. The add-on runs a whole Vencord in every Discord
 * frame, at document_start, in the page's world, exactly as Vencord's own
 * browser add-on (Vencord Web) and its userscript do. Each Vencord hooks
 * Discord's webpack by replacing one setter, so with two only the LAST one to
 * load works; the other silently does nothing, and the two overwrite each
 * other's stored settings. Load order between add-ons is not fixed.
 *
 * So the built bundle (dist/Vencord.js) checks first: another Vencord already
 * here, and Subline's does not start at all (Discord and the other Vencord
 * run as they would alone). Another one that starts after Subline's is seen
 * once the page has loaded. Either way the reader is told, on the page and
 * in the console, which is what was missing: nothing said why Subline did
 * nothing.
 *
 * SUBLINE'S OWN EARLIER COPY. Firefox runs an enabled or updated add-on's
 * content scripts again in tabs that are already open (Chromium does not), and
 * page-world JavaScript cannot be unloaded, so the new bundle finds the old
 * Subline's Vencord in the page. Each Subline bundle marks its own Vencord
 * (`window.__sublineVencord`), so that case says "updated, reload" instead of
 * blaming a Vencord the reader does not have.
 */

/** The start of Vencord's web bundle (esbuild, IIFE, globalName Vencord). */
export const WEB_BUNDLE_HEAD = "\"use strict\";var Vencord=";
/** The end of its one statement, before the source URL comment. */
export const WEB_BUNDLE_TAIL = "})();\n//# sourceURL=file:///VencordWeb";

export const SECOND_VENCORD_COPY = "Subline is off in this tab because another Vencord is running here (Vencord Web or its userscript). Turn one of them off, then reload Discord.";

/** The add-on was updated under an open tab: the app's own ADDON_RELOAD_COPY.notice (upgradeCopy.ts). */
export const SUBLINE_UPDATED_COPY = "Subline was updated. Reload this tab to keep translating.";

const SECOND_VENCORD_NOTICE = [
    "function sublineSecondVencord(m){",
    `m=m||${JSON.stringify(SECOND_VENCORD_COPY)};`,
    "console.error(\"[Subline] \"+m);",
    "var show=function(){try{",
    "var d=document.createElement(\"div\");d.setAttribute(\"role\",\"alert\");d.textContent=m;",
    "d.style.cssText=\"position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:12px 16px;border-radius:8px;background:#1e1f22;color:#f2f3f5;font:14px/1.4 sans-serif;cursor:pointer\";",
    "d.addEventListener(\"click\",function(){d.remove()});document.body.appendChild(d)",
    "}catch(e){console.error(\"[Subline] Could not show the notice\",e)}};",
    "if(document.body)show();else document.addEventListener(\"DOMContentLoaded\",show,{once:!0})}"
].join("");

/** Vencord's built web bundle, with the second-Vencord check around it (see above). */
export function guardSecondVencord(bundle) {
    let out = rewriteExactlyOnce(bundle, WEB_BUNDLE_HEAD,
        `"use strict";${SECOND_VENCORD_NOTICE}if(window.Vencord!==void 0)sublineSecondVencord(window.Vencord===window.__sublineVencord?${JSON.stringify(SUBLINE_UPDATED_COPY)}:void 0);else{var Vencord=`, {
            file: "dist/Vencord.js",
            what: "bundle start"
        });
    out = rewriteExactlyOnce(out, WEB_BUNDLE_TAIL,
        "})();(function(){var own=Vencord;window.__sublineVencord=own;document.addEventListener(\"DOMContentLoaded\",function(){if(window.Vencord!==own)sublineSecondVencord()},{once:!0})})();}\n//# sourceURL=file:///VencordWeb", {
            file: "dist/Vencord.js",
            what: "bundle end"
        });
    return out;
}
