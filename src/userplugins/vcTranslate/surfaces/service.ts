/**
 * Translation for text OUTSIDE messages, for installs whose ✦ is on.
 *
 * LAZY. Nothing is requested until a component that shows the text renders
 * and calls `want(text)`. A member list only asks for the statuses on screen.
 *
 * BATCHED. `want` never sends anything itself: it queues the text, and a
 * short quiet period later every queued text leaves in one ✦ request (the
 * relay), at most `maxBatch` per request. Fifty statuses appearing at once
 * cost two relay requests, not fifty, and each of those still waits its turn
 * at the shared rate gate (the caller's `translate`).
 *
 * ✦ ONLY (0.2.9, spec decision 1). There is no Google tier any more: a text
 * shows its ✦ translation, or nothing (the original, untouched) until ✦ has
 * answered, when ✦ cannot be had, and when it needs no translation.
 *
 * CACHED BY TEXT. See cache.ts. A text already translated is never sent again.
 *
 * ALLOWED ONLY. `isPaid()` is asked before anything is queued and again before
 * anything is sent. An install that may not ask ✦ never queues a text, so it
 * never sends a surface request, and its screens are exactly as they were.
 *
 * NO CONTEXT. Surface texts are sent with no conversation around them; the
 * caller builds the request.
 *
 * NAMES AND PRONOUNS (0.2.8) ride the same queue, cache and caps. They are
 * allowed by their own setting (`namesAllowed`), not by the surfaces one, and
 * since 0.2.9 (spec decision 14) they ask ✦ by themselves like every other
 * surface: cached and reused, and nothing is sent for a name in the reader's
 * own script (names.ts decides that before `want` is called). A name the AI
 * alone might read (runes, names.ts aiOnlyName) is `askOnly`: it waits for
 * the reader's ✦ click (`askQuality`), a forced request.
 */

import { fitTextToLimit } from "../fitRequest";
import { nameKey, normalizeSurfaceText, type SurfaceCache, type SurfaceEntry, surfaceKey } from "./cache";

/** One text's verdict from ✦, in request order. */
export type SurfaceVerdict = { lang: string; text: string } | "skip" | "fail";

/**
 * What `translate` returns: a verdict per text, in order, or `null` for "not
 * now" (sent, but refused or unreachable). "Not now" is retried later; a
 * "fail" verdict is not retried for `failRetryMs`. `"busy"` means nothing was
 * sent at all (a message batch was out, a cooldown, no gate slot): it costs
 * no per-minute slot and no budget, and is retried after `busyRetryMs`.
 */
export type SurfaceOutcome = SurfaceVerdict[] | null | "busy";

/** How a batch is asked for. `force`: the reader clicked ✦, so the relay never skips it. */
export interface SurfaceSendOptions { force?: true; }

export interface SurfaceDeps {
    isPaid(): boolean;
    /**
     * Names and pronouns may be translated: ✦ on, and the "Names and
     * pronouns" setting on. Asked instead of `isPaid` for every text wanted
     * with `name: true`, before it is queued and again before it is sent.
     * Absent means never.
     */
    namesAllowed?(): boolean;
    /**
     * Whether ✦ (the relay) may be asked: ✦ is on for this account. Absent
     * means true.
     */
    qualityAllowed?(): boolean;
    /**
     * ✦ is allowed but cannot be had right now (the relay is cooling down
     * after a 429, or held). A ✦ click is not offered meanwhile. Absent means
     * never paused.
     */
    qualityPaused?(): boolean;
    targetLang(): string;
    /** The plugin's own local rules: nothing translatable, or already the target language. */
    locallySkipped(text: string): boolean;
    translate(texts: string[], options?: SurfaceSendOptions): Promise<SurfaceOutcome>;
    cache: SurfaceCache;
    now(): number;
    schedule(fn: () => void, ms: number): unknown;
    cancel(handle: unknown): void;
    debug?(message: string): void;
    /**
     * The surfaces' own daily ✦ allowance in cost units (see budget.ts and
     * `surfaceCost`). When it is spent, nothing more goes to the relay today:
     * the originals show, untouched. Absent means unlimited (tests of other rules).
     */
    budget?: { remaining(): number; spend(units: number): void; };
    /** At most this many relay requests per minute for surfaces (default 4). */
    maxQualityPerMinute?: number;
    maxBatchBytes?: number;
    qualityDebounceMs?: number;
    maxBatch?: number;
    failRetryMs?: number;
    notNowRetryMs?: number;
    busyRetryMs?: number;
}

