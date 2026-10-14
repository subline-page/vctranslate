/**
 * ASK THE BACKGROUND HELPER FOR A NEW BUILD NOW (2026-10-13).
 *
 * A crash fix was published and took up to six hours to reach paying users:
 * the helper (the installed Subline app, run by launchd or the Task
 * Scheduler) asks the release feed at most every 6 hours, and that rule lives
 * in the APP, which the feed never replaces. This file is in the MOD, which
 * the feed does replace, so it reaches every install.
 *
 * While Discord is open, the plugin asks here every few minutes. This reads
 * the same release feed the helper reads (one ~500-byte file). When it names
 * a newer build than the one running and the one on disk, the helper is told
 * to skip its wait (its state file's `lastUpdateCheckAt` is cleared) and is
 * started now with the operating system's own "run it now":
 *   macOS    launchctl kickstart gui/<uid>/com.subline.helper
 *   Windows  schtasks /Run /TN \Subline\Helper
 * The helper then downloads, checks the checksum, installs and re-patches
 * exactly as it always does; nothing here downloads or installs anything.
 * The restart bar (updateNotice.ts) then sees the new build on disk.
 *
 * MAIN PROCESS ONLY (Node), reached through native.ts. NOTHING HERE THROWS:
 * every failure is an answer ("unreachable", "no-helper"), and the next ask
 * is a few minutes away.
 */

import { execFile } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { compareVersions } from "./appNotice";
import { statusDirFor } from "./statusFile";
import { isBuildId } from "./statusShape";

/** The helper's feed (installer/src/helper/feed.ts RELEASE_FEED_URL), restated: the plugin cannot import installer code. */
export const RELEASE_FEED_URL = "https://github.com/subline-page/subline/releases/latest/download/subline-release.json";
/** installer/src/helper/state.ts HELPER_STATE_FILENAME. */
export const HELPER_STATE_FILENAME = "helper-state.json";
/** installer/src/helper/launchAgent.ts HELPER_LABEL. */
export const HELPER_LABEL = "com.subline.helper";
/** installer/src/helper/scheduledTask.ts HELPER_TASK_NAME. */
export const HELPER_TASK_NAME = "\\Subline\\Helper";

const FEED_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 10_000;

export interface FeedRelease {
    buildId: string;
    pluginVersion: string;
}

/** The build and version a release manifest names, or null when it is not one. */
export function parseFeedRelease(raw: string): FeedRelease | null {
    try {
        const parsed = JSON.parse(raw) as { product?: unknown; buildId?: unknown; pluginVersion?: unknown; } | null;
        if (parsed?.product !== "subline") return null;
        if (typeof parsed.buildId !== "string" || !isBuildId(parsed.buildId)) return null;
        if (typeof parsed.pluginVersion !== "string" || !/^\d+(\.\d+)*$/.test(parsed.pluginVersion)) return null;
        return { buildId: parsed.buildId, pluginVersion: parsed.pluginVersion };
    } catch {
        return null;
    }
}

export type KickDecision =
    /** The feed names the build that is running. */
    | "current"
    /** The helper already put the feed's build on disk: the restart bar's job now. */
    | "staged"
    /** The feed's build is not newer (the helper moves installs forward only). */
    | "not-newer"
    /** A newer build is out and not on disk: ask the helper. */
    | "kick";

/** What to do about the feed's release. The helper's own rule (isNewerBuild): forward only, by version. */
export function decideKick(release: FeedRelease, running: FeedRelease, stagedBuildId: string | null): KickDecision {
    if (release.buildId === running.buildId) return "current";
    if (release.buildId === stagedBuildId) return "staged";
    // Another build is already waiting on disk for a restart (the bar says
    // so). Asking again would only start the helper every few minutes for
    // nothing until Discord restarts; after the restart, asking resumes.
    if (stagedBuildId !== null && stagedBuildId !== running.buildId) return "staged";
    if (compareVersions(release.pluginVersion, running.pluginVersion) <= 0) return "not-newer";
    return "kick";
}

