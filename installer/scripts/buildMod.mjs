#!/usr/bin/env node
/**
 * Build the shippable mod bundle: Vencord + vcTranslate, pre-built, plus a
 * manifest that says exactly what it is.
 *
 * Run: `pnpm build:mod` from `installer/`.
 * Output: `installer/build/mod/` — a self-contained directory ready to package,
 * and the thing `patchInstall({ modBundleDir })` installs.
 *
 * ---------------------------------------------------------------------------
 * HOW THE VENCORD SOURCE IS OBTAINED, AND WHY THIS WAY
 * ---------------------------------------------------------------------------
 *
 * A pinned commit, fetched into a throwaway working directory under
 * `installer/build/vencord/`. `vencord.pin.json` holds the repository and the
 * full object id; this script refuses to build if the checkout's `HEAD` is not
 * exactly that commit.
 *
 * **Not "whatever Vencord is on this machine."** The previous stub required
 * `/Users/surfer/dev/Vencord/dist/patcher.js` — a path on one developer's
 * laptop. Depending on a checkout that happens to exist is the precise class of
 * bug that works locally and ships broken, and it also makes "which Vencord are
 * we shipping" unanswerable, which spec §6 needs answered the first time
 * Discord rewrites its frontend and the patches stop matching.
 *
 * **Not a git submodule.** Two concrete problems, not stylistic ones. First, a
 * submodule is empty unless the consumer cloned `--recursive` or remembered
 * `submodule update --init`; the failure is a silently missing directory, which
 * is the same shape of failure we are trying to eliminate. Second, our plugin
 * has to be copied INTO the Vencord tree at `src/userplugins/`, so building
 * would dirty the submodule's working tree on every run — a tracked tree that
 * is always dirty is a tracked tree whose dirtiness stops being informative.
 *
 * **Not a tarball.** GitHub's generated archives are not byte-stable across
 * server-side git versions, so a checksum pin of one is a build that breaks for
 * reasons unrelated to us. A commit id is stable by construction — it *is* a
 * checksum of the tree.
 *
 * `SUBLINE_VENCORD_REMOTE` may point the fetch at a local clone or mirror, for
 * offline or air-gapped builds. It changes only WHERE the objects come from;
 * the pinned commit is still checked out and still verified, so an offline
 * build produces the same bundle rather than a different one. It is never read
 * as a source of truth about which Vencord to use.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUNDLE IS VERIFIED BEFORE IT IS DECLARED BUILT
 * ---------------------------------------------------------------------------
 *
 * "A directory of files proves nothing." The last step runs `inspectBundleDir`
 * — the SAME function `patchInstall` runs at install time — so the build fails
 * here rather than producing a bundle that the installer will reject on a
 * stranger's machine. In particular it proves the build id in the manifest
 * literally appears in the compiled `renderer.js`, which is what makes the
 * recorded identity and the shipped code incapable of disagreeing.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    computeStamp,
    renderStamp,
    STAMP_PATH
} from "../../scripts/stampBuild.mjs";
import {
    digestEntries,
    inspectBundleDir,
    manifestPathFor,
    MOD_MANIFEST_FORMAT,
    renderManifest,
    SOURCE_NOTICE_NAME
} from "../src/bundle/spec.ts";
import { carryMarkerOnHostUpdate, PERSIST_FILE } from "./vencordRewrites.mjs";
import {
    BUILD_DIR,
    brandSettings,
    fail,
    installPlugin,
    log,
    pnpm,
    prepareVencord,
    prunePlugins,
    readPin,
    setBuildLabel,
    VENCORD_DIR
} from "./vencordSource.mjs";

setBuildLabel("build:mod");

const OUT_DIR = join(BUILD_DIR, "mod");

/**
 * Copied out of Vencord's `dist/` into the bundle.
 *
 * The `.map` files are deliberately left behind: they are 7 MB of the 8 MB
 * build and nothing at runtime reads them. The `.LEGAL.txt` files are NOT
 * optional — they carry the licence notices esbuild extracted from the bundled
 * dependencies, and dropping them while redistributing the output is exactly
 * the attribution failure GPL-3.0 §5 is about.
 */
const DIST_FILES = [
    "patcher.js",
    "patcher.js.LEGAL.txt",
    "preload.js",
    "renderer.js",
    "renderer.js.LEGAL.txt",
    "renderer.css"
];

function sourceNotice(pin, upstreamVersion, stamp) {
    return `Subline mod bundle — corresponding source
=========================================

This directory contains the compiled output of two GPL-3.0 works.

1. Vencord (GPL-3.0-or-later), by Vendicated and contributors.
   Repository: ${pin.repository}
   Commit:     ${pin.commit}
   Version:    ${upstreamVersion}

   The corresponding source is that repository at that exact commit, with the
   changes the build makes to it (installer/scripts/vencordSource.mjs and
   installer/scripts/vencordRewrites.mjs in the vcTranslate repository below).
   Licence notices for the third-party code esbuild inlined into these bundles
   are in patcher.js.LEGAL.txt and renderer.js.LEGAL.txt.

2. vcTranslate (the Subline translation plugin), GPL-3.0-or-later.
   Repository: https://github.com/subline-page/vctranslate
   Version:    ${stamp.version}
   Build id:   ${stamp.buildId}

   The build id is a SHA-256 over the plugin's shipped sources, so the sources
   corresponding to this bundle are identifiable rather than merely claimed.

3. The plugin includes a common-English word list from SCOWL (Spell Checker
   Oriented Word Lists) release 2020.12.07, http://wordlist.aspell.net/ ,
   used to judge short Morse decodes.

   Copyright 2000-2018 by Kevin Atkinson

   Permission to use, copy, modify, distribute and sell these word
   lists, the associated scripts, the output created from the scripts,
   and its documentation for any purpose is hereby granted without fee,
   provided that the above copyright notice appears in all copies and
   that both that copyright notice and this permission notice appear in
   supporting documentation. Kevin Atkinson makes no representations
   about the suitability of this array for any purpose. It is provided
   "as is" without express or implied warranty.

   The full notice is also in renderer.js.LEGAL.txt.

Built at ${new Date().toISOString()} by installer/scripts/buildMod.mjs.
`;
}


