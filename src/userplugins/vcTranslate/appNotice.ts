/**
 * Tell the user, once, that their installed Subline APP is too old.
 *
 * The update feed keeps the mod bundle current but never the installed app,
 * and the app's background helper is what repairs Discord after a Discord
 * update. An old app therefore keeps an old helper forever. This is the
 * worst-case fallback: one notice in Discord, with a button to the download
 * page. Running the new app keeps the user's code (it lives in Vencord's
 * settings, which the installer merges into and never replaces).
 *
 * RULES.
 *  - Never blocks translation. This only ever shows a notice.
 *  - Once per mod version. Recorded BEFORE it is shown, so a Discord restart,
 *    an ignored notice or a crash never shows it twice. A later mod version
 *    shows it again only if the app is still old.
 *  - Only the app version decides. A "could not repair" alert in alerts.json
 *    can outlive the fix (the app's install flow does not clear it), and this
 *    mod running at all shows Discord is patched. It is logged, never shown.
 *  - Only on a Subline-managed install (signals.managed). A Vencord-only or
 *    hand-built install has no Subline app to update.
 *  - THE MAC DOCK NOTICE (0.2.12): the Mac app before 0.2.12 has a helper
 *    that bounces in the Dock every 5 minutes, and only a new app fixes it
 *    (LSUIElement is in the app, which never updates itself). A Mac app from
 *    MIN_APP_VERSION up to before MIN_MAC_APP_VERSION gets its own short
 *    text ONCE (its own key, never again for any mod version). An app older
 *    than MIN_APP_VERSION gets the first notice instead, which asks for the
 *    same download. Never on Windows or Linux (signals.mac).
 *
 * PURE AND INJECTED, like updateNotice.ts. index.tsx supplies the real
 * DataStore, native reader and notice.
 */

import type { AppSignals } from "./appSignals";

/**
 * The oldest app whose helper this mod is happy with. THE one place this is
 * set. Raise it when a release fixes something only the app or helper can fix.
 */
export const MIN_APP_VERSION = "0.2.4";

/**
 * The oldest Mac app without the Dock bounce (its helper has LSUIElement).
 * Mac only: Windows has no Dock, and its app is unchanged.
 */
export const MIN_MAC_APP_VERSION = "0.2.12";

/** Where the Download button goes. */
export const APP_DOWNLOAD_URL = "https://subline.page/#downloads";

/** DataStore key: the mod version the notice was last shown for. */
export const APP_NOTICE_SHOWN_KEY = "VcTranslate_appNoticeShownFor";

export const APP_NOTICE_COPY = {
    text: "Download the new Subline once to keep it working after Discord updates.",
    button: "Download",
    later: "Later"
} as const;

/** DataStore key: true once the Mac Dock notice was shown (once, ever). */
export const APP_DOCK_NOTICE_SHOWN_KEY = "VcTranslate_appDockNoticeShown";

export const APP_DOCK_NOTICE_COPY = {
    text: "Download the new Subline once to stop its Dock icon bouncing.",
    button: "Download",
    later: "Later"
} as const;

/** Which notice: the app is too old ("old"), or a Mac app with the Dock bounce ("dock"). */
export type AppNoticeKind = "old" | "dock";

/**
 * Compare dotted numeric versions. Missing parts are 0 ("0.2" = "0.2.0").
 * A part that is not a number counts as 0, so garbage reads as old, never new.
 */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(n => Number.parseInt(n, 10));
    const pb = b.split(".").map(n => Number.parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = Number.isFinite(pa[i]) ? pa[i]! : 0;
        const y = Number.isFinite(pb[i]) ? pb[i]! : 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** Is this app too old? Null (no file, corrupt file) is old. */
export function appTooOld(appVersion: string | null, min: string = MIN_APP_VERSION): boolean {
    return appVersion === null || compareVersions(appVersion, min) < 0;
}

/** Should the notice show now? */
export function shouldShowAppNotice(
    signals: AppSignals,
    modVersion: string,
    lastShownFor: unknown,
    min: string = MIN_APP_VERSION
): boolean {
    if (!signals.managed) return false;
    if (lastShownFor === modVersion) return false;
    return appTooOld(signals.appVersion, min);
}

/**
 * Should the Mac Dock notice show now? A managed Mac install whose app is new
 * enough for the first notice (MIN_APP_VERSION) but older than
 * MIN_MAC_APP_VERSION, and the notice was never shown.
 */
export function shouldShowDockNotice(signals: AppSignals, dockShown: unknown): boolean {
    if (!signals.managed || signals.mac !== true) return false;
    if (dockShown === true) return false;
    return !appTooOld(signals.appVersion) && appTooOld(signals.appVersion, MIN_MAC_APP_VERSION);
}

/** Which notice is due now, if any (see the rules above). */
export function appNoticeDue(signals: AppSignals, modVersion: string, lastShownFor: unknown, dockShown: unknown): AppNoticeKind | null {
    if (shouldShowAppNotice(signals, modVersion, lastShownFor)) return "old";
    if (shouldShowDockNotice(signals, dockShown)) return "dock";
    return null;
}

export interface AppNoticeDeps {
    /** The running mod's version (PLUGIN_VERSION). */
    modVersion: string;
    /** Reads the app's signals. May reject; a rejection shows nothing. */
    readSignals: () => Promise<AppSignals>;
    storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; };
    /** Show the notice: "old" (APP_NOTICE_COPY) or "dock" (APP_DOCK_NOTICE_COPY). */
    show: (kind: AppNoticeKind) => void;
    /** Diagnostics: why nothing was shown, or that it was. Never message text. */
    log?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * Check once and show the notice if it is due. Returns whether it showed.
 * Never throws.
 */
export async function checkAppNotice(deps: AppNoticeDeps): Promise<boolean> {
    try {
        const signals = await deps.readSignals();
        const read = async (key: string): Promise<unknown> => {
            try {
                return await deps.storage.get(key);
            } catch {
                return undefined;
            }
        };
        const lastShownFor = await read(APP_NOTICE_SHOWN_KEY);
        const dockShown = signals.mac === true ? await read(APP_DOCK_NOTICE_SHOWN_KEY) : undefined;
        const kind = appNoticeDue(signals, deps.modVersion, lastShownFor, dockShown);
        if (kind === null) return false;
        // Recorded first: if this write fails, the notice is NOT shown, so a
        // broken store can never turn "once" into "every launch".
        if (kind === "old") await deps.storage.set(APP_NOTICE_SHOWN_KEY, deps.modVersion);
        else await deps.storage.set(APP_DOCK_NOTICE_SHOWN_KEY, true);
        deps.log?.("app-notice.shown", {
            kind,
            appVersion: signals.appVersion,
            cannotRepair: signals.cannotRepair,
            min: kind === "old" ? MIN_APP_VERSION : MIN_MAC_APP_VERSION
        });
        deps.show(kind);
        return true;
    } catch (cause) {
        deps.log?.("app-notice.check-failed", { cause: String(cause) });
        return false;
    }
}
