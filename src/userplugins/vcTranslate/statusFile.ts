/**
 * Where the status beacon lives on disk, and how it gets there.
 *
 * MAIN PROCESS ONLY. The renderer cannot write files — the same constraint
 * `native.ts` already exists for — so this module is reached exactly the way
 * network calls already are: an export of `native.ts`, invoked from the
 * renderer through `VencordNative.pluginHelpers.VcTranslate`. No second
 * mechanism is introduced.
 *
 * ATOMIC, because the reader is a separate process that may look at any
 * instant. A truncated `writeFileSync` would hand the installer half a JSON
 * document and, worse, could do so for the beacon that was about to prove the
 * install works. Writing a sibling temp file and renaming means a reader sees
 * either the previous complete beacon or the new one. (The reader tolerates a
 * partial document anyway — a rename is atomic within a filesystem, and this
 * is one guarantee worth holding from both ends.)
 *
 * NOTHING HERE THROWS. This sits on the translation hot path via IPC. Spec §7
 * wants diagnostics, not a new way for translation to fail: every failure is
 * reported as `false` and dropped.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
    BEACON_FILENAME, type LaunchRecord, PRODUCT_DIR_NAME, sanitizeBeacon, sanitizeLaunchFields, type StatusBeacon
} from "./statusShape";

/**
 * When this process loaded Subline: Discord's main process, at startup, since
 * native.ts (and so this module) is loaded there before Discord's window
 * opens. Every beacon this process writes belongs to this launch.
 */
const PROCESS_STARTED_AT = new Date().toISOString();

/**
 * Per-platform data directory, as a TABLE rather than an if/else chain.
 *
 * macOS is what ships first (spec §11). Windows is spec §5 and is already
 * written here, because the point of a table is that the second platform is a
 * row and not a redesign — `%LOCALAPPDATA%\Subline` is where spec §5 puts our
 * logs, and it needs no UAC. A platform with no row (or a Windows box with no
 * LOCALAPPDATA) yields null, and a null path means the beacon is silently not
 * written: no beacon is an honest "cannot confirm", which is exactly the
 * result the reader is built to return.
 */
const DATA_DIR_BY_PLATFORM: Partial<
    Record<NodeJS.Platform, (env: NodeJS.ProcessEnv, home: string) => string | null>
> = {
    darwin: (_env, home) => join(home, "Library", "Application Support", PRODUCT_DIR_NAME),
    win32: env => (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, PRODUCT_DIR_NAME) : null)
};

export function statusDirFor(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string | null {
    return DATA_DIR_BY_PLATFORM[platform]?.(env, home) ?? null;
}

export function statusPathFor(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string | null {
    const dir = statusDirFor(platform, env, home);
    return dir === null ? null : join(dir, BEACON_FILENAME);
}

/**
 * Write one beacon to `path`, atomically. Returns whether it landed.
 *
 * The temp file carries the pid so two Discord branches (or a stale process)
 * cannot half-overwrite each other's temp copy and then rename the mixture
 * into place.
 */
export function writeStatusFile(path: string, beacon: StatusBeacon): boolean {
    const temp = `${path}.${process.pid}.tmp`;
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temp, `${JSON.stringify(beacon, null, 4)}\n`, "utf8");
        renameSync(temp, path);
        return true;
    } catch {
        // Best effort by design — see this file's header. Clean up the temp so
        // a failing write does not leave a growing pile of them next to the
        // beacon the installer reads.
        try {
            rmSync(temp, { force: true });
        } catch {
            // Nothing left to try, and nothing that may be thrown.
        }
        return false;
    }
}

export interface WriteBeaconOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    home?: string;
    /** Bypasses path resolution entirely. Tests only. */
    path?: string;
    /** This launch's start. Tests only: defaults to when this process loaded Subline. */
    startedAt?: string;
}

/** The beacon on disk, with its launch fields, or null when there is none to read. */
function readBeaconOnDisk(path: string): { beacon: StatusBeacon; startedAt: string | null; previous: LaunchRecord | null } | null {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        const beacon = sanitizeBeacon(parsed);
        return beacon === null ? null : { beacon, ...sanitizeLaunchFields(parsed) };
    } catch {
        return null;
    }
}

/**
 * What is kept of the launch a file on disk describes (field test F3). A
 * file whose `loadedAt` is older than its own `startedAt` belongs to a
 * launch that started and never loaded Subline in its window: its load
 * fields are someone else's, so they are dropped, and the record says
 * "started, never loaded". That is the trace a crash used to erase.
 */
export function launchRecordOf(onDisk: { beacon: StatusBeacon; startedAt: string | null }): LaunchRecord {
    const loaded = onDisk.startedAt === null || onDisk.beacon.loadedAt >= onDisk.startedAt;
    return {
        startedAt: onDisk.startedAt,
        loadedAt: loaded ? onDisk.beacon.loadedAt : null,
        updatedAt: loaded ? onDisk.beacon.updatedAt : null,
        lastError: loaded ? onDisk.beacon.lastError : null
    };
}