/**
 * Clear the helper's "last asked the feed" time, so its next run asks. Only
 * that one field changes; everything else is written back as read. Written
 * beside the file and renamed over it (the helper does the same, with its own
 * temp name), so the file is always whole. A file that is missing or not an
 * object is left alone: a helper with no state asks the feed anyway.
 */
/**
 * Windows antivirus can hold a just-written file for a moment (the helper's
 * own state writes retry for the same reason, installer/src/helper/state.ts).
 */
function renameWithRetry(from: string, to: string): void {
    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(from, to);
            return;
        } catch (cause) {
            const code = (cause as { code?: unknown; }).code;
            if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw cause;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
    }
}

export function clearHelperUpdateWait(productDir: string): boolean {
    const path = join(productDir, HELPER_STATE_FILENAME);
    const temp = `${path}.plugin.tmp`;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
        const state = parsed as Record<string, unknown>;
        if (state.lastUpdateCheckAt === null || state.lastUpdateCheckAt === undefined) return true;
        writeFileSync(temp, `${JSON.stringify({ ...state, lastUpdateCheckAt: null }, null, 4)}\n`, "utf8");
        renameWithRetry(temp, path);
        return true;
    } catch {
        try { rmSync(temp, { force: true }); } catch { /* nothing to clean */ }
        return false;
    }
}

/** The command that starts the registered helper now, or null on a platform without one. */
export function runHelperCommand(platform: NodeJS.Platform, uid: number | null): { file: string; args: string[]; } | null {
    if (platform === "darwin" && uid !== null) return { file: "/bin/launchctl", args: ["kickstart", `gui/${uid}/${HELPER_LABEL}`] };
    if (platform === "win32") return { file: "schtasks", args: ["/Run", "/TN", HELPER_TASK_NAME] };
    return null;
}

export type AskResult = KickDecision | "unreachable" | "no-helper";

export interface AskDeps {
    platform: NodeJS.Platform;
    uid: number | null;
    productDir: string | null;
    running: FeedRelease;
    fetchFeed: () => Promise<string | null>;
    readStagedBuildId: () => string | null;
    clearWait: (productDir: string) => boolean;
    run: (file: string, args: string[]) => Promise<boolean>;
}

/** One ask. Never throws. */
export async function askHelperForUpdateWith(deps: AskDeps): Promise<AskResult> {
    let raw: string | null;
    try {
        raw = await deps.fetchFeed();
    } catch {
        raw = null;
    }
    const release = raw === null ? null : parseFeedRelease(raw);
    if (release === null) return "unreachable";
    let staged: string | null = null;
    try {
        staged = deps.readStagedBuildId();
    } catch {
        staged = null;
    }
    const decision = decideKick(release, deps.running, staged);
    if (decision !== "kick") return decision;
    const command = runHelperCommand(deps.platform, deps.uid);
    if (command === null || deps.productDir === null) return "no-helper";
    // An old helper whose wait was not cleared would only answer "throttled":
    // try again on the next ask instead of starting it for nothing.
    if (!deps.clearWait(deps.productDir)) return "unreachable";
    return await deps.run(command.file, command.args) ? "kick" : "no-helper";
}

async function fetchFeed(): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    try {
        const res = await fetch(RELEASE_FEED_URL, { signal: controller.signal, redirect: "follow", cache: "no-store" });
        if (!res.ok) return null;
        const text = await res.text();
        return text.length > 64 * 1024 ? null : text;
    } finally {
        clearTimeout(timer);
    }
}

function run(file: string, args: string[]): Promise<boolean> {
    return new Promise(resolve => {
        try {
            execFile(file, args, { timeout: RUN_TIMEOUT_MS, windowsHide: true }, error => resolve(error === null));
        } catch {
            resolve(false);
        }
    });
}

/** The real ask, from Discord's main process. */
export function askHelperForUpdate(running: FeedRelease, readStagedBuildId: () => string | null): Promise<AskResult> {
    const platform = process.platform;
    return askHelperForUpdateWith({
        platform,
        uid: typeof process.getuid === "function" ? process.getuid() : null,
        productDir: statusDirFor(platform, process.env, homedir()),
        running,
        fetchFeed,
        readStagedBuildId,
        clearWait: clearHelperUpdateWait,
        run
    });
}