/**
 * Audit 2026-10-06 #1/#30/#48. On Windows, Vencord's persistAfterDiscordUpdates
 * (bundled in our patcher.js) copies our stub into a new app-x.y.z folder on a
 * host update and copies nothing else, so the new folder lost
 * subline-patch.json. The rewrite makes it write a fresh marker there too.
 * Anchored: a pin bump that moves the code fails the build (vencordRewrites.mjs).
 */
function carryMarker() {
    const path = join(VENCORD_DIR, ...PERSIST_FILE.split("/"));
    if (!existsSync(path)) fail(`Vencord's checkout has no ${PERSIST_FILE}; the layout has changed.`);
    try {
        writeFileSync(path, carryMarkerOnHostUpdate(readFileSync(path, "utf8")));
    } catch (cause) {
        fail(cause instanceof Error ? cause.message : String(cause));
    }
    return `${PERSIST_FILE} now carries subline-patch.json across a host update and starts the helper on quit`;
}

function main() {
    const pin = readPin();

    log("1/6  Checking the plugin's build stamp is current");
    const stamp = computeStamp();
    const onDisk = existsSync(STAMP_PATH) ? readFileSync(STAMP_PATH, "utf8") : null;
    if (onDisk !== renderStamp(stamp)) {
        // Failing here rather than stamping silently: the stamp is checked in
        // and the plugin's own test suite asserts it is current, so a stale one
        // means the working tree and the committed identity disagree — and a
        // bundle built from that would carry an id no committed source produces.
        fail("buildStamp.ts is stale. Run `pnpm stamp` at the repo root and commit it, then build again.");
    }
    log(`     plugin ${stamp.version}, build ${stamp.buildId}`);

    log(`2/6  Fetching pinned Vencord ${pin.commit.slice(0, 12)}`);
    const upstreamVersion = prepareVencord(pin);
    log(`     Vencord ${upstreamVersion} at ${pin.commit}`);

    log("3/6  Copying the plugin into src/userplugins/vcTranslate");
    log(`     ${installPlugin()} files`);

    log(`3b/6 Removing the plugins we do not ship`);
    log(`     kept ${prunePlugins()}, removed the rest`);

    log("3c/6 Rebranding the settings section");
    log(`     ${brandSettings()}`);

    log("3d/6 Carrying Subline's marker through Vencord's host-update repatch");
    log(`     ${carryMarker()}`);

    log("4/6  Installing Vencord's dependencies and building");
    pnpm(["install", "--frozen-lockfile"]);
    // --standalone: the bundle must not assume it sits in a git checkout, which
    //   a local build does.
    // --disable-updater: spec §6 gives Subline's own helper the job of shipping
    //   new builds. Vencord's built-in updater would replace the code behind our
    //   back, and the build id recorded in subline-patch.json would then name a
    //   build that is no longer installed — a healthy install reporting itself
    //   foreign, which is the exact failure the build id exists to prevent.
    pnpm(["build", "--standalone", "--disable-updater"]);

    log("5/6  Assembling the bundle");
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    for (const name of DIST_FILES) {
        const source = join(VENCORD_DIR, "dist", name);
        if (!existsSync(source)) fail(`Vencord's build produced no dist/${name}.`);
        cpSync(source, join(OUT_DIR, name));
    }
    cpSync(join(VENCORD_DIR, "LICENSE"), join(OUT_DIR, "LICENSE"));
    writeFileSync(join(OUT_DIR, SOURCE_NOTICE_NAME), sourceNotice(pin, upstreamVersion, stamp), "utf8");

    writeFileSync(
        manifestPathFor(OUT_DIR),
        renderManifest({
            format: MOD_MANIFEST_FORMAT,
            product: "subline",
            buildId: stamp.buildId,
            pluginVersion: stamp.version,
            vencord: { repository: pin.repository, commit: pin.commit, version: upstreamVersion },
            builtAt: new Date().toISOString(),
            entries: digestEntries(OUT_DIR)
        }),
        "utf8"
    );

    log("6/6  Verifying the bundle is usable, not merely present");
    // The host-update repatch must be in the loader, with our marker carry and
    // upstream's _app.asar guard (Vencord #4472). A pin without either fails.
    const loaderSource = readFileSync(join(OUT_DIR, "patcher.js"), "utf8");
    for (const needle of ["Detected Host Update", "subline-patch.json", "[Subline] Could not carry the patch marker", "discord-quit.json", "[Subline] Could not start the background helper on quit"]) {
        if (!loaderSource.includes(needle)) fail(`the built patcher.js does not contain "${needle}".`);
    }
    const facts = inspectBundleDir(OUT_DIR);
    if (facts.manifest === null || facts.problems.length > 0) {
        fail(`the bundle this build just produced is not installable:\n  ${facts.problems.join("\n  ")}`);
    }

    log(`\nBuilt ${OUT_DIR}`);
    log(`  build id      ${facts.manifest.buildId}  (present in renderer.js)`);
    log(`  plugin        ${facts.manifest.pluginVersion}`);
    log(`  Vencord       ${facts.manifest.vencord.version} @ ${facts.manifest.vencord.commit}`);
    log(`  loader path   ${facts.loaderPath}`);
}

main();