export const SURFACE_QUALITY_DEBOUNCE_MS = 1_500;
export const SURFACE_MAX_BATCH = 25;
/** A batch never carries more than this much text (UTF-8 bytes). */
export const SURFACE_MAX_BATCH_BYTES = 20 * 1024;
/** Longer texts are not surface-translated at all: no request, no line. */
export const SURFACE_MAX_TEXT_CHARS = 2_000;
/**
 * The cap for long-text kinds (an embed description allows 4,096). The same
 * number as the relay's per-text limit (relay/src/index.ts MAX_TEXT_CHARS):
 * one text over it makes the relay refuse the whole batch.
 */
export const SURFACE_MAX_LONG_TEXT_CHARS = 4_000;

/**
 * A long text cut to fit SURFACE_MAX_LONG_TEXT_CHARS, at a paragraph break,
 * a sentence end or a space, never inside a Discord token (fitRequest.ts
 * fitTextToLimit). `partial` says the line covers only the first part.
 */
export function fitLongText(text: string): { text: string; partial: boolean; } {
    return fitTextToLimit(text, SURFACE_MAX_LONG_TEXT_CHARS);
}

/** What one text costs against the daily budget: 1 + one per started 1,000 characters. */
export function surfaceCost(text: string): number {
    return 1 + Math.ceil(text.length / 1000);
}

function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}
export const SURFACE_FAIL_RETRY_MS = 10 * 60_000;
export const SURFACE_NOT_NOW_RETRY_MS = 60_000;
/** Nothing was sent (a message batch was out): ask again soon. */
export const SURFACE_BUSY_RETRY_MS = 8_000;
/**
 * At most this many tight texts wait. Rows scrolled past fall off the old end
 * without ever being sent; what is on screen now is the newest.
 */
export const SURFACE_MAX_PENDING = 60;
/**
 * Before a batch carrying tight texts leaves, mounted views are asked to
 * render again, and a tight text only goes if it is wanted again within this
 * long. A row scrolled past is no longer mounted, so it never spends.
 */
export const SURFACE_PROBE_MS = 300;
export const SURFACE_MAX_QUALITY_PER_MINUTE = 4;
const MINUTE_MS = 60_000;

export interface WantOptions {
    /** A tight mark (a tooltip on a list row, a title, a tag): the translation in place, or the original. */
    tight?: boolean;
    /** A kind that may be long (an embed description): the 4,000 cap applies, see fitLongText. */
    long?: boolean;
    /** A name or pronouns: allowed by `namesAllowed`. */
    name?: boolean;
    /**
     * Never sent by itself: only the reader's ✦ click asks for it
     * (askQuality). A name the AI alone might read (names.ts aiOnlyName).
     */
    askOnly?: boolean;
}

interface PendingText {
    text: string;
    tight: boolean;
    wantedAt: number;
    /** Wanted only as a name or pronouns: kept only while `namesAllowed`. */
    name: boolean;
    /** The reader clicked ✦ for it: sent in a forced request of its own. */
    forced: boolean;
}

