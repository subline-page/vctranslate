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
     * Show the restart banner. Called AT MOST ONCE per watch — once the user
     * has been told, re-nagging every 15 minutes would be worse than the
     * silence this replaces.
     */
    onUpdateStaged: () => void;
    /** ms between checks (see UPDATE_CHECK_INTERVAL_MS). */
    intervalMs: number;
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
}

export interface UpdateWatch {
    start(): void;
    stop(): void;
}

/**
 * A watch that checks once immediately (an update may have been staged before
 * this Discord even opened) and then on the interval, prompts the first time it
 * sees a newer build, and then stops checking.
 */
export function createUpdateWatch(deps: UpdateWatchDeps): UpdateWatch {
    let handle: unknown = null;
    let prompted = false;

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
        deps.onUpdateStaged();
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
            void check();
            handle = deps.setInterval(() => void check(), deps.intervalMs);
        },
        stop() {
            stopTimer();
        }
    };
}
