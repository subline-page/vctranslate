/**
 * This session's last few error CODES, oldest first, for the feedback box
 * (feedback.ts). Fed by statusBeacon.ts's recordError, so it holds the same
 * closed vocabulary as the beacon (statusShape.ts BEACON_ERROR_CODES): a code,
 * an HTTP status and a time, never an engine's text. Nothing here is sent on
 * its own: the box offers it, and only Send sends it.
 *
 * A module of its own, with no globals, so the settings page can read it
 * without loading anything that touches Vencord's native bridge.
 */

export interface RecentError { code: string; at: string; status?: number }

/**
 * An ISO time floored to the minute ("2026-10-11T10:04:00.000Z"), or null
 * when it is not a time. Error times leave this computer only through the
 * feedback box, and a millisecond time could be matched to one request in a
 * log; the minute cannot. The relay floors again (relay/src/feedback.ts).
 */
export function toMinute(at: string): string | null {
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return null;
    return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

/** How many recent error codes the feedback box can offer to send. */
export const RECENT_ERRORS_KEPT = 10;

let recent: RecentError[] = [];

export function noteRecentError(e: RecentError): void {
    const at = toMinute(e.at);
    if (at === null) return;
    recent.push({ ...e, at });
    if (recent.length > RECENT_ERRORS_KEPT) recent = recent.slice(-RECENT_ERRORS_KEPT);
}

/** A copy, oldest first. */
export function recentErrorCodes(): RecentError[] {
    return recent.map(e => ({ ...e }));
}

export function clearRecentErrors(): void {
    recent = [];
}
