import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { HeardEvent } from "./engines/relay";
import type { PlanStateName } from "./planState";
import { HEARD_COPY } from "./upgradeCopy";

/**
 * "WHERE DID YOU HEAR ABOUT SUBLINE?" Asked ONCE per computer, ever, so the
 * owner can see which channel brings people (the installer cannot ask: it
 * never contacts the relay).
 *
 * WHEN. At a channel switch after a real translation has shown at least once
 * (usageDays.ts), never while typing, never while the Link comes first, and
 * never in a session that already showed a window or another ask (heardDue).
 *
 * WHAT GOES OUT. One tap sends that answer's name and nothing else
 * (events.ts sendEvent, `{"e": "heard_reddit"}`), counted by the relay once
 * per install for all answers together. Skip, the X, Escape or a click
 * outside send nothing.
 *
 * BIAS TO SILENCE. The "asked" mark is stored BEFORE the question shows: a
 * mark that cannot be stored shows nothing, and a read that fails asks
 * nothing this session. Any stored value at all counts as asked.
 */

export const HEARD_KEY = "VcTranslate_heardAsked";

/** The answers, in the order shown. Each sends its own event. */
export const HEARD_OPTIONS: readonly { event: HeardEvent; label: string; }[] = [
    { event: "heard_server", label: HEARD_COPY.server },
    { event: "heard_friend", label: HEARD_COPY.friend },
    { event: "heard_reddit", label: HEARD_COPY.reddit },
    { event: "heard_video", label: HEARD_COPY.video },
    { event: "heard_search", label: HEARD_COPY.search },
    { event: "heard_store", label: HEARD_COPY.store },
    { event: "heard_other", label: HEARD_COPY.other }
];

export interface HeardInputs {
    /** Whether the question was asked on this computer; null while unknown (not read, or the read failed). */
    asked: boolean | null;
    /** A real translation has shown at least once. */
    translated: boolean;
    plan: PlanStateName;
    typing: boolean;
    /** A window or another ask already showed this session. */
    busySession: boolean;
}

/** Is the question due now? Pure. */
export function heardDue(i: HeardInputs): boolean {
    return i.asked === false && i.translated && i.plan !== "link" && !i.typing && !i.busySession;
}

/* ------------------------------------------------------- the stored one -- */

export interface HeardStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

const logger = new Logger("VcTranslate");
const DATASTORE: HeardStore = { get: key => DataStore.get(key), set: (key, value) => DataStore.set(key, value) };

let asked: boolean | null = null;
let store: HeardStore = DATASTORE;

/** Read whether it was asked. A failed read leaves it unknown: nothing is asked this session. */
export async function loadHeard(from: HeardStore = DATASTORE): Promise<void> {
    store = from;
    asked = null;
    try {
        asked = (await from.get(HEARD_KEY)) !== undefined;
    } catch (e) {
        logger.warn(`the heard-from mark could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export function heardAsked(): boolean | null {
    return asked;
}

/**
 * Mark it asked, BEFORE the question shows. True only when the mark is
 * stored: the caller shows nothing otherwise. Either way it is not asked
 * again this session.
 */
export async function markHeardAsked(now: number = Date.now()): Promise<boolean> {
    if (asked !== false) return false;
    asked = true;
    try {
        await store.set(HEARD_KEY, now);
        return true;
    } catch (e) {
        logger.warn(`the heard-from question was not shown: its mark could not be stored: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}

/** Tests and stop(). */
export function __resetHeard(): void {
    asked = null;
    store = DATASTORE;
}