export class SurfaceService {
    private readonly pending = new Map<string, PendingText>();
    /** When the probe for the next flush went out (see SURFACE_PROBE_MS), or null. */
    private probeAt: number | null = null;
    /** One timer that wakes mounted views when parked texts may be asked again. */
    private wake: { handle: unknown; at: number; } | null = null;
    private readonly inFlight = new Set<string>();
    private readonly retryAt = new Map<string, number>();
    private timer: unknown = null;
    private readonly listeners = new Set<() => void>();
    private generation = 0;
    /** Requests actually sent. For tests and debug logging. */
    sent = 0;
    /** When each recent surface request left, for the per-minute cap. */
    private sends: number[] = [];
    /**
     * A request is out. The next batch is armed only when it comes back: one
     * request at a time, never a burst of parallel ones.
     */
    private busy = false;
    /** The last ✦ request that went out got no answer (unreachable, timed out, a 5xx, malformed). */
    private qualityFailing = false;

    constructor(private readonly deps: SurfaceDeps) { }

    /**
     * What to show for `text` right now, and queue it when it is still
     * missing. `null` means show nothing: not allowed, nothing foreign, or
     * nothing yet.
     */
    want(text: string | null | undefined, options: WantOptions = {}): SurfaceEntry | null {
        const name = options.name === true;
        if (typeof text !== "string") return null;
        if (!this.allowed(name)) {
            this.trace(text, name ? "not allowed (names: setting off or no AI)" : "not allowed (surfaces: setting off or no AI)");
            return null;
        }
        let norm = normalizeSurfaceText(text);
        if (options.long) norm = fitLongText(norm).text;
        if (norm === "" || (norm.length > SURFACE_MAX_TEXT_CHARS && !options.long)) return null;
        if (this.deps.locallySkipped(norm)) {
            this.trace(norm, "skipped here (nothing to translate, or the reading language)");
            return null;
        }
        const key = this.keyOf(norm, name);
        const entry = this.deps.cache.get(key);
        if (entry?.skip) { this.trace(norm, "the relay said: no translation needed"); return null; }
        if (entry?.quality) return entry;
        if (options.askOnly === true) { this.trace(norm, "waits for a ✦ click"); return entry ?? null; }
        if (!this.qualityAllowed()) { this.trace(norm, "not asked: ✦ is not allowed now"); return entry ?? null; }
        if (this.budgetLeft() <= 0) { this.trace(norm, "not asked: today's allowance is spent"); return entry ?? null; }
        this.trace(norm, name ? "queued (a name: forced, never skipped)" : "queued");
        // A name is always asked forced: it reached here only because it is
        // in a script the reader does not read, so its reading always helps.
        this.queue(key, norm, options.tight === true, name, name);
        return entry ?? null;
    }

    /** Debug log only, once per text and reason (want() runs on every render). */
    private traced = new Set<string>();
    private trace(text: string, why: string): void {
        if (!this.deps.debug) return;
        const k = why + "\u0000" + text;
        if (this.traced.has(k)) return;
        if (this.traced.size > 500) this.traced.clear();
        this.traced.add(k);
        this.deps.debug(`[surface] "${text.slice(0, 40)}": ${why}`);
    }

    /** The reading language right now (a name's script rule is checked against it on every render). */
    readingLanguage(): string {
        return this.deps.targetLang();
    }

    /** Surfaces by `isPaid`; names and pronouns by `namesAllowed`. */
    private allowed(name: boolean): boolean {
        if (name) return this.deps.namesAllowed?.() ?? false;
        return this.deps.isPaid();
    }

    /**
     * What is cached for `text`, WITHOUT asking for anything: a hover that
     * has not opened yet sends nothing.
     */
    peek(text: string | null | undefined, name = true): SurfaceEntry | null {
        if (typeof text !== "string") return null;
        const norm = normalizeSurfaceText(text);
        if (norm === "") return null;
        return this.deps.cache.get(this.keyOf(norm, name)) ?? null;
    }

    /** A name's key, or an ordinary surface text's (see nameKey). */
    private keyOf(norm: string, name: boolean): string {
        return name ? nameKey(norm, this.deps.targetLang()) : surfaceKey(norm, this.deps.targetLang());
    }

