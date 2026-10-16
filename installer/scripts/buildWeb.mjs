#!/usr/bin/env node
/**
 * Build the Subline browser add-on: two store-ready zips, Chromium (MV3) and
 * Firefox (MV2), from the SAME pinned Vencord and the same plugin as the
 * desktop mod.
 *
 * Run: `pnpm build:web` from `installer/`.
 * Output: `installer/build/web/`
 *   chromium/                          the unpacked Chromium add-on (load this for a test)
 *   firefox/                           the unpacked Firefox add-on
 *   subline-chromium-<version>.zip     for the Chrome Web Store (Chrome, Edge, Brave, Opera)
 *   subline-firefox-<version>.zip      for Firefox Add-ons
 *
 * WHAT IS SHARED WITH THE DESKTOP BUILD. The checkout, the plugin copy, the
 * pruned plugin set and the Subline settings section all come from
 * vencordSource.mjs, the code buildMod.mjs runs. So the add-on carries only
 * what the desktop build ships, by construction.
 *
 * WHAT IS DIFFERENT.
 *  - Vencord's web entry (browser/Vencord.ts), built by upstream's own
 *    buildWeb.mjs. Its packaging step is skipped: the manifests and the
 *    add-on's own files are Subline's (webManifest.mjs, packaging/browser/).
 *  - The plugin is enabled by default: the web settings store seeds what the
 *    installer writes on the desktop (vencordRewrites.mjs seedWebSettings).
 *  - The plugin's network calls run in the add-on's background, which runs
 *    the plugin's own native.ts there (packaging/browser/router.ts). The desktop-only
 *    natives (status file, staged build, app signals) are not reachable: the
 *    plugin's transport.ts answers them itself without the desktop helpers.
 *  - No helper, feed or status file: the stores update the add-on.
 *
 * The desktop build and this one share build/vencord: run one at a time.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { computeStamp, renderStamp, STAMP_PATH } from "../../scripts/stampBuild.mjs";
import { guardSecondVencord, seedWebSettings, WEB_STUB_FILE } from "./vencordRewrites.mjs";
import {
    BUILD_DIR,
    brandSettings,
    fail,
    INSTALLER_DIR,
    installPlugin,
    log,
    pnpm,
    prepareVencord,
    prunePlugins,
    readPin,
    setBuildLabel,
    VENCORD_DIR
} from "./vencordSource.mjs";
import { ADDON_VERSION, chromiumManifest, firefoxManifest, NETWORK_HOSTS, PACKAGED_FILES } from "./webManifest.mjs";

setBuildLabel("build:web");

const OUT_DIR = join(BUILD_DIR, "web");

/** The web settings seed (seedWebSettings) as it reads in the minified bundle. */
export const ENABLED_SEED_NEEDLE = ".plugins.VcTranslate.enabled=!0";
const BROWSER_SRC = join(INSTALLER_DIR, "packaging", "browser");

/**
 * Node's built-ins, for the background bundle. native.ts imports the
 * desktop-only modules (status file, staged build, app signals), which read
 * and write files. The background never calls them (router.ts runs only the
 * ten network functions), so they get these stand-ins, which fail loudly if
 * that ever changes.
 */
const NODE_STUB = `
const browserOnly = name => () => { throw new Error("Subline: " + name + " is not available in the browser"); };
export const existsSync = browserOnly("existsSync");
export const readFileSync = browserOnly("readFileSync");
export const writeFileSync = browserOnly("writeFileSync");
export const mkdirSync = browserOnly("mkdirSync");
export const renameSync = browserOnly("renameSync");
export const rmSync = browserOnly("rmSync");
export const homedir = browserOnly("homedir");
export const join = (...parts) => parts.join("/");
export const dirname = path => path.slice(0, Math.max(0, path.lastIndexOf("/")));
`;