/**
 * Discord's main process has just started Subline (field test F3): move the
 * launch the file describes into `previous` and stamp this one's start. The
 * other fields are left as they are, still the earlier launch's; their
 * `loadedAt` is older than the new `startedAt`, which is how every reader
 * already tells a beacon from an earlier launch. No file yet: nothing to
 * keep, and nothing is written (a beacon needs a load time).
 *
 * MAIN PROCESS, once it is the Discord that stays (noteLaunchWhenPrimary).
 * Never throws, never retries: a beacon is diagnostics and must never be a
 * reason Discord does not start.
 */
export function noteLaunchStarted(options: WriteBeaconOptions = {}): boolean {
    try {
        const path = options.path
            ?? statusPathFor(options.platform ?? process.platform, options.env, options.home);
        if (path === null) return false;
        const startedAt = options.startedAt ?? PROCESS_STARTED_AT;
        const onDisk = readBeaconOnDisk(path);
        if (onDisk === null) return false;
        if (onDisk.startedAt === startedAt) return true;
        return writeStatusFile(path, { ...onDisk.beacon, startedAt, previous: launchRecordOf(onDisk) });
    } catch {
        return false;
    }
}

/** The part of Electron's `app` that noteLaunchWhenPrimary uses. */
export interface LaunchApp {
    whenReady(): Promise<unknown>;
    hasSingleInstanceLock(): boolean;
    once(event: "browser-window-created", listener: () => void): unknown;
}

/**
 * Record this launch (noteLaunchStarted) only once this process is the
 * Discord that keeps running, never for a second launch that only hands over
 * to the first one and quits.
 *
 * WHY. Vencord loads native.ts before Discord's own code runs, so before
 * Discord's single-instance check. Opening Discord while it already runs
 * starts a second process: it loads this module, then Discord's check fails
 * and it quits. Recording at load stamped that process's start into the file,
 * and the next real launch then reported a launch that never loaded
 * ("launch-unloaded"), which was false.
 *
 * WHEN. Whichever comes first, once:
 *   - Electron is ready and this process holds the single-instance lock.
 *     Discord asks for the lock itself; this only reads it with
 *     hasSingleInstanceLock(), which never takes it. (Asking for it here
 *     would change which process Discord sees as the first one.)
 *   - Or this process opens its first window. A second launch that quits
 *     opens none; Discord started with its multi-instance flag holds no lock
 *     but does open one.
 * The start time is still this process's load time (PROCESS_STARTED_AT).
 *
 * NEVER THROWS AND NEVER WAITS. It only adds two listeners and returns; the
 * write runs later, inside its own try.
 */
export function noteLaunchWhenPrimary(app: LaunchApp, options: WriteBeaconOptions = {}): void {
    let done = false;
    const record = () => {
        if (done) return;
        done = true;
        try {
            noteLaunchStarted(options);
        } catch {
            // noteLaunchStarted does not throw; this is belt and braces.
        }
    };
    try {
        app.once("browser-window-created", record);
    } catch {
        // No window event: the lock check below still records.
    }
    try {
        app.whenReady().then(() => {
            try {
                if (app.hasSingleInstanceLock()) record();
            } catch {
                // No lock answer: wait for the first window instead.
            }
        }, () => { });
    } catch {
        // No ready signal: the first window still records.
    }
}

/**
 * The whole main-process side of the beacon: parse what the renderer sent,
 * strip it back to the known shape (see `sanitizeBeacon` — this is where the
 * "never message text" guarantee is enforced, on the writing side, so no
 * renderer mistake can defeat it), resolve the path, write.
 *
 * `raw` is a JSON string for the same reason `translateBatch`'s request is: it
 * crosses IPC, and one serialisation boundary is easier to reason about than a
 * structured-clone of whatever the renderer happened to build.
 */
export function writeStatusBeacon(raw: unknown, options: WriteBeaconOptions = {}): boolean {
    let parsed: unknown;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return false;
        }
    } else {
        parsed = raw;
    }

    const beacon = sanitizeBeacon(parsed);
    if (beacon === null) return false;

    const path = options.path
        ?? statusPathFor(options.platform ?? process.platform, options.env, options.home);
    if (path === null) return false;

    // The launch fields are the main process's own, never the renderer's
    // (field test F3). `previous` is carried over, except when the file
    // describes ANOTHER load that noteLaunchStarted did not move aside (a
    // reload of Discord's window, or a build without the start hook): that
    // load becomes `previous`, so a window that crashed and reloaded leaves
    // its record too.
    const startedAt = options.startedAt ?? PROCESS_STARTED_AT;
    const onDisk = readBeaconOnDisk(path);
    let previous: LaunchRecord | null = null;
    if (onDisk !== null) {
        const sameLoad = onDisk.beacon.loadedAt === beacon.loadedAt;
        const movedAtStart = onDisk.startedAt === startedAt && onDisk.beacon.loadedAt < startedAt;
        previous = sameLoad || movedAtStart ? onDisk.previous : launchRecordOf(onDisk);
    }

    return writeStatusFile(path, { ...beacon, startedAt, previous });
}