    /** `text` is queued or out right now: an answer may still come. */
    waiting(text: string | null | undefined, name = true): boolean {
        if (typeof text !== "string") return false;
        const key = this.keyOf(normalizeSurfaceText(text), name);
        return this.pending.has(key) || this.inFlight.has(key);
    }

    /**
     * ✦ for one name or pronouns, because the reader clicked ✦. One FORCED
     * request (the relay never skips it), through the same queue, per-minute
     * cap and daily surfaces allowance as every surface ✦. Nothing for an
     * install that may not ask ✦, while ✦ is down, or once today's surface ✦
     * is spent. True when it is queued, out, or answered.
     */
    askQuality(text: string | null | undefined): boolean {
        if (typeof text !== "string" || !this.allowed(true) || !this.canAskQuality()) return false;
        const norm = normalizeSurfaceText(text);
        if (norm === "" || norm.length > SURFACE_MAX_TEXT_CHARS) return false;
        const key = nameKey(norm, this.deps.targetLang());
        const cached = this.deps.cache.get(key);
        if (cached?.quality) {
            // A ✦ for the same text is already here (from a status, say): it
            // is the reader's answer now, at no cost.
            if (!cached.asked) {
                this.deps.cache.put(key, { asked: true });
                this.notify();
            }
            return true;
        }
        if (this.inFlight.has(key)) return true;
        // The reader asked again: an earlier failure's wait does not apply.
        this.retryAt.delete(key);
        this.queue(key, norm, false, true, true);
        return true;
    }

    /** A ✦ click can be sent: ✦ is allowed, not down, and today's surfaces allowance is not spent. */
    canAskQuality(): boolean {
        return this.qualityAllowed() && this.budgetLeft() > 0 && !this.qualityDown();
    }

    /** Whether ✦ may be asked right now (see SurfaceDeps.qualityAllowed). */
    qualityAllowed(): boolean {
        return this.deps.qualityAllowed ? this.deps.qualityAllowed() : true;
    }

    /** ✦ cannot be had right now: its last request failed, or it is paused. */
    qualityDown(): boolean {
        return this.qualityFailing || (this.deps.qualityPaused?.() ?? false);
    }

    private budgetLeft(): number {
        return this.deps.budget ? this.deps.budget.remaining() : Number.POSITIVE_INFINITY;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** Stop everything: nothing queued is sent, nothing in flight is written. */
    stop(): void {
        this.generation++;
        if (this.timer !== null) this.deps.cancel(this.timer);
        this.timer = null;
        this.pending.clear();
        this.qualityFailing = false;
        this.inFlight.clear();
        this.retryAt.clear();
        this.sends = [];
        this.busy = false;
        this.probeAt = null;
        if (this.wake !== null) this.deps.cancel(this.wake.handle);
        this.wake = null;
        this.listeners.clear();
    }

    private queue(key: string, text: string, tight = false, name = false, forced = false): void {
        if (this.inFlight.has(key)) return;
        const retry = this.retryAt.get(key);
        if (retry !== undefined && this.deps.now() < retry) return;
        const queue = this.pending;
        // Re-inserted on every want, so the newest end of the map is what is
        // on screen now; flush sends from that end first.
        const was = queue.get(key);
        queue.delete(key);
        queue.set(key, {
            text,
            tight: tight && (was?.tight ?? true),
            wantedAt: this.deps.now(),
            // A name only while every want was one (a status with the same
            // text keeps it a surface); forced once any want was a click.
            name: name && (was?.name ?? true),
            forced: forced || (was?.forced ?? false)
        });
        // Tight texts only: a list row is wanted again whenever it is on
        // screen, while a roomy line under a message may render just once.
        if (queue.size > SURFACE_MAX_PENDING) {
            for (const [k, p] of queue) {
                if (queue.size <= SURFACE_MAX_PENDING) break;
                if (p.tight) queue.delete(k);
            }
        }
        this.arm();
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try { listener(); } catch { /* one broken listener must not starve the rest */ }
        }
    }

