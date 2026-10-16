/**
 * GUARD HEALTH: tell the relay when a crash guard (surfaces/guard.tsx) caught
 * an error, so a patch that still applies but now misbehaves reaches the
 * owner like a patch that stopped applying (relay/src/patchHealth.ts).
 *
 * WHAT IS SENT. The patch health report shape, through the same send path:
 * plugin version, Subline build id, Discord's release channel and build
 * number, and one row per handler: `{ plugin: "VcTranslate", find:
 * "guard:<handler>", state: "threw" }`. Never the error's text, a message,
 * a name or an id. The error itself is logged on this computer only.
 *
 * HOW OFTEN. One report, GUARD_REPORT_DELAY_MS after the first catch of a
 * session, holding every handler caught by then (at most MAX_GUARD_HANDLERS).
 * At most once per Discord build per UTC day (the DataStore mark, the same
 * rule as runPatchHealthCheck). Relay down: the handlers are kept on disk and
 * sent 60 s after the next start. Never throws.
 */

import { MAX_FAILED, releaseChannel, type PatchHealthReport } from "./patchHealth";

export const GUARD_STORE_KEY = "VcTranslate_guardHealth";
export const GUARD_REPORT_DELAY_MS = 60_000;
export const MAX_GUARD_HANDLERS = Math.min(20, MAX_FAILED);
const HANDLER_RE = /^[A-Za-z]{1,40}$/;

export interface GuardReportRow { plugin: "VcTranslate"; find: string; state: "threw"; }
export type GuardReport = Omit<PatchHealthReport, "failed"> & { failed: GuardReportRow[]; };

interface Pending { channel: PatchHealthReport["channel"]; discordBuild: number; handlers: string[]; }
interface Stored { key?: string; pending?: Pending; }

export interface GuardHealthDeps {
    now: () => number;
    pluginVersion: string;
    buildId: string;
    channel: () => unknown;
    buildNumber: () => number;
    load: () => Promise<unknown>;
    save: (value: Stored) => Promise<void>;
    /** Resolves true when the relay took the report, "rejected" when it refused its shape (400). */
    send: (report: GuardReport) => Promise<boolean | "rejected">;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    log?: (message: string, detail?: unknown) => void;
}

export interface GuardHealth {
    /** Read what an earlier session could not send; arm a report for it. */
    start(): void;
    /** A guard caught an error in `handler`. */
    note(handler: string): void;
    stop(): void;
}

function buildOf(n: unknown): number {
    const v = Number(n);
    return Number.isInteger(v) && v > 0 && v <= 99_999_999 ? v : 0;
}

function pendingFrom(raw: unknown): Pending | undefined {
    const p = (raw as Stored | undefined)?.pending as any;
    if (!p || typeof p !== "object" || !Array.isArray(p.handlers)) return undefined;
    const handlers = (p.handlers as unknown[]).filter((h): h is string => typeof h === "string" && HANDLER_RE.test(h)).slice(0, MAX_GUARD_HANDLERS);
    if (handlers.length === 0) return undefined;
    return { channel: releaseChannel(p.channel), discordBuild: buildOf(p.discordBuild), handlers };
}

/** The report for these handlers: names only, in exactly the shape the relay accepts. */
export function guardReport(pluginVersion: string, buildId: string, p: Pending): GuardReport {
    return {
        v: 1, plugin: pluginVersion, build: buildId, channel: p.channel, discordBuild: p.discordBuild,
        failed: p.handlers.map(h => ({ plugin: "VcTranslate", find: `guard:${h}`, state: "threw" }))
    };
}

export function createGuardHealth(deps: GuardHealthDeps): GuardHealth {
    const seen: string[] = [];
    let timer: unknown = null;
    let running = false;
    let fired = false;
    /** After a fire the relay did not take: later catches go to disk for the next start. */
    let keepForNextStart = false;
    let afterFire: Stored = {};
    let carried: Pending | undefined;

    const arm = () => {
        if (!running || fired || timer !== null) return;
        timer = deps.setTimeout(() => { timer = null; void fire(); }, GUARD_REPORT_DELAY_MS);
    };

    const current = () => ({ channel: releaseChannel(deps.channel()), discordBuild: buildOf(deps.buildNumber()) });

    const send = async (p: Pending): Promise<boolean | "rejected"> => {
        try {
            return await deps.send(guardReport(deps.pluginVersion, deps.buildId, p));
        } catch {
            return false;
        }
    };

    async function fire(): Promise<void> {
        if (fired) return;
        fired = true;
        try {
            const stored = await deps.load().catch(() => undefined) as Stored | undefined;
            const cur = current();
            const day = new Date(deps.now()).toISOString().slice(0, 10);
            const key = `${cur.channel}:${cur.discordBuild}:${day}`;
            const next: Stored = typeof stored?.key === "string" ? { key: stored.key } : {};
            let handlers = [...seen];
            const old = pendingFrom(stored) ?? carried;
            if (old && old.channel === cur.channel && old.discordBuild === cur.discordBuild) {
                handlers = [...new Set([...old.handlers, ...handlers])].slice(0, MAX_GUARD_HANDLERS);
            } else if (old) {
                // Caught under another Discord build: sent as its own report, once.
                await send(old);
            }
            if (handlers.length > 0 && next.key !== key) {
                deps.log?.(`crash guards caught errors in ${handlers.join(", ")} on Discord ${cur.channel} ${cur.discordBuild}`);
                const res = await send({ ...cur, handlers });
                if (res === true) next.key = key;
                else if (res === false) {
                    next.pending = { ...cur, handlers };
                }
            }
            afterFire = next;
            keepForNextStart = next.pending !== undefined;
            await deps.save(next).catch(() => { });
        } catch (err) {
            deps.log?.("guard health report failed", err);
        }
    }

    return {
        start() {
            if (running) return;
            running = true;
            void Promise.resolve().then(() => deps.load()).then(raw => {
                carried = pendingFrom(raw);
                if (carried) arm();
            }).catch(() => { });
        },
        note(handler) {
            try {
                if (!HANDLER_RE.test(handler)) return;
                if (!seen.includes(handler)) {
                    if (seen.length >= MAX_GUARD_HANDLERS) return;
                    seen.push(handler);
                } else if (keepForNextStart) return;
                if (keepForNextStart) {
                    const p = afterFire.pending!;
                    afterFire = { ...afterFire, pending: { ...p, handlers: [...new Set([...p.handlers, handler])].slice(0, MAX_GUARD_HANDLERS) } };
                    void deps.save(afterFire).catch(() => { });
                    return;
                }
                arm();
            } catch { /* never the crash */ }
        },
        stop() {
            running = false;
            if (timer !== null) deps.clearTimeout(timer);
            timer = null;
        }
    };
}