/** Vencord's Logger, for engines/llmShared.ts. The background has no Vencord. */
const LOGGER_STUB = `
export class Logger {
    constructor(name) { this.name = name; }
    log(...args) { console.log("[" + this.name + "]", ...args); }
    info(...args) { console.info("[" + this.name + "]", ...args); }
    warn(...args) { console.warn("[" + this.name + "]", ...args); }
    error(...args) { console.error("[" + this.name + "]", ...args); }
    debug(...args) { console.debug("[" + this.name + "]", ...args); }
}
`;

/**
 * The key engines (Claude, Gemini, Groq), for the background bundle. Settings
 * does not offer them, router.ts answers them before native.ts is reached, and
 * their hosts are not in the manifest; so their code is left out rather than
 * shipped unreachable. TRUNCATED_ERROR keeps Claude's value, read from
 * claude.ts: native.ts's retry rule compares against it.
 */
function keyEngineStub() {
    const claude = readFileSync(join(INSTALLER_DIR, "..", "src", "userplugins", "vcTranslate", "engines", "claude.ts"), "utf8");
    const truncated = /^export const TRUNCATED_ERROR = ("[^"\n]*");$/m.exec(claude);
    if (truncated === null) fail("engines/claude.ts no longer exports TRUNCATED_ERROR as a string literal.");
    return KEY_ENGINE_STUB.replace("TRUNCATED_ERROR_VALUE", truncated[1]);
}

const KEY_ENGINE_STUB = `
const browserOnly = name => async () => { throw new Error("Subline: " + name + " is not available in the browser"); };
export const TRUNCATED_ERROR = TRUNCATED_ERROR_VALUE;
export const translateWithClaude = browserOnly("Claude");
export const translateWithGemini = browserOnly("Gemini");
export const translateWithGroq = browserOnly("Groq");
`;

/**
 * helperKick.ts asks the desktop app's background helper for a new build
 * (child_process, files in the home folder). A browser has no helper: the
 * store updates the add-on. Never in BRIDGE_METHODS either, so the page could
 * not reach it; left out of the bundle rather than shipped unreachable.
 */
const HELPER_KICK_STUB = `
export const askHelperForUpdate = async () => "no-helper";
`;

/** Plain, unminified: a store reviewer can read every line of it. */
async function bundleBackground(outfile) {
    const esbuild = await import(pathToFileURL(join(VENCORD_DIR, "node_modules", "esbuild", "lib", "main.js")).href);
    const stubs = {
        name: "subline-background-stubs",
        setup(build) {
            build.onResolve({ filter: /^node:(fs|os|path)$/ }, args => ({ path: args.path, namespace: "subline-stub" }));
            build.onResolve({ filter: /^@utils\/Logger$/ }, args => ({ path: args.path, namespace: "subline-stub" }));
            build.onResolve({ filter: /^\.\/engines\/(claude|gemini|groq)$/ }, args => ({ path: "key-engine", namespace: "subline-stub" }));
            build.onResolve({ filter: /^\.\/helperKick$/ }, () => ({ path: "helper-kick", namespace: "subline-stub" }));
            build.onLoad({ filter: /.*/, namespace: "subline-stub" }, args => ({
                contents: args.path === "@utils/Logger" ? LOGGER_STUB
                    : args.path === "key-engine" ? keyEngineStub()
                        : args.path === "helper-kick" ? HELPER_KICK_STUB
                            : NODE_STUB,
                loader: "js"
            }));
        }
    };
    await esbuild.build({
        entryPoints: [join(BROWSER_SRC, "background.ts")],
        outfile,
        bundle: true,
        format: "iife",
        platform: "browser",
        target: ["chrome111", "firefox128"],
        minify: false,
        legalComments: "inline",
        logLevel: "warning",
        plugins: [stubs]
    });
}