    /**
     * Wake mounted views at `at`, when a parked text may be asked again. Only
     * views still on screen call want() again, so nothing that has scrolled
     * away or closed is sent. One timer, moved earlier when needed.
     */
    private scheduleWake(at: number): void {
        const current = this.wake;
        if (current !== null && current.at <= at) return;
        if (current !== null) this.deps.cancel(current.handle);
        const generation = this.generation;
        const handle = this.deps.schedule(() => {
            if (generation !== this.generation) return;
            this.wake = null;
            this.notify();
        }, Math.max(0, at - this.deps.now()) + 1);
        this.wake = { handle, at };
    }

    private arm(atLeastMs = 0): void {
        if (this.timer !== null || this.busy) return;
        const ms = Math.max(atLeastMs, this.deps.qualityDebounceMs ?? SURFACE_QUALITY_DEBOUNCE_MS);
        this.timer = this.deps.schedule(() => {
            this.timer = null;
            void this.flush();
        }, ms);
    }

    private async flush(): Promise<void> {
        const queue = this.pending;
        if (queue.size === 0) return;
        if (!this.qualityAllowed()) {
            // The plan changed under a queued batch: send nothing.
            this.deps.debug?.(`[surface] ${queue.size} queued, dropped: ✦ not allowed`);
            queue.clear();
            return;
        }
        // The plan or a setting changed under a queued batch: whatever is no
        // longer allowed is not sent.
        for (const [key, p] of [...queue.entries()]) if (!this.allowed(p.name)) queue.delete(key);
        if (queue.size === 0) return;
        const max = this.deps.maxBatch ?? SURFACE_MAX_BATCH;
        const maxBytes = this.deps.maxBatchBytes ?? SURFACE_MAX_BATCH_BYTES;
        const left = this.budgetLeft();
        if (left <= 0) {
            // Today's surface ✦ is spent: nothing more goes to the relay.
            queue.clear();
            return;
        }
        // At most `maxQualityPerMinute` relay REQUESTS a minute. A full window
        // waits for its oldest entry to age out.
        {
            const now = this.deps.now();
            this.sends = this.sends.filter(t => now - t < MINUTE_MS);
            const cap = this.deps.maxQualityPerMinute ?? SURFACE_MAX_QUALITY_PER_MINUTE;
            if (this.sends.length >= cap) {
                this.deps.debug?.(`[surface] ${queue.size} queued, waiting: ${cap} requests this minute`);
                this.arm(this.sends[0] + MINUTE_MS - now);
                return;
            }
        }
        // STILL ON SCREEN? A tight text (a list row, a title) is wanted on
        // render, so rows scrolled past sit in the queue too. Ask mounted
        // views to render again and send only the tight texts wanted again;
        // the rest never spend a request or the day's budget.
        if (this.probeAt === null && this.listeners.size > 0 && [...queue.values()].some(p => p.tight)) {
            const generation = this.generation;
            this.probeAt = this.deps.now();
            this.timer = this.deps.schedule(() => {
                this.timer = null;
                if (generation === this.generation) void this.flush();
            }, SURFACE_PROBE_MS);
            this.notify();
            return;
        }
        if (this.probeAt !== null) {
            const probedAt = this.probeAt;
            this.probeAt = null;
            for (const [key, p] of [...queue.entries()]) if (p.tight && p.wantedAt < probedAt) queue.delete(key);
            if (queue.size === 0) return;
        }
        // Pack by count, by size, and by what today's budget still allows,
        // NEWEST FIRST: what was wanted last is what is on screen. A text the
        // budget can no longer afford is dropped from the queue.
        const batch: Array<[string, string]> = [];
        let bytes = 0;
        let units = 0;
        // A ✦ click is FORCED (the relay never skips it) and an ordinary text
        // is not, so one request carries one kind: the newest text's. The
        // other kind waits for the next request.
        const newest = [...queue.values()].at(-1);
        const forced = newest?.forced === true;
        for (const [key, { text, forced: f }] of [...queue.entries()].reverse()) {
            if (batch.length >= max) break;
            if (f !== forced) continue;
            const size = byteLength(text);
            if (batch.length > 0 && bytes + size > maxBytes) break;
            const cost = surfaceCost(text);
            if (units + cost > left) {
                if (batch.length === 0) { queue.delete(key); continue; }
                break;
            }
            batch.push([key, text]);
            bytes += size;
            units += cost;
        }
        if (batch.length === 0) return;
        // Chosen newest first, sent in the order they were wanted.
        batch.reverse();
        this.sends.push(this.deps.now());
        for (const [key] of batch) {
            queue.delete(key);
            this.inFlight.add(key);
        }

        const generation = this.generation;
        this.busy = true;
        const texts = batch.map(([, text]) => text);
        this.sent++;
        this.deps.debug?.(`[surface] quality: ${texts.length} text(s) in one request`);
        let outcome: SurfaceOutcome;
        try {
            outcome = await this.deps.translate(texts, forced ? { force: true } : undefined);
        } catch {
            outcome = null;
        }
        if (generation !== this.generation) return;
        this.busy = false;
        const now = this.deps.now();
        if (outcome === "busy") {
            // Nothing left this computer: give back the per-minute slot it
            // took, spend no budget, and ask again soon.
            this.sends.pop();
            const at = now + (this.deps.busyRetryMs ?? SURFACE_BUSY_RETRY_MS);
            for (const [key] of batch) {
                this.inFlight.delete(key);
                this.retryAt.set(key, at);
            }
            this.scheduleWake(at);
            if (this.pending.size > 0) this.arm();
            return;
        }
        // Whatever did not fit, or was asked for meanwhile, leaves in the next
        // request, armed only now that this one is back.
        if (this.pending.size > 0) this.arm();
        if (outcome !== null) this.deps.budget?.spend(units);
        this.qualityFailing = outcome === null;

        let earliestRetry = Number.POSITIVE_INFINITY;
        batch.forEach(([key], i) => {
            this.inFlight.delete(key);
            const verdict = outcome === null ? null : outcome[i];
            if (verdict === null || verdict === undefined) {
                this.retryAt.set(key, now + (this.deps.notNowRetryMs ?? SURFACE_NOT_NOW_RETRY_MS));
            } else if (verdict === "fail") {
                this.retryAt.set(key, now + (this.deps.failRetryMs ?? SURFACE_FAIL_RETRY_MS));
            } else if (verdict === "skip" && forced) {
                // A current relay never skips a forced request; an older one
                // may. That is no verdict about a name the reader asked for:
                // nothing is cached, and it may be clicked again after the
                // fail wait.
                this.retryAt.set(key, now + (this.deps.failRetryMs ?? SURFACE_FAIL_RETRY_MS));
            } else if (verdict === "skip") {
                // ✦ decided it needs no translation (already the reader's
                // language): cached, so it is not asked again.
                this.deps.cache.put(key, { skip: true });
                this.retryAt.set(key, now + (this.deps.failRetryMs ?? SURFACE_FAIL_RETRY_MS));
            } else {
                // A forced ✦ is the reader's own click on a name: marked asked.
                this.deps.cache.put(key, { quality: verdict, ...(forced ? { asked: true as const } : {}) });
            }
            const retry = this.retryAt.get(key);
            if (retry !== undefined && retry > now && verdict !== "skip") earliestRetry = Math.min(earliestRetry, retry);
        });
        // A text parked for "not now" or a failure is asked for again by the
        // views still showing it, once its wait is over. Without this wake,
        // a popout opened during a message batch stayed untranslated until
        // something unrelated re-rendered it.
        if (Number.isFinite(earliestRetry)) this.scheduleWake(earliestRetry);
        this.notify();
    }
}
