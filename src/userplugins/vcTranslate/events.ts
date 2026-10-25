import { type FunnelEvent, isFunnelEvent } from "./engines/relay";
import { hasTransport, transport } from "./transport";

/**
 * FUNNEL STEPS FOR THE OWNER PAGE (relay POST /v1/event).
 *
 * Five steps of the way in, counted by the relay once per install per step
 * (its ever:ev marker, 400 days, relay/src/funnel.ts countEvent): the Link
 * bar shown, the Authorize window opened, the link done, the window closed
 * without a link, and the prices ($1.99 a month, $19.99 a year) shown to a
 * linked account with no plan. Only the step's name goes out (`{"e": name}`), with
 * the headers every relay call carries.
 *
 * RULES. Fire and forget: sendEvent returns nothing, never awaits, never
 * throws, never retries. Each step goes out at most once per Discord session
 * (in memory). Nothing goes out without a transport or without an install id
 * (the source answers null). Nothing on screen changes because of it.
 */

/** Who the step is for: the relay credential and the install bearer, or null when there is no install id yet. */
export type EventSource = () => { credential: string; install: string; } | null;

let source: EventSource | null = null;
const sentThisSession = new Set<FunnelEvent>();

/** index.tsx sets it at start() and clears it (null) at stop(). */
export function setEventSource(next: EventSource | null): void {
    source = next;
}

/** Send one funnel step, at most once this session. Never throws, never blocks. */
export function sendEvent(name: FunnelEvent): void {
    try {
        if (!isFunnelEvent(name) || sentThisSession.has(name)) return;
        if (source === null || !hasTransport()) return;
        const who = source();
        if (who === null || typeof who.install !== "string" || who.install === "" || typeof who.credential !== "string" || who.credential === "") return;
        // Marked before it goes: a failure is not sent again (no retries).
        sentThisSession.add(name);
        void Promise.resolve()
            .then(() => transport.relayEvent(who.credential, who.install, name))
            .catch(() => { /* a count only: nothing to say */ });
    } catch {
        // A count only: nothing to say.
    }
}

/**
 * The price step counts only a linked account with no plan and no code: the
 * reader who saw the prices and has to decide. Anyone else seeing a panel is not
 * that step.
 */
export function priceSeenApplies(state: { linkState: string; level: string; code: string; }): boolean {
    return state.linkState === "linked" && state.level === "none" && state.code === "";
}

/** Tests only: forget what this session sent. */
export function __resetEventsForTests(): void {
    sentThisSession.clear();
    source = null;
}
