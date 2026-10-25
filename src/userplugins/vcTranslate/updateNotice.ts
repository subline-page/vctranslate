/**
 * Notice the user when Subline has updated underneath a running Discord.
 *
 * THE GAP THIS FILLS. The background helper installs a new bundle and re-patches
 * Discord's app.asar on its own, but the code already loaded into THIS Discord
 * keeps running until Discord is restarted. The helper's only prompt is an OS
 * notification, which is easy to miss — the maker lost Subline on their own Mac
 * this way ("i didn't know the update happened"). So the running plugin watches
 * for a newer build staged on disk and raises an in-Discord banner with a
 * one-click restart.
 *
 * PURE AND INJECTED. No Vencord imports live here: the comparison and the
 * polling take their dependencies as arguments, so both are unit-tested without
 * a Discord. index.tsx supplies the real Notices / relaunch / native reader.
 */

/**
 * How often the running plugin re-checks the disk. Every minute (2026-10-13):
 * the plugin now asks the helper for a new build every 5 minutes
 * (helperKick.ts), so the bar should follow the install within a minute, not
 * 15. One tiny local JSON read; NOT on any hot path.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * How long the notice waits for the staged version before it shows without
 * "What's new". The read is one small local file, so this only matters on a
 * stuck main process: the restart prompt itself must never wait on it.
 */
export const VERSION_READ_TIMEOUT_MS = 2000;

export const UPDATE_NOTICE_COPY = {
    text: "Subline updated in the background. Restart Discord to load the new version.",
    button: "Restart Discord",
    whatsNew: "What's new"
} as const;

/**
 * The releases page, newest first. NOT the page of one version
 * (releases/tag/vX.Y.Z): that page exists only once the version is public,
 * and a dogfood build staged before its release opened GitHub's 404 there
 * (2026-10-22). The list never 404s, and for a user its top entry is the
 * version the helper just installed.
 */
const RELEASES_URL = "https://github.com/subline-page/subline/releases";

/** Three plain numbers, the same shape stagedBuild.ts reads from disk. */
const VERSION_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/**
 * The release notes of `version` (the version the notice is about, NOT the
 * running one), or null for anything that is not a plain x.y.z. Null means
 * no "What's new" link: the notes are written once per release on GitHub, so
 * there is nothing to show for a version we cannot name.
 */
export function releaseNotesUrl(version: unknown): string | null {
    if (typeof version !== "string" || !VERSION_PATTERN.test(version)) return null;
    return RELEASES_URL;
}

/**
 * Only a https github.com/subline-page/subline release page is ever opened.
 * openExternal hands the URL to the operating system, so a value read from
 * disk must never be able to open anything else.
 */
export function isReleaseNotesUrl(url: unknown): url is string {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        return u.protocol === "https:"
            && u.hostname === "github.com"
            && u.port === ""
            && u.username === ""
            && u.password === ""
            && (u.pathname === "/subline-page/subline/releases" || u.pathname.startsWith("/subline-page/subline/releases/"));
    } catch {
        return false;
    }
}

/**
 * Should we prompt for a restart, given what is running and what is staged?
 *
 * IDENTITY, not ordering — the same comparison the helper uses to decide a
 * build is new (installer's `isNewerBuild`). A staged id equal to what is
 * running means this Discord is already on it; a different, well-formed id
 * (the reader validates shape before it ever reaches here) means the bundle on
 * disk is ahead of the code in memory. A null staged id — no install dir, no
 * manifest, unreadable — is never a prompt.
 */
export function shouldPromptRestart(
    runningBuildId: string,
    stagedBuildId: string | null
): boolean {
    return stagedBuildId !== null && stagedBuildId !== runningBuildId;
}

export interface UpdateWatchDeps {
    /** The build id compiled into the running plugin (BUILD_ID). */
    runningBuildId: string;
    /** Reads the staged bundle's build id from disk. May reject; treated as null. */
    readStagedBuildId: () => Promise<string | null>;
    /**
     * Reads the staged bundle's version from disk, for "What's new". Optional;
     * may reject, throw or never answer. Every failure is a null version, never
     * a missing notice.
     */
    readStagedVersion?: () => Promise<string | null>;
    /**
     * Show the restart banner, with the staged version (null when unknown).
     * Called AT MOST ONCE per watch — once the user has been told, re-nagging
     * every 15 minutes would be worse than the silence this replaces.
     */
    onUpdateStaged: (version: string | null) => void;
    /** ms between checks (see UPDATE_CHECK_INTERVAL_MS). */
    intervalMs: number;
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
    /** For the version read's time limit. Default: the global timers. */
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
}

export interface UpdateWatch {
    start(): void;
    stop(): void;
}

/**
 * The staged version, or null when it is unknown, the read fails, or it takes
 * longer than VERSION_READ_TIMEOUT_MS. Never rejects.
 */
function versionWithin(deps: UpdateWatchDeps): Promise<string | null> {
    const read = deps.readStagedVersion;
    if (read === undefined) return Promise.resolve(null);
    const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    const clearT = deps.clearTimeout ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
    return new Promise(resolve => {
        let done = false;
        const finish = (v: string | null) => {
            if (done) return;
            done = true;
            clearT(timer);
            resolve(v);
        };
        const timer = setT(() => finish(null), VERSION_READ_TIMEOUT_MS);
        try {
            read().then(v => finish(typeof v === "string" ? v : null), () => finish(null));
        } catch {
            finish(null);
        }
    });
}

/**
 * A watch that checks once immediately (an update may have been staged before
 * this Discord even opened) and then on the interval, prompts the first time it
 * sees a newer build, and then stops checking.
 */
export function createUpdateWatch(deps: UpdateWatchDeps): UpdateWatch {
    let handle: unknown = null;
    let prompted = false;
    let stopped = false;

    async function check(): Promise<void> {
        if (prompted) return;
        let staged: string | null;
        try {
            staged = await deps.readStagedBuildId();
        } catch {
            // An unreadable manifest is not an update; try again next tick.
            return;
        }
        if (!shouldPromptRestart(deps.runningBuildId, staged)) return;
        prompted = true;
        // Nothing left to watch for — the answer will not change until a
        // restart, which this prompt is asking for.
        stopTimer();
        const version = await versionWithin(deps);
        // The plugin stopped while the version was read: no notice after stop.
        if (stopped) return;
        deps.onUpdateStaged(version);
    }

    function stopTimer(): void {
        if (handle !== null) {
            deps.clearInterval(handle);
            handle = null;
        }
    }

    return {
        start() {
            if (handle !== null || prompted) return;
            stopped = false;
            void check();
            handle = deps.setInterval(() => void check(), deps.intervalMs);
        },
        stop() {
            stopped = true;
            stopTimer();
        }
    };
}