function sourceNotice(pin, upstreamVersion, stamp) {
    return `Subline browser add-on — corresponding source
=============================================

This add-on contains the compiled output of two GPL-3.0 works.

1. Vencord (GPL-3.0-or-later), by Vendicated and contributors.
   Repository: ${pin.repository}
   Commit:     ${pin.commit}
   Version:    ${upstreamVersion}

   The corresponding source is that repository at that exact commit, with the
   changes the build makes to it (installer/scripts/vencordSource.mjs and
   installer/scripts/vencordRewrites.mjs in the vcTranslate repository below).
   Licence notices for the third-party code esbuild inlined into Vencord's
   bundle are in dist/Vencord.js.LEGAL.txt.

2. vcTranslate (the Subline translation plugin), GPL-3.0-or-later, with the
   add-on's own files (content.js, pageBridge.js, background.js).
   Repository: https://github.com/subline-page/vctranslate
   Version:    ${stamp.version}
   Build id:   ${stamp.buildId}

3. The plugin includes a common-English word list from SCOWL (Spell Checker
   Oriented Word Lists) release 2020.12.07, http://wordlist.aspell.net/ ,
   Copyright 2000-2018 by Kevin Atkinson. The full notice is in
   dist/Vencord.js.LEGAL.txt.

Built at ${new Date().toISOString()} by installer/scripts/buildWeb.mjs.
`;
}

/** One unpacked add-on: Vencord's web build, our files, the manifest, the notices. */
function assemble(target, manifest, files, backgroundJs, notice) {
    const dir = join(OUT_DIR, target);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "dist"), { recursive: true });

    const dist = name => join(VENCORD_DIR, "dist", name);
    for (const name of ["extension.js", "extension.css", "extension.js.LEGAL.txt"]) {
        if (!existsSync(dist(name))) fail(`Vencord's web build produced no dist/${name}.`);
    }
    // Upstream's packaging renames these the same way (browser/manifest.json loads dist/Vencord.js).
    // esbuild's closing comment names the licence file by its build name.
    // The bundle stays off when another Vencord is already in the page
    // (vencordRewrites.mjs guardSecondVencord).
    const vencordJs = guardSecondVencord(readFileSync(dist("extension.js"), "utf8")
        .replace("see extension.js.LEGAL.txt */", "see Vencord.js.LEGAL.txt */"));
    writeFileSync(join(dir, "dist", "Vencord.js"), vencordJs);
    cpSync(dist("extension.css"), join(dir, "dist", "Vencord.css"));
    cpSync(dist("extension.js.LEGAL.txt"), join(dir, "dist", "Vencord.js.LEGAL.txt"));

    for (const file of files) {
        const destination = join(dir, file);
        mkdirSync(dirname(destination), { recursive: true });
        if (file === "background.js") writeFileSync(destination, backgroundJs);
        else cpSync(join(BROWSER_SRC, file), destination);
    }
    cpSync(join(VENCORD_DIR, "LICENSE"), join(dir, "LICENSE"));
    writeFileSync(join(dir, "SUBLINE-SOURCE.txt"), notice, "utf8");
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    return dir;
}

/**
 * The checks that make "built" mean usable: every file a manifest names is in
 * the package, the plugin is in Vencord's bundle and on by default, and the
 * background reaches no host but the two.
 */
function verify(dir, manifest, stamp) {
    const named = [
        ...Object.values(manifest.icons),
        ...manifest.content_scripts.flatMap(s => s.js),
        ...(manifest.background.service_worker ? [manifest.background.service_worker] : manifest.background.scripts),
        ...(manifest.declarative_net_request?.rule_resources.map(r => r.path) ?? [])
    ];
    for (const file of named) {
        if (!existsSync(join(dir, file))) fail(`${dir} has no ${file}, which its manifest names.`);
    }
    const vencord = readFileSync(join(dir, "dist", "Vencord.js"), "utf8");
    // ENABLED_SEED_NEEDLE is the seed as esbuild minifies it (names are mangled).
    for (const needle of ["VcTranslate", ENABLED_SEED_NEEDLE, "subline_main", stamp.buildId, "sublineSecondVencord", "[Subline] Could not merge settings with another tab"]) {
        if (!vencord.includes(needle)) fail(`${dir}/dist/Vencord.js does not contain "${needle}".`);
    }
    const background = readFileSync(join(dir, "background.js"), "utf8");
    for (const host of NETWORK_HOSTS) {
        const origin = host.replace(/\/\*$/, "");
        if (!background.includes(origin)) fail(`${dir}/background.js does not name ${origin}.`);
    }
}

