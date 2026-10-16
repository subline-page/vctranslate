/**
 * CRASH GUARDS: every piece of Subline that Discord's own code calls (the
 * `$self` handlers in surfaces/patches.ts) gives Discord its own value back on
 * ANY throw, and when the owner's off switch names its feature.
 *
 * WHY. Vencord drops a patch that no longer parses, and falls back to the
 * original module when a patched module throws while it loads. It does NOT
 * catch a throw from a handler at render time: that reaches Discord's React
 * tree. A Discord change that leaves a patch matching but hands the handler
 * something new must never break Discord.
 *
 * THREE LAYERS.
 *  - `guard`: the handler call itself. Off switch first, then the handler in
 *    try/catch. A throw is noted (`noteGuardCatch`: the handler name only,
 *    reported by guardHealth.ts) and the fallback (what Discord had there) is
 *    returned.
 *  - `SurfaceBoundary`: every element a handler returns is wrapped in Vencord's
 *    ErrorBoundary, whose fallback renders Discord's original. A child that
 *    throws while it renders is invisible to try/catch.
 *  - `guardHook`: a hook placed in Discord's render. Its own hook calls always
 *    run (React's hook order); a throw gives 0.
 *
 * Every guarded function carries SYM_GUARDED; tests/patchGuards.test.ts fails
 * the build when a patch calls a handler without it.
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { React } from "@webpack/common";

import settings from "../settings";
import type { FeatureId } from "./features";

export const SYM_GUARDED = Symbol.for("subline.guarded");

/** Every handler a patch calls (relay/src/features.ts HANDLER_FEATURES has the same names). */
export type HandlerId =
    | "wrapParser" | "stageTopicProps" | "threadTitleProps" | "forumTitleChildren" | "forumTagChildren"
    | "statusTextChildren" | "bioInPlace" | "onboardingHeading" | "statusBubbleText" | "useSurfaceVersion"
    | "replyQuoteChildren" | "messageAuthorName" | "mentionName" | "profileNameLine";

/**
 * What Discord had where the handler sits: its first argument (the handler
 * wraps that value), nothing (the handler appends a child), or the props
 * `{ children: first argument }` (the handler builds a props object). A
 * function picks it from the arguments for any other shape.
 */
export type Fallback<A extends unknown[]> = "first" | "null" | "props" | ((args: A) => unknown);

/* ------------------------------------------------------------ off switch -- */

/** Whether the owner switched this feature off (the last status answer that said, see applyStatus). Never throws. */
export function isFeatureOff(id: FeatureId | null): boolean {
    if (id === null) return false;
    try {
        const off = settings.store.remoteOff as unknown;
        return Array.isArray(off) && off.includes(id);
    } catch {
        return false;
    }
}

/* --------------------------------------------------------- guard catches -- */

type CatchSink = (handler: HandlerId, error: unknown) => void;
let sink: CatchSink | null = null;
const caught: HandlerId[] = [];
const MAX_CAUGHT = 100;

/** The plugin's start() points this at guardHealth.ts; stop() clears it. */
export function setGuardCatchSink(next: CatchSink | null): void {
    sink = next;
}

/** A guard caught a throw. Never throws. */
export function noteGuardCatch(handler: HandlerId, error: unknown): void {
    try {
        caught.push(handler);
        if (caught.length > MAX_CAUGHT) caught.shift();
        sink?.(handler, error);
    } catch { /* a report must never become the crash */ }
}

/** The handlers whose guard caught something this session (the last 100), oldest first. */
export function guardCatchesSoFar(): HandlerId[] {
    return [...caught];
}

export function __resetGuardCatches(): void {
    caught.length = 0;
}

let probe: ((handler: HandlerId) => void) | null = null;
/** For tests: runs first inside every guard (a probe that throws stands for a throw anywhere in the handler). */
export function __setGuardProbe(next: ((handler: HandlerId) => void) | null): void {
    probe = next;
}

/* ------------------------------------------------------------- boundary -- */

const BOUNDARY_MESSAGE = "Subline: a translation did not render. Discord's own is shown.";

/** The boundary's fallback: Discord's own value, exactly as it was. */
function ShowOriginal({ wrappedProps }: { wrappedProps?: { original?: unknown; }; }) {
    return (wrappedProps?.original ?? null) as any;
}

/** `children` inside Vencord's ErrorBoundary: an error below renders `original` and is noted for `handler`. */
export function SurfaceBoundary({ handler, original, children }: { handler: HandlerId; original: unknown; children?: unknown; }) {
    return (
        <ErrorBoundary
            fallback={ShowOriginal as any}
            wrappedProps={{ original }}
            onError={({ error }: { error: unknown; }) => noteGuardCatch(handler, error)}
            message={BOUNDARY_MESSAGE}
        >
            {children as any}
        </ErrorBoundary>
    );
}

function keyOf(node: any): string {
    const k = node?.key ?? node?.props?.key;
    return typeof k === "string" && k !== "" ? k : "subline-surface";
}

/** `out` in a SurfaceBoundary whose fallback is `original`, unless it IS Discord's value or holds no element. */
function bounded(handler: HandlerId, original: unknown, out: unknown): unknown {
    if (out === original || out === null || typeof out !== "object") return out;
    return React.createElement(SurfaceBoundary as any, { key: keyOf(out), handler, original }, out as any);
}

/* ---------------------------------------------------------------- guard -- */

function fallbackOf<A extends unknown[]>(fallback: Fallback<A>, args: A): unknown {
    if (fallback === "first") return args[0];
    if (fallback === "null") return null;
    if (fallback === "props") return { children: args[0] };
    return fallback(args);
}

/**
 * `fn`, guarded: Discord's own value (`fallback`) when `feature(...args)` is
 * switched off, and on any throw (in `feature`, `fn`, or wrapping the result).
 * What `fn` returns is put inside a SurfaceBoundary; for "props", its
 * `children` is.
 */
export function guard<A extends unknown[], R>(
    handler: HandlerId, fallback: Fallback<NoInfer<A>>, feature: (...args: NoInfer<A>) => FeatureId | null, fn: (...args: A) => R
): (...args: A) => R {
    const guarded = function (this: unknown, ...args: A): R {
        let original: unknown;
        try {
            original = fallbackOf(fallback, args);
        } catch {
            original = args[0];
        }
        try {
            probe?.(handler);
            if (isFeatureOff(feature(...args))) return original as R;
            const out = fn.apply(this, args) as unknown;
            if (fallback === "props") {
                const children = (original as { children: unknown; }).children;
                if (out === null || typeof out !== "object" || (out as any).children === children) return out as R;
                return { ...(out as object), children: bounded(handler, children, (out as any).children) } as R;
            }
            return bounded(handler, original, out) as R;
        } catch (err) {
            noteGuardCatch(handler, err);
            return original as R;
        }
    };
    (guarded as any)[SYM_GUARDED] = true;
    return guarded;
}

/**
 * A hook Discord's render calls. `use` always runs (hook order), then 0 when
 * the feature is off; 0 on a throw.
 */
export function guardHook(handler: HandlerId, feature: FeatureId, use: () => number): () => number {
    const guarded = (): number => {
        try {
            const v = use();
            probe?.(handler);
            return isFeatureOff(feature) ? 0 : v;
        } catch (err) {
            noteGuardCatch(handler, err);
            return 0;
        }
    };
    (guarded as any)[SYM_GUARDED] = true;
    return guarded;
}