async function zipDir(dir, zipPath) {
    const { default: Zip } = await import(pathToFileURL(join(VENCORD_DIR, "node_modules", "zip-local", "main.js")).href);
    rmSync(zipPath, { force: true });
    Zip.sync.zip(dir).compress().save(zipPath);
    return statSync(zipPath).size;
}

async function main() {
    const pin = readPin();

    log("1/7  Checking the plugin's build stamp is current");
    const stamp = computeStamp();
    const onDisk = existsSync(STAMP_PATH) ? readFileSync(STAMP_PATH, "utf8") : null;
    if (onDisk !== renderStamp(stamp)) {
        fail("buildStamp.ts is stale. Run `pnpm stamp` at the repo root and commit it, then build again.");
    }
    log(`     plugin ${stamp.version}, build ${stamp.buildId}, add-on ${ADDON_VERSION}`);

    log(`2/7  Fetching pinned Vencord ${pin.commit.slice(0, 12)}`);
    const upstreamVersion = prepareVencord(pin);
    log(`     Vencord ${upstreamVersion} at ${pin.commit}`);

    log("3/7  Preparing the source as the desktop build does");
    log(`     ${installPlugin()} plugin files`);
    log(`     kept ${prunePlugins()}, removed the rest`);
    log(`     ${brandSettings()}`);

    log("4/7  Enabling the plugin by default in the web settings store");
    const stubPath = join(VENCORD_DIR, ...WEB_STUB_FILE.split("/"));
    if (!existsSync(stubPath)) fail(`Vencord's checkout has no ${WEB_STUB_FILE}; the layout has changed.`);
    try {
        writeFileSync(stubPath, seedWebSettings(readFileSync(stubPath, "utf8")));
    } catch (cause) {
        fail(cause instanceof Error ? cause.message : String(cause));
    }

    log("5/7  Installing Vencord's dependencies and building its web bundle");
    pnpm(["install", "--frozen-lockfile"]);
    // --standalone as on the desktop. --skip-extension: upstream's own
    // packaging (its manifests, names and icons) is not used.
    pnpm(["buildWeb", "--standalone", "--skip-extension"]);

    log("6/7  Bundling the background and assembling both add-ons");
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    const backgroundPath = join(OUT_DIR, "background.js");
    await bundleBackground(backgroundPath);
    const backgroundJs = readFileSync(backgroundPath, "utf8");
    rmSync(backgroundPath);
    const notice = sourceNotice(pin, upstreamVersion, stamp);
    const targets = [
        ["chromium", chromiumManifest(), PACKAGED_FILES.chromium],
        ["firefox", firefoxManifest(), PACKAGED_FILES.firefox]
    ];

    log("7/7  Verifying and packing");
    for (const [target, manifest, files] of targets) {
        const dir = assemble(target, manifest, files, backgroundJs, notice);
        verify(dir, manifest, stamp);
        const zipPath = join(OUT_DIR, `subline-${target}-${ADDON_VERSION}.zip`);
        const size = await zipDir(dir, zipPath);
        log(`     ${zipPath}  ${(size / 1024 / 1024).toFixed(2)} MB`);
    }
    log(`\nBuilt ${OUT_DIR}`);
}

main().catch(cause => fail(cause instanceof Error ? cause.stack ?? cause.message : String(cause)));
