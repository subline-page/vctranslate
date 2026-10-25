import { ChatBarButton, type ChatBarProps } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { popNotice, showNotice } from "@api/Notices";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { relaunch } from "@utils/native";
import { copyToClipboard } from "@utils/clipboard";
import {
    ChannelStore, FluxDispatcher, GuildMemberStore, GuildRoleStore, LocaleStore, Menu, MessageStore,
    Parser, React, SelectedChannelStore, UserStore
} from "@webpack/common";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import type { Message } from "@vencord/discord-types";
import { FEEDBACK_COPY, reportFor } from "./feedback";
import { openReportModal } from "./feedbackPanel";

import { CONTEXT_RING_SIZE, createBatcher, type Batcher } from "./batcher";
import { forgetNotices, putNotice, takeNotice } from "./sublineNotice";
import { clipParentText, fitLlmRequest, joinParts, LLM_TEXT_MAX, partId, shrinkAfterRefusal, splitTextToLimit, withParentCopies } from "./fitRequest";
import { cleanTranslation, dropCustomEmoji } from "./customEmoji";
import { renderDiscordMarkup, type MarkupResolvers } from "./discordMarkup";
import { channelAccount, forgetChannelAccount, isChannelDisabled, isChannelEnabled, subscribeChannels, toggleChannel, toggleChannelOptOut, useChannelAccount } from "./channels";
import { beginChannelSync, channelChangedHere, channelOpened, channelSyncFocus, endChannelSync } from "./channelSync";
import { bindPrefStore, forgetPrefAccount, onPrefChangedHere, prefAccount, type PrefKey, type PrefValue, usePrefAccount, withoutPrefStamp } from "./prefs";
import { beginPrefSync, endPrefSync, prefChangedHere, prefSyncFocus } from "./prefSync";
import { __resetCooldowns, cooldownUntil, loadCooldowns, setCooldown } from "./cooldownStore";
import { DECODED_TITLE, decodedPrefix, decodeMessage, translatableText } from "./decode";
import { isConfidentlyTargetLanguage } from "./detectLang";
import {
    ENTITLEMENT_KEY, entitlementLevel, ENTITLEMENT_REFRESH_MS, getEntitlement, holderFor, type Level, linkState, loadEntitlement, mustLink, purchaseStartedHere, setCurrentHolder,
    setEntitlement, setEntitlementKey, subscribeEntitlement
} from "./entitlement";
import {
    accountKeyFor, bindLegacyInstall, type Binding, type CodeFields, type CodeFieldStore, codeSlotFor, connectBindingSetting, dropPendingBind,
    forgetSessionBinding, installForAccount, type LocalAccount, notePendingBind, noteLocalAccount, parseCodeFields, type PendingBind, planElsewhere,
    NOBODY, settleLegacyLink, swapCodeFields
} from "./account";
import { openLinkWindow, silentLinkAttempt } from "./link";
import { runBrowserLink } from "./linkFallback";
import { priceSeenApplies, sendEvent, setEventSource } from "./events";
import {
    type AccountView, askPairCode, fill, moveDate, openAccountConfirm, openElsewherePlanChoice, openMessage, openMoveHere, openMoveStart, openPayElsewhere,
    setPanelCrashHandler
} from "./linkPanels";
import type { RelayRefusal } from "./native";
import { contentHash, loadPreviewLedger, rememberPreview, type PreviewResult } from "./freePlan";
import {
    acquireSlot, loadRateGateTuning, rateGateAvailable, rateGateSettings, rateGateWaitMs,
    resetRateGate, tryAcquireIdleSlot, tuneRateGateToObservedLimit
} from "./rateGate";
import { languageLabel } from "./langLabel";
import settings from "./settings";
import { onSettingsChanged } from "./settingsBridge";
import { toast, type ToastKind } from "./toast";
import { shouldSkip } from "./skip";
import {
    connectInstallIdSetting, EARLY_CHECK_MS, earlyCheckSince, endEarlyCheck, forgetInstallId, installIdOnce, knownInstallId, loadLocalTasteCount,
    markPriorHintDone, markTasteExhausted, noteRelayClock, noteTasteSpent, priorUseHint, recordTasteQuota, requireAccount, rolloverTasteIfNewUtcDay,
    setTasteScope, TASTE_CAP, tasteBearer, tasteCap, tasteExhausted, tasteRemaining, useInstallId
} from "./taste";
import {
    recordError, recordPluginLoaded, recordRendered, recordTranslation, resetStatusBeacon
} from "./statusBeacon";
import { BUILD_ID, PLUGIN_VERSION, type BeaconErrorCode } from "./statusShape";
import {
    clearLanguage, clearStore, dropDeferred, getTranslation, invalidateMessage, loadPersistedTranslations, makeKey,
    setTranslation, subscribe, type StoredTranslation
} from "./store";
import {
    ENGINE_CAPS, QUALITY_DEBOUNCE_MS, QUALITY_MAX_BATCH,
    type BatchRequest, type EngineId, type PendingMessage, type Result
} from "./types";
import { isRealTranslation, mayReplace, rankOf } from "./upgrade";
import { createCheckoutFlow, type CheckoutFlow, type Plan, type ReservedTab, reserveTab } from "./checkout";
import { isRtlLang, normalizeTargetLang } from "./languages";
import { isPaymentPending, openUpgrade, registerUpgradeOpener, setPaymentPending, settingsShowing, subscribePaymentPending } from "./upgradeBridge";
import { ACCOUNT_COPY, ADDON_RELOAD_COPY, FALLBACK_COPY, LINK_COPY, MOVE_COPY, PLAN_COPY, SUPPORT_EMAIL, UPGRADE_COPY, WHATS_NEW_URL } from "./upgradeCopy";
import { emptyNotes, endedDue, lastDayDue, notesFrom, type PlanNotes, planView, type PlanView, updateTextFor, withNote } from "./planState";
import { accessFrom, NEW_DAYS_FALLBACK } from "./planAccess";
import {
    closePanel, type CodeSubmitResult, openCodeEntry, openEndedPanel, openPlanPanel, openUpdatePanel
} from "./upgradePanel";
import { createUpdateWatch, isReleaseNotesUrl, releaseNotesUrl, UPDATE_CHECK_INTERVAL_MS, UPDATE_NOTICE_COPY, type UpdateWatch } from "./updateNotice";
import { buildNumberFromVencord, createPatchHealthWatch, HEALTH_STORE_KEY, runPatchHealthCheck, scanFromVencord, type PatchHealthWatch } from "./patchHealth";
import { APP_DOWNLOAD_URL, APP_NOTICE_COPY, checkAppNotice } from "./appNotice";
import { SurfaceBudget } from "./surfaces/budget";
import { SurfaceCache } from "./surfaces/cache";
import {
    messageSurfaceTexts, onboardingHeadingTexts, onboardingOptionTexts,
    type SurfaceKind, type SurfaceText
} from "./surfaces/extract";
import { aiOnlyName, nameToTranslate, pronounsToTranslate } from "./surfaces/names";
import { resetNameTips, SafeNameHover, SafeProfileNameLine } from "./surfaces/namesUi";
import { SURFACE_PATCHES } from "./surfaces/patches";
import { guard, guardCatchesSoFar, guardHook, type HandlerId, isFeatureOff, setGuardCatchSink } from "./surfaces/guard";
import { type FeatureId, offListFrom } from "./surfaces/features";
import { createGuardHealth, GUARD_STORE_KEY, type GuardHealth } from "./guardHealth";
import { SurfaceService, type SurfaceOutcome, type SurfaceSendOptions } from "./surfaces/service";
import {
    BioInPlace, currentSurfaceService, DecodedStatus, resetInPlaceFlips, safe, setSurfaceRtl, setSurfaceService, StatusBubbleText, SurfaceLines, tightTranslation, TightSwap,
    useSurfaceVersion
} from "./surfaces/ui";
import { __resetWeeklyStats, closeWeekIfDue, countShown, loadWeeklyStats } from "./weeklyNote";
import { isDesktop, onWebAddonGone, transport } from "./transport";

const logger = new Logger("VcTranslate");

// THE ONE PIPELINE (0.2.9, AI only). Every message goes to ✦ (the relay):
// Google's fast ≈ tier and the short-message judge are gone (spec decision 1).
// Null while ✦ is off for this account (rebuildBatcher), and while stopped.
let qualityBatcher: Batcher | null = null;
/** start() ran and stop() has not: what used to be "the fast batcher exists". */
let running = false;
// Watches for a Subline update staged on disk but not yet loaded (updateNotice.ts).
let updateWatch: UpdateWatch | null = null;
/** helperKick.ts: first ask a minute after start, then every 5 minutes while Discord is open. */
const ASK_FOR_UPDATE_FIRST_MS = 60_000;
const ASK_FOR_UPDATE_EVERY_MS = 5 * 60_000;
let updateAskStart: ReturnType<typeof setTimeout> | null = null;
let updateAskTimer: ReturnType<typeof setInterval> | null = null;
/** Did Subline's patches apply in this Discord? Checked once per session (patchHealth.ts). */
let patchHealthWatch: PatchHealthWatch | null = null;
/** Stops listening for the browser add-on being updated under this page (transport.ts). */
let unsubscribeAddonGone: (() => void) | null = null;

/**
 * Wire the patch health check to the running Discord and Vencord. Everything
 * it touches is read defensively: a missing global is "nothing to check",
 * never an error. Sends through the transport, like every relay call.
 */
function startPatchHealth(): void {
    patchHealthWatch?.stop();
    patchHealthWatch = createPatchHealthWatch({
        run: messagesSeen => runPatchHealthCheck({
            now: () => Date.now(),
            pluginVersion: PLUGIN_VERSION,
            buildId: BUILD_ID,
            channel: () => (globalThis as any).GLOBAL_ENV?.RELEASE_CHANNEL,
            buildNumber: () => buildNumberFromVencord((globalThis as any).Vencord),
            load: () => DataStore.get(HEALTH_STORE_KEY),
            save: value => DataStore.set(HEALTH_STORE_KEY, value),
            scan: seen => scanFromVencord((globalThis as any).Vencord, seen),
            send: async report => transport.relayPatchHealth(tasteBearer(await installIdOnce()), JSON.stringify(report)),
            log: (message, detail) => logger.warn(message, detail)
        }, messagesSeen),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
    });
    patchHealthWatch.start();
}
/** Crash-guard catches, reported to the relay by handler name (guardHealth.ts). */
let guardHealth: GuardHealth | null = null;

/**
 * Wire the crash guards (surfaces/guard.tsx) to the relay report. The error
 * itself is logged here only; the report carries the handler name.
 */
function startGuardHealth(): void {
    guardHealth?.stop();
    guardHealth = createGuardHealth({
        now: () => Date.now(),
        pluginVersion: PLUGIN_VERSION,
        buildId: BUILD_ID,
        channel: () => (globalThis as any).GLOBAL_ENV?.RELEASE_CHANNEL,
        buildNumber: () => buildNumberFromVencord((globalThis as any).Vencord),
        load: () => DataStore.get(GUARD_STORE_KEY),
        save: value => DataStore.set(GUARD_STORE_KEY, value),
        send: async report => transport.relayPatchHealth(tasteBearer(await installIdOnce()), JSON.stringify(report)),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        log: (message, detail) => logger.warn(message, detail)
    });
    const watch = guardHealth;
    setGuardCatchSink((handler, error) => {
        logger.warn(`Crash guard: ${handler} threw; Discord's own is shown.`, String((error as any)?.message ?? error).slice(0, 300));
        watch.note(handler);
    });
    guardHealth.start();
    // Caught before start (a parser Discord loaded first): reported too.
    for (const handler of new Set(guardCatchesSoFar())) watch.note(handler);
}

/**
 * Quality translations already produced this session, keyed by exact source
 * text and target language.
 *
 * TWO PROBLEMS, ONE MAP. A Persian greeting arrived twice in one conversation
 * and came back as "how are you guys?" once and "hello kids" the other time —
 * two answers to one question, in a chat where both were on screen together.
 * And the second answer cost a request the first had already paid for.
 *
 * Only real ✦ lines go in, never a skip or a marker.
 *
 * Keyed on the EXACT string, so it can only ever fire on a genuine repeat.
 *
 * P7 (field test 2026-10-08): ONLY for lines that carry their own meaning.
 * The same short words in a different conversation often need a different
 * reading ("ok" as agreement, as surprise, as sarcasm; a reply that answers a
 * different message), and reusing the old answer there is a wrong
 * translation shown as ✦. So a line is reused only when it has at least
 * PHRASE_REUSE_MIN_WORDS words AND is not a reply (see phraseReusable). A
 * short line simply goes to the model with its own context, like any other
 * message: that costs a request, never a wrong line. A language written
 * without spaces counts as one word, so it is never reused: the safe side.
 */
const qualityPhrases = new Map<string, StoredTranslation>();

/** P7: a line shorter than this many words is read in context every time. */
export const PHRASE_REUSE_MIN_WORDS = 6;

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/** May this message take a cached quality phrase? See qualityPhrases (P7). */
function phraseReusable(pending: { text: string; replyToId?: string }): boolean {
    return pending.replyToId === undefined && wordCount(pending.text) >= PHRASE_REUSE_MIN_WORDS;
}

/** Bounded: a long session in a busy server must not grow this without limit. */
const MAX_CACHED_PHRASES = 500;

function phraseKey(text: string, targetLang: string): string {
    return `${targetLang}\u0000${text.trim()}`;
}

function rememberPhrase(text: string, targetLang: string, value: StoredTranslation): void {
    if (!isRealTranslation(value)) return;
    if (rankOf(value.via) < 1) return;   // quality tier only
    // P7: a short line is never reused, so it is not worth keeping either.
    if (wordCount(text) < PHRASE_REUSE_MIN_WORDS) return;
    if (qualityPhrases.size >= MAX_CACHED_PHRASES) {
        // Oldest first — Map preserves insertion order, and a chat's repeats
        // cluster in time, so the recent end is the useful end.
        const oldest = qualityPhrases.keys().next();
        if (!oldest.done) qualityPhrases.delete(oldest.value);
    }
    qualityPhrases.set(phraseKey(text, targetLang), value);
}
let announcedCooldown = false;     // one toast per session, never per batch

// Ids currently queued in the batcher or awaiting a translateBatch response.
// getTranslation() alone can't tell "in flight" apart from "never
// requested" -- a message is a cache miss for the WHOLE round trip (the
// debounce window, up to 3s, plus several seconds of network), not just
// briefly. Populated wherever a message is handed to batcher.add(), and
// drained in runTier once that request settles (success, failure, or
// stranded by a rebuild) so it becomes retryable again.
const inFlightQuality = new Set<string>();

/**
 * ✦ message requests really out right now: past the rate gate, waiting on
 * the network. Surfaces wait for these (MESSAGES FIRST, translateSurfaceBatch),
 * not for `inFlightQuality`: that set also holds every message still in the
 * batcher's 3 s window, so in a busy channel it is almost never empty, and
 * with no ≈ underneath the surfaces then got no translation at all.
 */
let qualityRequestsOut = 0;

/**
 * Ids currently out on the MANUAL ⚡ force-quality path, purely so
 * `TranslationAccessory` can show a `⚡ translating…` hint while one is
 * outstanding. Deliberately NOT the same thing as `inFlightQuality` above:
 * that set also covers the automatic batches (live chat, catch-up), and
 * this indicator is scoped to the manual click only.
 *
 * Deliberately NOT written into the translation store either. store.ts's
 * `StoredTranslation` union is four RESOLVED states that catch-up's
 * cache-hit check depends on; a `{ translating: true }` entry would be a
 * fifth, transient one that persistence, the upgrade rule and every reader
 * of that union would have to be taught to ignore. This is UI-only, ephemeral
 * state, so it gets its own set and its own listeners — mirroring store.ts's
 * subscribe()/notify shape (a Set of no-arg callbacks, notified after every
 * mutation) rather than reusing the store's own subscribe(), which is exactly
 * what would put this inside the union it is being kept out of.
 */
const forcedInFlight = new Set<string>();
const forcedInFlightListeners = new Set<() => void>();

/**
 * ⚡ pressed while an AUTOMATIC request for the same message was already out
 * (see forceQualityTranslate). Released in runTier's finally once that
 * request settles: forced then, unless it brought a line (decision 3: ⚡
 * always gives a translation, and an automatic answer may be a skip).
 */
const forceAfterFlight = new Map<string, Message>();

/** The automatic request for these ids settled: run each waiting ⚡ press, unless a line came. */
function releaseForcedAfterFlight(ids: readonly string[]): void {
    for (const id of ids) {
        const message = forceAfterFlight.get(id);
        if (message === undefined) continue;
        forceAfterFlight.delete(id);
        forcedInFlight.delete(id);
        if (isRealTranslation(getTranslation(makeKey(id, settings.store.targetLang)))) {
            notifyForcedInFlight();
            continue;
        }
        void forceQualityTranslate(message);
    }
}

/**
 * Channels that currently hold deferred (⏳) messages: ✦ requests that never
 * reached a verdict (no answer, a 5xx, a rate limit, the relay cooling down,
 * the hidden daily ceiling). With ✦ the only engine, such a message must
 * never sit blank for good with no sign (0.2.9): it wears the quiet ⏳ line
 * and is asked again.
 *
 * Two ways back. The first ✦ flush that SUCCEEDS in a marked channel proves
 * the relay is answering again and re-runs catch-up for that channel, which
 * re-enqueues everything still deferred. And a timer per channel asks again
 * by itself (armDeferredRetry), because in a quiet DM no later success may
 * ever come. Partial recoveries converge: each sweep translates some and
 * re-defers the rest; a full failure writes no success, triggers no sweep,
 * and the cooldown and the growing delay brake the loop.
 *
 * KEPT PER MESSAGE, not per channel: catch-up takes the newest
 * `catchUpCount` (20) messages that still need ✦ per pass, so a busy channel
 * with 45 messages waiting needs three passes. The channel stays marked, and
 * every success in it sweeps again, until no message in it still waits.
 * Bounded per channel, oldest first out.
 */
const deferredChannels = new Map<string, Set<string>>();
const MAX_WAITING_PER_CHANNEL = 500;

/** These messages have no verdict yet and are asked again by themselves (see deferredChannels). */
function noteWaiting(channelId: string, ids: readonly string[]): void {
    let set = deferredChannels.get(channelId);
    if (set === undefined) {
        set = new Set();
        deferredChannels.set(channelId, set);
    }
    for (const id of ids) {
        set.delete(id);
        set.add(id);
    }
    while (set.size > MAX_WAITING_PER_CHANNEL) set.delete(set.values().next().value as string);
}

/**
 * Does any message in this channel still wait for ✦? A message that got its
 * verdict meanwhile (a line, a skip, the quiet ⚠), or whose entry the store
 * no longer holds as waiting, is dropped from the channel's list here.
 */
function stillWaiting(channelId: string): boolean {
    const set = deferredChannels.get(channelId);
    if (set === undefined) return false;
    const lang = settings.store.targetLang;
    for (const id of [...set]) {
        const e = getTranslation(makeKey(id, lang));
        if (e !== undefined && !("deferred" in e)) set.delete(id);
    }
    if (set.size === 0) deferredChannels.delete(channelId);
    return set.size > 0;
}

/**
 * A timed retry for each channel holding ⏳ lines. The timer asks again after
 * 15s (or just after the relay's cooldown ends, if later: a 429's wait, or
 * UTC midnight for the hidden ceiling), doubling up to 2 minutes while it
 * keeps failing. A successful sweep resets it. Relay down for an hour costs
 * about 30 requests per channel on screen, never a storm.
 */
const deferredRetries = new Map<string, { timer: ReturnType<typeof setTimeout> | null; nextDelayMs: number; }>();
export const DEFERRED_RETRY_FIRST_MS = 15_000;
export const DEFERRED_RETRY_MAX_MS = 120_000;

function armDeferredRetry(channelId: string): void {
    const state = deferredRetries.get(channelId) ?? { timer: null, nextDelayMs: DEFERRED_RETRY_FIRST_MS };
    deferredRetries.set(channelId, state);
    if (state.timer !== null) return;
    const cooling = relayWaitUntil() - Date.now();
    // Just after the cooldown (or a hold) when there is one: asking inside it is refused
    // untried. A little jitter keeps several channels from asking at once.
    const delay = Math.max(cooling > 0 ? cooling + 500 + Math.floor(Math.random() * 1_000) : 0, state.nextDelayMs);
    state.timer = setTimeout(() => {
        state.timer = null;
        state.nextDelayMs = Math.min(state.nextDelayMs * 2, DEFERRED_RETRY_MAX_MS);
        if (!stillWaiting(channelId)) {
            deferredRetries.delete(channelId);
            return;
        }
        // catchUp itself ignores a channel that is not on screen; opening it
        // runs catch-up anyway.
        catchUp(channelId);
    }, delay);
}

function clearDeferredRetry(channelId: string): void {
    const state = deferredRetries.get(channelId);
    if (state?.timer) clearTimeout(state.timer);
    deferredRetries.delete(channelId);
}

/**
 * ✦ turned off (a period ended, a plan lapsed): nothing will ask again by
 * itself, so no ⏳ may still say "translating…". Every ⏳ line goes (the
 * message shows nothing, as any message does with ✦ off), and the waiting
 * lists and their retry timers with them. ✦ on again: catch-up asks for
 * whatever is on screen, as for a message never asked.
 */
function dropAllWaiting(): void {
    const lang = settings.store.targetLang;
    for (const ids of deferredChannels.values()) for (const id of ids) dropDeferred(makeKey(id, lang));
    deferredChannels.clear();
    for (const state of deferredRetries.values()) if (state.timer) clearTimeout(state.timer);
    deferredRetries.clear();
}

function notifyForcedInFlight(): void {
    for (const fn of forcedInFlightListeners) fn();
}

/** Mirrors store.ts's subscribe(): add a listener, get back its unsubscribe. */
function subscribeForcedInFlight(fn: () => void): () => void {
    forcedInFlightListeners.add(fn);
    return () => forcedInFlightListeners.delete(fn);
}

/** Whether THIS message has a manual ⚡ request outstanding right now. */
function isForcedInFlight(messageId: string): boolean {
    return forcedInFlight.has(messageId);
}

/**
 * Why the manual ⚡ click gets a self-reported failure hint and the batched
 * pipeline does not. An AUTOMATIC batch that fails stays quiet: the message
 * wears the ⏳ line and is asked again by itself (see deferredChannels), and
 * nothing the reader did caused it. A manual click is different — the user spent a scarce request on purpose,
 * and "translating…" flashing then vanishing into silence reads as a bug,
 * not as nothing having happened.
 *
 * Three kinds because the remedy differs: `cooldown` and `gate` both mean
 * the request never left the client at all (wait a moment and try again);
 * `failed` means it went out and the engine itself rejected or failed it
 * (something is actually wrong). `code` is only ever a `BeaconErrorCode` — a
 * closed set of categories, the same ones the beacon already uses — never
 * the engine's own error text, which can echo back translated message
 * content and must never reach the DOM.
 */
type ForcedHint =
    | { kind: "cooldown" }
    | { kind: "gate" }
    | { kind: "failed"; code: BeaconErrorCode }
    // A ✦ preview that did not come back. Nothing was charged; the button
    // is offered again.
    | { kind: "preview" };

// How long a failure hint stays on screen before it clears itself. Long
// enough to read, short enough that it cannot be mistaken for a permanent
// marker — and it never becomes one: nothing here is ever written through
// setTranslation/writeResult, so it cannot outlive this module's memory.
// Exported so tests can advance exactly this long rather than hardcoding a
// duplicate of the constant.
export const FORCED_HINT_TTL_MS = 5_000;

/** Shown for a few seconds when a ✦ preview did not load. */
export const PREVIEW_FAILED_HINT = "The AI translation didn't load. Press ⚡ to try again.";

const forcedHints = new Map<string, ForcedHint>();
const forcedHintTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Records (and self-expires) the hint for one message's most recent manual
 * click. Replaces rather than stacks: a second click's outcome always wins
 * over whatever the first left behind. Notifies over the SAME channel
 * `forcedInFlight` uses (see its own doc for why this reuses rather than
 * duplicates that pub/sub) — one subscription in TranslationAccessory
 * already covers both.
 */
function setForcedHint(messageId: string, hint: ForcedHint): void {
    const existingTimer = forcedHintTimers.get(messageId);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    forcedHints.set(messageId, hint);
    forcedHintTimers.set(messageId, setTimeout(() => {
        forcedHintTimers.delete(messageId);
        forcedHints.delete(messageId);
        notifyForcedInFlight();
    }, FORCED_HINT_TTL_MS));
    notifyForcedInFlight();
}

/**
 * Called at the START of every fresh manual click, so a hint left over from
 * an EARLIER click on this same message cannot linger alongside — or
 * outlive — this one.
 */
function clearForcedHint(messageId: string): void {
    const existingTimer = forcedHintTimers.get(messageId);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    forcedHintTimers.delete(messageId);
    forcedHints.delete(messageId);
}

/** What TranslationAccessory shows for THIS message's manual ⚡ hint, if anything. */
function forcedHintFor(messageId: string): ForcedHint | undefined {
    return forcedHints.get(messageId);
}

/**
 * Store keys ✦ has already SPENT A REQUEST on this session.
 *
 * THE BUG THIS EXISTS FOR: catch-up runs on every channel open and every
 * scroll-up (LOAD_MESSAGES_SUCCESS), and a message whose request went out but
 * produced no line (the model omitted it from a 25-message batch, which the
 * relay marks `failed` per id) looks exactly like one never asked about.
 * Without a record of the attempt, every later catch-up offers it again:
 * four channel opens were once four requests for one message.
 *
 * THE RULE: ✦ gets one request per message per session that REACHES A
 * VERDICT. The ledger is written at the moment the request is actually sent
 * (runTier), because the thing being bounded is requests spent. It is given
 * back (the message may be asked again) whenever nothing was judged:
 *  - the whole request failed without a verdict (no answer, a 5xx, a 429,
 *    the hidden ceiling, a refusal about the plan): ⏳, and asked again;
 *  - the model omitted the message the FIRST time (omittedOnce): ⏳, and
 *    asked again once. Omitted a second time, it keeps its charge and shows
 *    the quiet ⚠ line; ⚡, an edit or a restart asks again.
 * A success needs no ledger entry to stop repeating (its store write closes
 * the message), but marking it anyway keeps the invariant short.
 *
 * In memory only, and deliberately not persisted: the store entry it
 * qualifies is what persists, and a new session is a natural retry boundary.
 */
const qualityAttempted = new Set<string>();

/**
 * Store keys the model omitted once already this session (see
 * qualityAttempted). Bounded like the ledger, and forgotten with it on an
 * edit (forgetQualityAttempts).
 */
const omittedOnce = new Set<string>();

/**
 * The channel whose NEXT `LOAD_MESSAGES_SUCCESS` is still the initial backlog
 * landing rather than scroll-back. Armed by every entry point that means "the
 * user just opened this channel" (CHANNEL_SELECT, and start() for whatever is
 * already on screen); consumed by the first history load that follows.
 *
 * WHAT IT DECIDES NOW (changed 2026-09-20): only whether a load's messages are
 * recorded as quality-tier CONTEXT. Until then it also decided whether they
 * got ✦ at all — scroll-back was fast-tier only, because against a personal
 * Gemini free-tier key (20 requests per rolling minute) a long scroll handed
 * the LLM an unbounded stream of never-seen messages. With the relay the
 * request ceiling is enforced server-side (per-code rate limit, daily message
 * cap) and by the client's rate gate, so what the reader scrolls to read gets
 * the ✦ line like anything else they read.
 *
 * Context is the part that still matters: the ring is 8 slots and is a window
 * on the conversation being READ. A load of 20 messages from an hour ago would
 * evict exactly the recent lines that make the next live batch worth its
 * request, so scroll-back is translated but not remembered as context.
 *
 * Holds at most one channel: only one channel is ever focused, and catch-up is
 * focus-gated, so a token for anything else could never be redeemed anyway.
 * Clearing on each arm is what keeps it that way rather than accumulating one
 * dead entry per channel visited this session.
 */
const initialHistoryPending = new Set<string>();

/**
 * "The user just opened this channel; the history that lands next is its
 * opening backlog, not scroll-back." See `initialHistoryPending`.
 */
function armInitialHistory(channelId: string): void {
    // Only one channel can be focused, so only one token can ever be redeemed.
    initialHistoryPending.clear();
    initialHistoryPending.add(channelId);
}

/**
 * True at most ONCE per channel open — the first history load after it was
 * armed. `CHANNEL_SELECT` fires before Discord has necessarily fetched a cold
 * channel's backlog, so that first load IS the channel-open catch-up (the "tab
 * back in after a game" case); every load after it is the user scrolling.
 */
function takeInitialHistory(channelId: string): boolean {
    return initialHistoryPending.delete(channelId);
}

/**
 * Same order of magnitude as the store's own 500-entry LRU, and for the same
 * reason: an id evicted from here is one the translation cache has almost
 * certainly forgotten too, so it reads as "never requested" on both sides at
 * once rather than as a half-remembered message that can never be upgraded.
 */
const QUALITY_ATTEMPT_MEMORY = 500;

function markQualityAttempted(key: string): void {
    // Re-insert to refresh recency, exactly as store.ts's LRU does.
    qualityAttempted.delete(key);
    qualityAttempted.add(key);
    while (qualityAttempted.size > QUALITY_ATTEMPT_MEMORY) {
        qualityAttempted.delete(qualityAttempted.values().next().value as string);
    }
}

/** The model left this message out of its answer once already (see qualityAttempted). */
function noteOmitted(key: string): boolean {
    if (omittedOnce.has(key)) return false;
    omittedOnce.add(key);
    while (omittedOnce.size > QUALITY_ATTEMPT_MEMORY) {
        omittedOnce.delete(omittedOnce.values().next().value as string);
    }
    return true;
}

/**
 * Forget every attempt recorded for a message id, across target languages.
 *
 * Called next to invalidateMessage() — an edited message is a DIFFERENT text,
 * so the request already spent was spent on something that no longer exists.
 * Same `"<id> "` prefix discipline as invalidateMessage(), so message 7 does
 * not match message 70.
 */
function forgetQualityAttempts(messageId: string): void {
    const prefix = `${messageId} `;
    for (const key of [...qualityAttempted]) {
        if (key.startsWith(prefix)) qualityAttempted.delete(key);
    }
    for (const key of [...omittedOnce]) {
        if (key.startsWith(prefix)) omittedOnce.delete(key);
    }
}

// Bumped on every rebuildBatcher(). Each onFlush closure captures the
// generation it was created under; if a response lands after a later
// rebuild has already happened (the plan or the reading language changed
// mid-flight), writing it would land under a key nobody reads, or for a plan
// that no longer translates.
let batcherGeneration = 0;

/** The one engine (0.2.9, AI only): Subline's relay, ✦. */
const ENGINE: EngineId = "relay";

/* ------------------------------------------------------- entitlement -- */

/**
 * Anything paid for: Automatic or AI (see entitlement.ts). There is no free
 * tier: an install with nothing translates nothing and shows the activation
 * notice instead.
 */
function activated(): boolean {
    return entitlementLevel() !== "none";
}

/**
 * ✦ is on for this account now: the relay's `ai` (0.2.9: a running or not
 * yet started period, a subscription, a buyer). Then every message and every
 * surface goes to the relay by itself. Off, nothing translates by itself; an
 * install with ⚡ left (isAutomaticOnly) asks for one message at a time.
 */
function aiOn(): boolean {
    return entitlementLevel() === "ai";
}

/**
 * ✦ is off, and ⚡ gives one of the day's five ✦ translations (previewPress):
 * an Automatic code whose ✦ is not on (a period that ended, an early user's
 * Automatic). Nothing is translated by itself.
 */
function isAutomaticOnly(): boolean {
    return entitlementLevel() === "automatic";
}

/** The saved Subline code, trimmed, or "". */
function savedCode(): string {
    const raw = settings.store.sublineCode;
    return typeof raw === "string" ? raw.trim() : "";
}

/**
 * What every relay request carries: the saved code when there is one, else
 * the install bearer, plus the install bearer on its own (x-subline-install).
 */
async function relayCredentials(): Promise<{ credential: string; install: string; }> {
    const install = tasteBearer(await installIdOnce());
    const code = savedCode();
    return { credential: code !== "" ? code : install, install };
}

/**
 * relayCredentials without the wait: the install id this account has now,
 * or null (then no funnel step goes out). For events.ts only.
 */
function eventCredentials(): { credential: string; install: string; } | null {
    const id = knownInstallId();
    if (id === null || id === "") return null;
    const install = tasteBearer(id);
    const code = savedCode();
    return { credential: code !== "" ? code : install, install };
}

/* ---------------------------------------------------- Discord account -- */

/**
 * WHICH DISCORD ACCOUNT IS SIGNED IN (0.2.8). A plan belongs to one Discord
 * account, so Subline follows the signed-in one: the install id account.ts
 * gives it, the stored answer and the saved code that go with that id. Until
 * a confirmed link binds the install id from before (the installer's), every
 * account on this computer shares it, so a plan from before 0.2.8 keeps
 * working whoever signs in first; after it, each other account has its own.
 * Until an account is known, nothing asks the relay (installIdOnce waits)
 * and nothing is owned.
 *
 * Resolved at start() when Discord already knows the user, and again on
 * every CONNECTION_OPEN (Discord's start, a reconnect, and an account switch:
 * a switch is a new connection). Switches run one after another.
 */
let currentAccount: string | null = null;
/** The current account uses the install id from before (account.ts rule 1, or it is the bound account). */
let currentLegacy = false;
/** ...and a binding here is known to say it is this account's (account.ts rules 2 and 3). */
let legacyOwned = false;
/** The accounts that linked on this computer: local names and whether their plan was live (account.ts). */
let localAccounts: Record<string, LocalAccount> = {};
let accountQueue: Promise<void> = Promise.resolve();
/** Bumped by every switch and by stop(): work for an older account changes nothing. */
let accountEpoch = 0;
/** True while the code fields are swapped for a switch (see the settings handler). */
let swappingCodeFields = false;
/** The saved code the settings handler last saw. */
let lastSeenCode = "";

/** The plugin's settings, as the code fields of one slot (account.ts). */
const CODE_FIELDS: CodeFieldStore = {
    read: (): CodeFields => ({
        code: typeof settings.store.sublineCode === "string" ? settings.store.sublineCode : "",
        cleared: typeof settings.store.clearedPurchaseCode === "string" ? settings.store.clearedPurchaseCode : "",
        deadSeen: deadCodeSeen()
    }),
    write: fields => {
        settings.store.clearedPurchaseCode = fields.cleared;
        settings.store.deadCodeSeen = fields.deadSeen;
        settings.store.sublineCode = fields.code;
    },
    holder: () => typeof settings.store.codeAccount === "string" ? settings.store.codeAccount : "",
    setHolder: account => { settings.store.codeAccount = account; },
    stash: () => {
        const raw = settings.store.accountCodes as unknown;
        const out: Record<string, CodeFields> = {};
        if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) out[k] = parseCodeFields(v);
        return out;
    },
    setStash: stash => { settings.store.accountCodes = stash; }
};

/** The signed-in Discord user's id, or null while Discord does not know it yet. */
function signedInUserId(): string | null {
    try {
        const id = UserStore.getCurrentUser()?.id;
        return typeof id === "string" && id !== "" ? id : null;
    } catch {
        return null;
    }
}

/**
 * The signed-in account, when it is the one Subline follows now: its id
 * (sent as `expect` with a link, compared by the relay, never stored) and
 * what a window shows of it (name, avatar; local, never sent). Null while
 * Discord does not know the user, or a switch has not reached Subline yet:
 * nothing can be named then, so nothing binds.
 */
function signedInAccount(): { id: string; view: AccountView; } | null {
    try {
        const user = UserStore.getCurrentUser() as { id?: unknown; username?: unknown; getAvatarURL?: (guildId?: string, size?: number) => unknown; } | undefined;
        const id = typeof user?.id === "string" ? user.id : "";
        if (id === "" || currentAccount === null || accountKeyFor(id) !== currentAccount) return null;
        const name = typeof user?.username === "string" && user.username !== "" ? user.username : "";
        if (name === "") return null;
        let avatarUrl: string | undefined;
        try {
            const url = user?.getAvatarURL?.(undefined, 80);
            if (typeof url === "string") avatarUrl = url;
        } catch { /* no avatar, the name is enough */ }
        return { id, view: { name, ...(avatarUrl !== undefined ? { avatarUrl } : {}) } };
    } catch {
        return null;
    }
}

/** CONNECTION_OPEN: Discord connected, possibly as another account. */
function onConnectionOpen(payload: any): void {
    const fromPayload = payload?.user?.id;
    const id = typeof fromPayload === "string" && fromPayload !== "" ? fromPayload : signedInUserId();
    if (id !== null) void followAccount(id);
}

/** Make the account with this Discord user id the current one (queued). */
function followAccount(userId: string): Promise<void> {
    const account = accountKeyFor(userId);
    accountQueue = accountQueue
        .then(() => enterAccount(account))
        .catch(err => logger.warn("Couldn't switch Subline to the signed-in Discord account.", err));
    return accountQueue;
}

/**
 * Leave whatever belonged to the previous account: its status answers in
 * flight, its retries, its checkout, its notices, its install id.
 */
function leaveAccount(): void {
    statusSession++;
    clearStatusRetry();
    checkoutFlow?.stop();
    checkoutFlow = null;
    setPaymentPending(false);
    if (deadRecheckTimer !== null) clearTimeout(deadRecheckTimer);
    deadRecheckTimer = null;
    deviceLimited = false;
    announcedPurchase = "";
    earlyGrantPending = false;
    autoDroppedCode = "";
    renewalFollowUp = null;
    askedForExpiry = null;
    afterLink = null;
    confirmedFor = null;
    takeNotice("activation");
    takeNotice("link");
    // Its 🌐 and settings sync: the next account starts its own once the relay says it is linked.
    endChannelSync();
    endPrefSync();
    takeDownCheckingNotice();
    forgetInstallId();
    currentAccount = null;
    currentLegacy = false;
    legacyOwned = false;
}

/**
 * Enter the current account again, for a fresh look at which install id it
 * uses: the install id from before turned out to be another account's
 * (account.ts rule 3). Queued like a switch; nothing when the account changed
 * meanwhile (the switch did it).
 */
function refollowAccount(account: string): void {
    accountQueue = accountQueue
        .then(() => currentAccount === account ? enterAccount(account, true) : undefined)
        .catch(err => logger.warn("Couldn't give this Discord account an install id of its own.", err));
}

async function enterAccount(account: string, again = false): Promise<void> {
    if (account === currentAccount && !again) return;
    const epoch = ++accountEpoch;
    leaveAccount();
    // Its own 🌐 lists (channels.ts): the lists of the account before are
    // off from this moment, and these are loaded before anything translates.
    const lists = channelAccount() === account ? null : useChannelAccount(account);
    // Its own Subline settings (prefs.ts), written into Settings at once.
    const prefs = prefAccount() === account ? null : usePrefAccount(account);
    const { installId, legacy, accounts } = await installForAccount(account);
    if (epoch !== accountEpoch) return;
    if (lists !== null) await lists;
    if (prefs !== null) await prefs;
    if (epoch !== accountEpoch) return;
    // The saved code is this install's from here on. The settings handler
    // ignores the writes: this is not the reader clearing their code.
    swappingCodeFields = true;
    try {
        swapCodeFields(CODE_FIELDS, codeSlotFor(account, legacy));
    } finally {
        swappingCodeFields = false;
    }
    lastSeenCode = savedCode();
    normaliseEngineSetting();
    setTasteScope(legacy ? "" : account);
    setEntitlementKey(legacy ? ENTITLEMENT_KEY : `${ENTITLEMENT_KEY}:${account}`);
    currentAccount = account;
    currentLegacy = legacy;
    localAccounts = accounts;
    useInstallId(installId);
    setCurrentHolder(holderFor(savedCode(), installId));
    await loadEntitlement();
    await loadLocalTasteCount();
    // What this account was already shown about its plan, on this computer.
    await loadPlanNotes(legacy ? PLAN_NOTES_KEY : `${PLAN_NOTES_KEY}:${account}`);
    if (epoch !== accountEpoch) return;
    tasteLog(`following the signed-in Discord account (${legacy ? "the install id from before" : "its own install id"})`);
    lastTickLevel = entitlementLevel();
    if (running) rebuildBatcher();
    onEntitlementChanged();
    void refreshEntitlement();
    // A move started on another account waits for this one (Move my plan).
    void offerMoveHere();
}

/**
 * What this computer remembers about the current account once it is linked:
 * its name (for "Your Subline plan is on @name" on another account) and
 * whether its plan is live. Written only when it changed (account.ts).
 */
function rememberCurrentAccount(): void {
    const account = currentAccount;
    const me = signedInAccount();
    if (account === null || me === null || linkState() !== "linked") return;
    void noteLocalAccount(account, { name: me.view.name, plan: activated() }).then(accounts => {
        if (accounts !== null && account === currentAccount) localAccounts = accounts;
    });
}

/**
 * The 🌐 choices follow the Discord account (channelSync.ts): linked, the
 * current account's lists are kept in step with the relay's copy; anything
 * else, they stay on this computer, exactly as before. Called with every
 * status answer; a session already running for the account goes on.
 */
function followChannelChoices(): void {
    const account = currentAccount;
    if (account === null || linkState() !== "linked") {
        endChannelSync();
        return;
    }
    beginChannelSync(account, {
        call: async json => {
            try {
                const { credential, install } = await relayCredentials();
                // Signed in as someone else meanwhile: never this account's call.
                if (currentAccount !== account) return { ok: false, error: "network" };
                return await transport.relayChannels(credential, install, json);
            } catch {
                return { ok: false, error: "network" };
            }
        },
        candidates: () => {
            const out: string[] = [];
            try {
                const open = SelectedChannelStore.getChannelId();
                if (typeof open === "string") out.push(open);
            } catch { /* the lists alone */ }
            try {
                const dms = (ChannelStore as { getSortedPrivateChannels?: () => unknown; }).getSortedPrivateChannels?.();
                if (Array.isArray(dms)) for (const c of dms) if (typeof c?.id === "string") out.push(c.id);
            } catch { /* the lists alone */ }
            return out;
        },
        applied: ids => {
            // The open channel switched on elsewhere: what is on screen is translated now.
            let open: string | null = null;
            try { open = SelectedChannelStore.getChannelId() ?? null; } catch { /* nothing open */ }
            if (open !== null && ids.includes(open) && channelActive(open)) catchUp(open);
        },
        log: tasteLog
    });
}

/**
 * Subline's settings follow the Discord account (prefSync.ts), like the 🌐
 * choices: linked, the current account's settings are kept in step with the
 * relay's copy; anything else, they stay on this computer, exactly as
 * before. Called with every status answer; a session already running for
 * the account goes on.
 */
function followPrefs(): void {
    const account = currentAccount;
    if (account === null || linkState() !== "linked") {
        endPrefSync();
        return;
    }
    beginPrefSync(account, {
        call: async json => {
            try {
                const { credential, install } = await relayCredentials();
                // Signed in as someone else meanwhile: never this account's call.
                if (currentAccount !== account) return { ok: false, error: "network" };
                return await transport.relayPrefs(credential, install, json);
            } catch {
                return { ok: false, error: "network" };
            }
        },
        // Written into Settings already: its own change hook did the rest.
        applied: keys => tasteLog(`settings from another computer: ${keys.join(", ")}`),
        log: tasteLog
    });
}

/* ------------------------------------------------------------- linking -- */

/**
 * NEVER A SILENT OUTCOME. Say what a Link, Buy, Add AI, code or Move came
 * to. A toast is drawn UNDER Subline's Settings, so while Settings is on
 * screen (upgradeBridge settingsShowing) the sentence opens a window, which
 * is always on top. Elsewhere it stays a short toast, as before: no extra
 * window on the main screen. A window that cannot open falls back to the
 * toast, never to nothing.
 */
function sayResult(text: string, kind: ToastKind = "failure"): void {
    if (settingsShowing() && openMessage(LINK_COPY.resultTitle, text)) return;
    toast(text, kind);
}

/**
 * The relay said this account is not linked to a Discord account (API 3) and
 * this computer has no plan from before: nothing translates, and the one
 * thing to do is Link. A prior payer (mustLink) is not this: its plan works,
 * and its bar only asks (showMustLinkBar).
 */
function linkNeeded(): boolean {
    return entitlementLevel() === "none" && linkState() === "unlinked" && !mustLink();
}

/** The signed-in Discord username, read locally for the "Linked to" line. Never sent. */
function signedInName(): string {
    try {
        const name = UserStore.getCurrentUser()?.username;
        return typeof name === "string" ? name : "";
    } catch {
        return "";
    }
}

let linkBusy = false;

/**
 * EVERY BIND NAMES THE ACCOUNT (0.2.8 spec, decision 2). Before a purchase,
 * a code, or a link that would bind this computer's plan from before, the
 * account confirm names the signed-in account ("This plan will belong to
 * @name"). `then` runs only on "Yes, use @name", inside that click, and only
 * if the same account is still signed in. "Use another account" explains how
 * to switch and stores nothing. A confirm already given in this same flow (a
 * Link that came first, see afterLink) is not asked again.
 */
let confirmedFor: { account: string; until: number; } | null = null;
/** How long a confirm given for a Link covers the purchase or code that the link was for. */
const CONFIRM_CARRIES_MS = 10 * 60_000;

function withAccountConfirm(then: () => void): void {
    const me = signedInAccount();
    if (me === null) {
        sayResult(LINK_COPY.noAccount, "failure");
        return;
    }
    const carried = confirmedFor;
    confirmedFor = null;
    if (carried !== null && carried.account === currentAccount && Date.now() < carried.until) {
        then();
        return;
    }
    const epoch = accountEpoch;
    const shown = openAccountConfirm(me.view, {
        yes: () => {
            // Signed in as someone else meanwhile: that account never confirmed.
            if (epoch !== accountEpoch) return;
            then();
        }
    });
    if (!shown) {
        // Nothing binds without the confirm.
        logger.error("The account confirm could not be opened.");
        sayResult(LINK_COPY.ownWindowFailed, "failure");
    }
}

/**
 * What a Link started for (Add AI or a code, for a prior payer whose
 * checkout needs a link first): run once the link answers linked, for the
 * same account. The confirm given before the Link covers it (confirmedFor).
 */
let afterLink: { account: string; run: () => void; } | null = null;

/**
 * Link with the account confirm first: for a computer with a plan from
 * before (mustLink), whose link binds that plan to the account. `after`
 * runs once linked (see afterLink).
 */
function startLinkConfirmed(after?: () => void): void {
    withAccountConfirm(() => {
        afterLink = after !== undefined && currentAccount !== null ? { account: currentAccount, run: after } : null;
        startLink();
    });
}

/**
 * This computer may have a plan that a link would bind: the relay said so
 * (mustLink), a purchase started here before 0.2.8 is still on its way
 * (purchaseStartedHere: it lands on whichever account links this install),
 * or a code is saved here while the account is not linked (its plan joins
 * the account the link names). Such a link asks the account confirm first,
 * and is never made silently.
 */
function hasUnlinkedPlan(): boolean {
    return mustLink() || purchaseStartedHere() || (linkState() !== "linked" && savedCode() !== "");
}

/** Link from the Link bar or Settings: the confirm first when it would bind a plan from before. */
function linkFromSettings(): void {
    if (hasUnlinkedPlan()) startLinkConfirmed();
    else startLink();
}

/**
 * The Link bar for a prior payer (0.2.8, mustLink): the plan keeps working,
 * and the bar asks to link it to the account it belongs to. Never a block,
 * and its Link asks which account first. Gone once linked.
 */
function showMustLinkBar(): void {
    if (!mustLink()) {
        takeNotice("link");
        return;
    }
    putNotice("link", LINK_COPY.mustLinkNotice, LINK_COPY.button, () => startLinkConfirmed());
    sendEvent("link_prompt");
}

/**
 * Silent re-link (link.ts silentLinkAttempt): a Discord account that already
 * approved Subline elsewhere links with no window. Tried once per Discord
 * account per session, before the Link bar would first show; a try that
 * gives no code is not repeated this session (the bar and Link by hand
 * remain). `silentRunningFor` is the account whose try is in flight. NEVER
 * for a computer with a plan from before (mustLink): binding that plan needs
 * the account confirm (no takeover). Nor while a purchase started here before
 * 0.2.8 is still on its way (purchaseStartedHere): it would land on this account.
 */
const silentTried = new Set<string>();
let silentRunningFor: string | null = null;

/** Start the silent try for this account if it has not had one. True while it runs (the caller shows no bar yet). */
function startSilentLink(): boolean {
    const key = currentAccount ?? "";
    if (silentRunningFor === key) return true;
    if (silentTried.has(key) || linkBusy || hasUnlinkedPlan()) return false;
    silentTried.add(key);
    silentRunningFor = key;
    const epoch = accountEpoch;
    void (async () => {
        let attempt: Awaited<ReturnType<typeof silentLinkAttempt>>;
        try {
            attempt = await silentLinkAttempt();
        } catch {
            attempt = { code: null, reason: "the check failed" };
        }
        // Signed in as someone else meanwhile (or stopped): not this account's.
        if (epoch !== accountEpoch) {
            if (silentRunningFor === key) silentRunningFor = null;
            return;
        }
        if (attempt.code === null) {
            logger.info(`Not linked by itself (${attempt.reason}). The Link bar shows.`);
            silentRunningFor = null;
            putLinkBarBack();
            return;
        }
        logger.info("This Discord account approved Subline before: linking with no window.");
        await finishLink(attempt.code, true);
    })().catch(err => {
        silentRunningFor = null;
        logger.warn("The silent link stopped.", err);
        putLinkBarBack();
    });
    return true;
}

/**
 * Link: Discord's Authorize window (link.ts). Authorize hands back a code,
 * which goes to the relay (POST /v1/link); its answer is taken in like a
 * status answer. Cancel changes nothing: the bar stays. A window Vencord
 * cannot find, or one that throws, is replaced by Discord's authorize page
 * in the browser (linkFallback.ts), so a Discord update never stops anyone
 * from linking.
 */
function startLink(): void {
    if (linkBusy) return;
    // The window broke once this session: straight to the browser, inside
    // this click (in a browser the fallback's tab can open only here).
    if (authorizeWindowBroken) {
        void runFallback(null, reserveFallbackTab());
        return;
    }
    const opened = openLinkWindow({
        onCode: code => { void finishLink(code); },
        onNoCode: () => sayResult(LINK_COPY.refused, "failure"),
        // Discord takes the bar down when Link is pressed. Any close (Cancel,
        // the X, Escape) puts it back while the account is still not linked.
        // After Authorize the link is still at the relay: finishLink decides.
        onClosed: () => {
            if (linkBusy) return;
            // Closed without a code (Cancel, the X): what the link was for goes too.
            afterLink = null;
            sendEvent("link_cancel");
            putLinkBarBack();
        },
        onCrash: (error, componentStack) => {
            logger.error(`Discord's Authorize window crashed and was closed: ${error instanceof Error ? error.message : String(error)}${componentStack}`, error);
            recordError("link-crash");
            authorizeWindowBroken = true;
            void runFallback(null, reserveFallbackTab());
        }
    });
    if (opened) sendEvent("link_open");
    else {
        // Linking is the way in for everyone: a window that cannot open is
        // logged and recorded for the feedback box, never silent, and the
        // browser takes over.
        logger.error("Discord's Authorize window could not be opened (Vencord did not find it, or opening it failed). Linking in the browser instead.");
        recordError("link-window");
        void runFallback(null, reserveFallbackTab());
    }
}

/**
 * The Link bar again, if this Discord account is still not linked. Forced:
 * the "closed this session" rule never hides the only way in.
 */
function putLinkBarBack(): void {
    if (linkNeeded()) showActivationNotice();
    showMustLinkBar();
}

/** The sentence for a link (or a move) the relay did not complete. */
function linkErrorCopy(res: RelayRefusal | null): string {
    if (res === null) return LINK_COPY.unreachable;
    if (res.errorCode === "bad_code" || res.errorCode === "discord_refused") return LINK_COPY.refused;
    if (res.errorCode === "rate_limited" || res.status === 429) return LINK_COPY.rateLimited;
    if (res.errorCode === "plan_held") return LINK_COPY.planHeld;
    if (res.errorCode === "state_expired") return FALLBACK_COPY.expired;
    return LINK_COPY.unreachable;
}

/**
 * Say why a link (or a move) did not complete. Discord authorizing another
 * account (409 wrong_account) and a plan another computer holds (409
 * plan_held) are said in a window, which is drawn above Subline's Settings
 * where a toast is not; the rest go through sayResult (a window while
 * Settings is on screen, else a short toast).
 */
function sayLinkRefusal(res: RelayRefusal | null): void {
    if (res?.errorCode === "wrong_account") {
        const name = signedInAccount()?.view.name ?? signedInName();
        if (!openMessage(LINK_COPY.notice, fill(ACCOUNT_COPY.wrongAccount, { name }))) toast(fill(ACCOUNT_COPY.wrongAccount, { name }), "failure");
        return;
    }
    if (res?.errorCode === "plan_held") {
        if (!openMessage(LINK_COPY.notice, LINK_COPY.planHeld)) toast(LINK_COPY.planHeld, "failure");
        return;
    }
    sayResult(linkErrorCopy(res), "failure");
}

async function finishLink(code: string, silent = false): Promise<void> {
    if (linkBusy) return;
    const me = signedInAccount();
    if (me === null) {
        // Nothing can be named, so nothing is sent: the relay would bind nobody.
        sayResult(LINK_COPY.noAccount, "failure");
        afterLink = null;
        if (silent) silentRunningFor = null;
        putLinkBarBack();
        return;
    }
    linkBusy = true;
    const epoch = accountEpoch;
    const session = statusSession;
    const account = currentAccount!;
    let sentOn: string | null = null;
    try {
        let res: Awaited<ReturnType<typeof transport.relayLink>> | null;
        let sent = "";
        let install = "";
        try {
            const creds = await relayCredentials();
            install = creds.install;
            if (creds.credential !== creds.install) sent = creds.credential;
            sentOn = await notePendingFor(account, creds.install);
            if (epoch !== accountEpoch || session !== statusSession) return;
            res = await transport.relayLink(creds.credential, creds.install, code, me.id);
        } catch {
            res = null;
        }
        // Signed in as someone else meanwhile (or stopped): this link was not
        // theirs. Linked all the same: the install id from before is the
        // sender's now (account.ts rule 2).
        if (epoch !== accountEpoch || session !== statusSession) {
            if (sentOn !== null && res !== null && res.ok && res.linked === true) await bindAfterLink(account, sentOn);
            return;
        }
        if (res === null || !res.ok || res.linked !== true) {
            logger.warn(`Linking the Discord account did not complete (${res === null ? "no answer" : res.ok ? "not linked" : res.errorCode ?? res.error}).`);
            afterLink = null;
            afterUnansweredLink(account, sentOn, res);
            sayLinkRefusal(res !== null && !res.ok ? res : null);
            return;
        }
        await takeLinkAnswer(res, sent, install, silent);
    } finally {
        linkBusy = false;
        if (silent) silentRunningFor = null;
        // A link that did not complete: the bar back (Discord took it down at the press).
        putLinkBarBack();
    }
}

/**
 * A link (or a move) the relay completed: take its answer like a status
 * answer, bind the install id from before to this account when it was on it
 * (account.ts rule 2), remember the account's name here, and carry on with
 * what the link was for.
 */
async function takeLinkAnswer(
    res: Extract<Awaited<ReturnType<typeof transport.relayLink>>, { ok: true; }>, sent: string, install: string, silent: boolean
): Promise<void> {
    // The Link step counts links the reader pressed for: not a silent re-link
    // (it never showed the bar or the window) and not Move my plan.
    if (!silent && res.moved !== true) sendEvent("link_done");
    const account = currentAccount;
    // A purchase started here before 0.2.8 and still on its way (said before
    // this answer replaces it): it was paid, so no Buy panel is pushed.
    const purchaseOnItsWay = purchaseStartedHere();
    // Linked, but the saved code was left out (it is another Discord
    // account's, or another computer holds its plan): drop it now, as a
    // status 409 would, or Buy would send it and be refused. A code this
    // account moved away itself (Move my plan) goes quietly.
    const refused = res.codeRefused !== undefined && sent !== "" && sent === savedCode() ? res.codeRefused : null;
    if (refused !== null) dropRefusedCode(refused);
    takeStatusAnswer(res, false);
    // The install id from before is this account's from now on; every other
    // account here gets its own. Only for the id this link was sent with.
    const legacyId = knownInstallId();
    if (account !== null && currentLegacy && legacyId !== null && tasteBearer(legacyId) === install) await bindAfterLink(account, legacyId);
    rememberCurrentAccount();
    const name = signedInName();
    if (name !== "" && res.moved !== true) toast(LINK_COPY.linked.replace("{name}", name), "success");
    if (refused !== null && res.codeMoved !== true) sayResult(refused === "code_in_use" ? UPGRADE_COPY.codeInUse : UPGRADE_COPY.codeOnOtherAccount, "failure");
    // What the link was for (Add AI, a code), on this same account.
    const after = afterLink;
    afterLink = null;
    if (after !== null && after.account === currentAccount) {
        confirmedFor = { account: after.account, until: Date.now() + CONFIRM_CARRIES_MS };
        after.run();
        return;
    }
    // Linked, and nothing on the account yet: Buy Automatic or Enter a code.
    // Linked by itself, or with a purchase from before still on its way (it
    // lands with a later status): the Activate notice, never a panel nobody
    // asked for. Its Activate sells nothing twice (relay purchase_pending).
    // The plan could not be read with the link (0.2.9 accessUnknown): the
    // status call that follows decides, never a panel before it.
    if (!activated() && res.moved !== true && res.accessUnknown !== true) {
        if (silent || purchaseOnItsWay) showActivationNotice();
        else openUpgradeForLevel();
    }
}

/**
 * THE PENDING BIND (account.ts rule 3). A link (or a move) sent on the
 * install id from before while no binding here is known to be this
 * account's: the sender is written down first, so an answer that never
 * arrives (a timeout, the network, a switch) still binds the right account
 * when a later status answer says linked. Returns that id, or null.
 */
function unboundLegacyId(): string | null {
    if (!currentLegacy || legacyOwned || currentAccount === null) return null;
    return knownInstallId();
}

async function notePendingFor(account: string, install: string): Promise<string | null> {
    const legacyId = unboundLegacyId();
    if (legacyId === null || tasteBearer(legacyId) !== install) return null;
    if (!(await notePendingBind(account, legacyId))) logger.warn("Could not write down which account this link is for. Sent all the same: a lost answer then binds no account here.");
    return legacyId;
}

/** Refusals the relay gives before it writes anything: that send linked nothing. */
const LINK_WROTE_NOTHING: readonly string[] = ["wrong_account", "plan_held", "bad_code", "bad_expect", "discord_refused", "rate_limited", "state_expired"];

/**
 * A link (or a move) sent on the unbound id from before did not come back
 * linked. A refusal that wrote nothing takes the sender off the pending
 * bind. Anything else may have linked at the relay (no answer, a 503): the
 * relay is asked at once, and an answer that says linked binds the sender.
 */
function afterUnansweredLink(account: string, sentOn: string | null, res: RelayRefusal | { ok: true; } | null): void {
    if (sentOn === null) return;
    if (res !== null && !res.ok && res.errorCode !== undefined && LINK_WROTE_NOTHING.includes(res.errorCode)) {
        void dropPendingBind(account, sentOn);
        return;
    }
    void refreshEntitlement();
}

/**
 * The relay linked the install id from before to `account` (its own
 * confirmed link): bind it (account.ts rule 2). When another account is
 * signed in by now and still on that id, it gets an id of its own.
 */
async function bindAfterLink(account: string, legacyId: string): Promise<void> {
    if (!(await bindLegacyInstall(account, legacyId, { relaySaid: true }))) {
        logger.warn("Linked, but this computer could not record which account the install id from before belongs to. It holds for this session.");
    }
    if (currentAccount === account && currentLegacy) {
        legacyOwned = true;
        return;
    }
    if (currentAccount !== null && currentLegacy && knownInstallId() === legacyId) refollowAccount(currentAccount);
}

/**
 * A status answer says linked while this account uses the install id from
 * before and no binding here is known to be its own. That answer has no
 * account in it, so account.ts settles whose the id is (rule 3). True: this
 * account's, take the answer. False: another account's (or nobody's here),
 * so the answer is not this account's plan; it is left, and the account
 * gets an id of its own.
 */
async function linkedLegacyIsMine(): Promise<boolean> {
    const legacyId = unboundLegacyId();
    const account = currentAccount;
    if (legacyId === null || account === null) return true;
    const epoch = accountEpoch;
    const owner = await settleLegacyLink(legacyId);
    if (epoch !== accountEpoch) return false;
    if (owner === account) {
        legacyOwned = true;
        return true;
    }
    logger.info(owner === NOBODY
        ? "The install id from before was linked, and no single account here sent that link. Every account here gets an id of its own."
        : "The install id from before is another Discord account's on this computer. This account gets an id of its own.");
    refollowAccount(account);
    return false;
}

/* ------------------------------------------- linking in the browser -- */

/** True while the browser fallback waits, so a second press does not start another. */
let fallbackRunning = false;
/**
 * Discord's Authorize window threw this session. Every later Link goes to the
 * browser at once, inside its click: a window that crashes again would only
 * lose the click a browser needs to open a tab.
 */
let authorizeWindowBroken = false;

/**
 * For the release test sheet only (docs/RELEASE-TESTS-0.2.8.md): typed in
 * the console as `sublineUseBrowserLink()` while Subline runs, it makes this
 * session's Link use the Authorize fallback in the browser, as after
 * Discord's Authorize window crashed. Nothing is stored, nothing else
 * changes, and a restart undoes it. Never called by Subline itself. Put on
 * the page at start and taken off at stop.
 */
export const BROWSER_LINK_SWITCH = "sublineUseBrowserLink";
function useBrowserLinkForTest(): void {
    authorizeWindowBroken = true;
}

/**
 * In a browser (the add-on), a tab for Discord's authorize page, opened blank
 * now, inside the click (checkout.ts ReservedTab). Undefined on the desktop,
 * where openExternal always opens.
 */
function reserveFallbackTab(): ReservedTab | null | undefined {
    if (isDesktop()) return undefined;
    return reserveTab((globalThis as any).open?.bind(globalThis));
}

/**
 * THE AUTHORIZE FALLBACK (linkFallback.ts): Discord's authorize page in the
 * browser, polled for up to 5 minutes. `ticket` finishes a move instead of a
 * plain link. The same account check applies (`expect`): a browser signed
 * in to another Discord account changes nothing.
 */
async function runFallback(ticket: string | null, tab: ReservedTab | null | undefined): Promise<void> {
    if (fallbackRunning || linkBusy) {
        tab?.close();
        return;
    }
    const me = signedInAccount();
    if (me === null) {
        tab?.close();
        sayResult(LINK_COPY.noAccount, "failure");
        return;
    }
    fallbackRunning = true;
    linkBusy = true;
    const epoch = accountEpoch;
    const session = statusSession;
    const account = currentAccount!;
    try {
        const creds = await relayCredentials();
        const sent = creds.credential !== creds.install ? creds.credential : "";
        // Written down before the first poll (account.ts rule 3).
        const sentOn = await notePendingFor(account, creds.install);
        if (epoch !== accountEpoch || session !== statusSession) {
            tab?.close();
            return;
        }
        const result = await runBrowserLink({
            poll: (state, pair) => transport.relayLinkPoll(creds.credential, creds.install, state, me.id, pair, ticket ?? undefined),
            open: async url => {
                if (tab === null) return false;
                if (tab !== undefined) {
                    tab.go(url);
                } else {
                    const open = (globalThis as any).VencordNative?.native?.openExternal;
                    if (typeof open !== "function") return false;
                    await Promise.resolve(open(url));
                }
                toast(FALLBACK_COPY.opened, "info");
                // Discord's authorize page is open (in the browser): the same step as the window.
                if (ticket === null) sendEvent("link_open");
                return true;
            },
            askPair: triesLeft => askPairCode(triesLeft),
            alive: () => epoch === accountEpoch && session === statusSession,
            log: tasteLog
        });
        // Signed in as someone else meanwhile (or stopped): nothing is shown
        // to the account signed in now. A link (or move) the relay finished
        // all the same (runBrowserLink hands it back) binds the sender, as in
        // finishLink, and a move's used ticket goes.
        if (epoch !== accountEpoch || session !== statusSession) {
            if (result.kind === "linked") await settleFinishedElsewhere(account, sentOn, ticket);
            return;
        }
        if (result.kind !== "linked") {
            tab?.close();
            afterUnansweredLink(account, sentOn, result.kind === "refused" ? result.answer : null);
        }
        switch (result.kind) {
            case "linked":
                if (ticket !== null) await takeMoveAnswer(result.answer, creds.install);
                else await takeLinkAnswer(result.answer, sent, creds.install, false);
                break;
            case "refused":
                logger.warn(`Linking in the browser did not complete (${result.answer.errorCode ?? result.answer.error}).`);
                afterLink = null;
                if (ticket !== null) sayMoveRefusal(result.answer);
                else sayLinkRefusal(result.answer);
                break;
            case "timeout":
                afterLink = null;
                // The authorize page was left without a link.
                if (ticket === null) sendEvent("link_cancel");
                sayResult(FALLBACK_COPY.timeout, "failure");
                break;
            case "blocked":
                afterLink = null;
                sayResult(isDesktop() ? LINK_COPY.windowFailed : FALLBACK_COPY.blocked, "failure");
                break;
            case "cancelled":
                afterLink = null;
                if (ticket === null) sendEvent("link_cancel");
                break;
        }
    } catch (err) {
        tab?.close();
        logger.warn("Linking in the browser stopped.", err);
        afterLink = null;
    } finally {
        fallbackRunning = false;
        linkBusy = false;
        putLinkBarBack();
    }
}

/* -------------------------------------------------------- move my plan -- */

/**
 * MOVE MY PLAN (0.2.8 spec, decision 5). On the account that holds the plan
 * (a linked computer of it): Settings → "Move my plan to another Discord
 * account" → what a move does → Start (POST /v1/move/start: a one-time
 * ticket, 10 minutes). The reader switches accounts in Discord; on the new
 * account a window names both accounts ("Move to @alt"), and its Authorize
 * finishes the move (POST /v1/move/finish). The ticket is kept in this
 * computer's DataStore with the old account's local key and name, so a
 * switch that reloads Discord still finds it. Nothing moves without both the
 * Start on the old account and the confirm and Authorize on the new one.
 */
export const MOVE_TICKET_KEY = "VcTranslate_moveTicket";
interface MoveTicket { ticket: string; expiresAt: number; from: string; fromName: string; }
const MOVE_TICKET_MS = 10 * 60_000;
let moveTicket: MoveTicket | null = null;
/** The account the move window was last shown to, so a reconnect does not show it twice. */
let moveOfferedTo: string | null = null;

function parseMoveTicket(raw: unknown): MoveTicket | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Partial<MoveTicket>;
    if (typeof o.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.ticket)) return null;
    if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) return null;
    if (typeof o.from !== "string" || typeof o.fromName !== "string" || o.fromName === "") return null;
    return { ticket: o.ticket, expiresAt: o.expiresAt, from: o.from, fromName: o.fromName };
}

async function loadMoveTicket(): Promise<MoveTicket | null> {
    if (moveTicket === null) {
        try {
            moveTicket = parseMoveTicket(await DataStore.get<unknown>(MOVE_TICKET_KEY));
        } catch {
            moveTicket = null;
        }
    }
    if (moveTicket !== null && Date.now() >= moveTicket.expiresAt) clearMoveTicket();
    return moveTicket;
}

function saveMoveTicket(t: MoveTicket): void {
    moveTicket = t;
    moveOfferedTo = null;
    void DataStore.set(MOVE_TICKET_KEY, t).catch(() => { });
}

function clearMoveTicket(): void {
    moveTicket = null;
    moveOfferedTo = null;
    void DataStore.set(MOVE_TICKET_KEY, undefined).catch(() => { });
}

/** Settings → Plan: shown on a linked computer of the account that has the plan. */
function canMovePlan(): boolean {
    return linkState() === "linked" && activated() && !mustLink();
}

/** The sentence for a move the relay refused. */
function moveErrorCopy(res: RelayRefusal | null): string {
    switch (res?.errorCode) {
        case "move_too_soon": return res.until !== undefined ? fill(MOVE_COPY.tooSoon, { date: moveDate(res.until) }) : MOVE_COPY.tooSoon.replace(" on {date}", " later");
        case "ticket_expired": return MOVE_COPY.expired;
        case "same_account": return MOVE_COPY.sameAccount;
        case "no_plan": return MOVE_COPY.noPlan;
        case "account_too_new": return MOVE_COPY.tooNew;
        case "move_busy": return MOVE_COPY.busy;
        case "not_linked": return UPGRADE_COPY.notLinked;
        case "wrong_account": return fill(ACCOUNT_COPY.wrongAccount, { name: signedInAccount()?.view.name ?? signedInName() });
        default: return linkErrorCopy(res);
    }
}

/** Refusals after which the same ticket cannot work: it is dropped. */
const MOVE_FINAL: readonly string[] = ["ticket_expired", "same_account", "no_plan", "account_too_new", "move_too_soon"];

function sayMoveRefusal(res: RelayRefusal | null): void {
    if (res?.errorCode !== undefined && MOVE_FINAL.includes(res.errorCode)) clearMoveTicket();
    // The same ticket can still finish it: the window is offered again on the next visit.
    else moveOfferedTo = null;
    const text = moveErrorCopy(res);
    if (!openMessage(MOVE_COPY.startTitle, text)) toast(text, "failure");
}

/** Settings → "Move my plan to another Discord account". */
function startMove(): void {
    const me = signedInAccount();
    if (me === null) {
        sayResult(LINK_COPY.noAccount, "failure");
        return;
    }
    if (!canMovePlan()) return;
    const from = currentAccount!;
    const shown = openMoveStart(me.view, async () => {
        let res: Awaited<ReturnType<typeof transport.relayMoveStart>>;
        try {
            const { credential, install } = await relayCredentials();
            res = await transport.relayMoveStart(credential, install);
        } catch {
            return LINK_COPY.unreachable;
        }
        if (!res.ok) return moveErrorCopy(res);
        // Signed in as someone else meanwhile: the move is still this account's to start again.
        if (currentAccount !== from) return LINK_COPY.unreachable;
        // The relay keeps the ticket 10 minutes; counted here on this
        // computer's own clock (the relay's expiresAt is on the relay's, and a
        // clock running ahead would hide the move on the other account). A
        // ticket used late is answered ticket_expired, and said.
        saveMoveTicket({ ticket: res.ticket, expiresAt: Date.now() + MOVE_TICKET_MS, from, fromName: me.view.name });
        return null;
    });
    if (!shown) sayResult(LINK_COPY.ownWindowFailed, "failure");
}

/**
 * On another account, while a move ticket waits: the window that names both
 * accounts. "Move to @alt" opens Discord's Authorize window (or the browser
 * fallback, with the ticket). Shown by itself once per account per ticket
 * (again after a try that can be repeated); Subline's Settings offer it for
 * as long as the ticket waits ("Finish moving your plan here").
 */
async function offerMoveHere(): Promise<void> {
    const epoch = accountEpoch;
    const t = await loadMoveTicket();
    if (epoch !== accountEpoch || t === null || currentAccount === null || t.from === currentAccount || moveOfferedTo === currentAccount) return;
    showMoveHere(t);
}

function showMoveHere(t: MoveTicket): boolean {
    const me = signedInAccount();
    if (me === null) return false;
    const epoch = accountEpoch;
    moveOfferedTo = currentAccount;
    return openMoveHere(t.fromName, me.view, () => {
        // Signed in as someone else meanwhile: the window never named that account.
        if (epoch !== accountEpoch) return;
        authorizeMove(t.ticket);
    });
}

/** A move ticket waits for this account (not the one that started it), within its 10 minutes. */
function canFinishMove(): boolean {
    const t = moveTicket;
    return t !== null && Date.now() < t.expiresAt && currentAccount !== null && t.from !== currentAccount && signedInAccount() !== null;
}

/** Settings → "Finish moving your plan here": the window that names both accounts, again. */
function finishMoveFromSettings(): void {
    if (!canFinishMove() || linkBusy) return;
    if (!showMoveHere(moveTicket!)) sayResult(LINK_COPY.ownWindowFailed, "failure");
}

/** The new account's Authorize for a move: the window inside Discord, else the browser. */
function authorizeMove(ticket: string): void {
    if (linkBusy) return;
    if (authorizeWindowBroken) {
        void runFallback(ticket, reserveFallbackTab());
        return;
    }
    const opened = openLinkWindow({
        onCode: code => { void finishMove(ticket, code); },
        onNoCode: () => sayResult(LINK_COPY.refused, "failure"),
        // Closed without a code (Cancel, the X, Escape): the window is
        // offered again on the next visit, and Settings offer it now.
        onClosed: () => {
            if (!linkBusy) moveOfferedTo = null;
        },
        onCrash: (error, componentStack) => {
            logger.error(`Discord's Authorize window crashed and was closed: ${error instanceof Error ? error.message : String(error)}${componentStack}`, error);
            recordError("link-crash");
            authorizeWindowBroken = true;
            void runFallback(ticket, reserveFallbackTab());
        }
    });
    if (!opened) {
        logger.error("Discord's Authorize window could not be opened for a move. Finishing it in the browser instead.");
        recordError("link-window");
        void runFallback(ticket, reserveFallbackTab());
    }
}

async function finishMove(ticket: string, code: string): Promise<void> {
    if (linkBusy) return;
    const me = signedInAccount();
    if (me === null) {
        sayResult(LINK_COPY.noAccount, "failure");
        return;
    }
    linkBusy = true;
    const epoch = accountEpoch;
    const session = statusSession;
    const account = currentAccount!;
    let sentOn: string | null = null;
    try {
        let res: Awaited<ReturnType<typeof transport.relayMoveFinish>> | null;
        let install = "";
        try {
            const creds = await relayCredentials();
            install = creds.install;
            sentOn = await notePendingFor(account, creds.install);
            if (epoch !== accountEpoch || session !== statusSession) return;
            res = await transport.relayMoveFinish(creds.credential, creds.install, ticket, code, me.id);
        } catch {
            res = null;
        }
        // Signed in as someone else meanwhile: a move the relay finished all
        // the same binds the sender and uses up the ticket.
        if (epoch !== accountEpoch || session !== statusSession) {
            if (res !== null && res.ok && res.linked === true) await settleFinishedElsewhere(account, sentOn, ticket);
            return;
        }
        if (res === null || !res.ok || res.linked !== true) {
            logger.warn(`The move did not complete (${res === null ? "no answer" : res.ok ? "not linked" : res.errorCode ?? res.error}).`);
            afterUnansweredLink(account, sentOn, res);
            sayMoveRefusal(res !== null && !res.ok ? res : null);
            return;
        }
        await takeMoveAnswer(res, install);
    } finally {
        linkBusy = false;
    }
}

/** The move worked: the plan is this account's. The old account's plan flag here goes off. */
async function takeMoveAnswer(res: Extract<Awaited<ReturnType<typeof transport.relayMoveFinish>>, { ok: true; }>, install: string): Promise<void> {
    const t = moveTicket;
    clearMoveTicket();
    await takeLinkAnswer({ ...res, moved: true }, "", install, false);
    if (t !== null) void noteLocalAccount(t.from, { name: t.fromName, plan: false }).then(accounts => { if (accounts !== null) localAccounts = accounts; });
    const name = signedInName();
    if (name !== "") toast(fill(MOVE_COPY.done, { name }), "success");
}

/**
 * A link or a move the relay finished after the account that sent it was
 * left (an account switch while its answer was on the way). Nothing is shown
 * to the account signed in now. The install id from before, if it was sent
 * on, is the sender's (account.ts rule 2); a move's ticket is used up, and
 * the old account no longer counts as having the plan here.
 */
async function settleFinishedElsewhere(account: string, sentOn: string | null, ticket: string | null): Promise<void> {
    if (sentOn !== null) await bindAfterLink(account, sentOn);
    const t = moveTicket;
    if (ticket === null || t === null || t.ticket !== ticket) return;
    clearMoveTicket();
    void noteLocalAccount(t.from, { name: t.fromName, plan: false }).then(accounts => { if (accounts !== null) localAccounts = accounts; });
}

/* ------------------------------------------------ pay on another device -- */

/**
 * "Pay on another device" (0.2.8 spec, decision 6): the same checkout the Buy
 * button opens, made by the relay for this install and account, shown as a
 * link and a QR code instead of opened here. The purchase is waited for as
 * for Buy, so Subline switches on here by itself.
 */
function payElsewhere(plan: Plan): void {
    checkoutTarget = plan === "automatic" ? "automatic" : "ai";
    void getCheckoutFlow().startElsewhere(plan).then(result => {
        if (typeof result === "object") {
            if (!openPayElsewhere(result.url)) sayResult(LINK_COPY.ownWindowFailed, "failure");
            return;
        }
        sayCheckoutResult(plan, result);
    });
}

/** "Pay on another device" from a buy panel: the account confirm first, as for Buy. */
function payElsewhereConfirmed(plan: Plan | null): void {
    if (plan !== null) {
        withAccountConfirm(() => payElsewhere(plan));
        return;
    }
    // Add AI: which plan first.
    if (!openElsewherePlanChoice(p => withAccountConfirm(() => payElsewhere(p)))) sayResult(LINK_COPY.ownWindowFailed, "failure");
}

/**
 * The relay's last answer was the 3-computer limit. Every Activate link then
 * shows that sentence and its GitHub link, never the buy panel: buying again
 * would not free a computer.
 */
let deviceLimited = false;

/**
 * A saved code the relay has not confirmed, because it could not be reached
 * (a first 0.2.0 start offline, a network fault). Never the Activate notice
 * then: the reader has a code, and pressing Activate would sell them what
 * they already own. A plain notice instead, and the status call keeps
 * retrying (scheduleStatusRetry).
 */
function showCheckingNotice(kind: "code" | "early" = "code"): void {
    if (activated()) return;
    if (kind === "early") putNotice("checking", UPGRADE_COPY.earlyCheckingNotice, UPGRADE_COPY.earlyCheckingNoticeButton, () => takeNotice("checking"));
    else putNotice("checking", UPGRADE_COPY.checkingNotice, UPGRADE_COPY.checkingNoticeButton, () => takeNotice("checking"));
}

/**
 * The relay could not be reached. A saved code: the code checking notice. An
 * early user (the prior-use hint was sent and the relay has not answered it
 * yet): the early-user checking notice, for at most a day of retries. Anyone
 * else: the activation notice.
 */
async function showUnreachableNotice(prior: boolean): Promise<void> {
    if (activated()) return;
    if (savedCode() !== "") { showCheckingNotice("code"); return; }
    if (prior) {
        const since = await earlyCheckSince(Date.now());
        if (since !== null && Date.now() - since < EARLY_CHECK_MS) {
            showCheckingNotice("early");
            return;
        }
    }
    takeDownCheckingNotice();
    showActivationNotice();
}

/** The relay answered: the checking notice has said what it had to. */
function takeDownCheckingNotice(): void {
    takeNotice("checking");
}

/**
 * "Subline isn't active on this Discord account yet." with an Activate button,
 * once per session (and again only with a different sentence). A notice, not
 * a toast: it stays until dismissed.
 */
function showActivationNotice(message: string = UPGRADE_COPY.activateNotice): void {
    if (activated()) return;
    // Not linked: first, once per account, link with no window if this
    // account already approved Subline elsewhere (its own plan may be there:
    // case 13). Nothing shows while that runs. Until it answers, nobody here
    // can say this account has no plan.
    if (linkNeeded() && startSilentLink()) return;
    // Another account on this computer linked the plan here (account.ts):
    // say where it is, with local names only. No buy button is pushed first;
    // Buy stays in Subline's Settings (0.2.8 spec, "Account switcher").
    // Never to an account with its own code here: its plan waits only for
    // its Link, so it gets the Link bar (owner Mac, 2026-10-15).
    const elsewhere = mustLink() || savedCode() !== "" ? null : planElsewhere(currentAccount, localAccounts);
    if (elsewhere !== null) {
        // Not linked: this account may own a plan only its Link can find (it
        // removed Subline from Authorized Apps, or never approved it on this
        // Discord), so Link is the button.
        if (linkNeeded()) {
            putNotice("activation", fill(ACCOUNT_COPY.planElsewhereLink, { name: elsewhere }), LINK_COPY.button, linkFromSettings);
            sendEvent("link_prompt");
        } else putNotice("activation", fill(ACCOUNT_COPY.planElsewhere, { name: elsewhere }), ACCOUNT_COPY.ok, () => takeNotice("activation"));
        return;
    }
    // Not linked: the Link bar instead. Nothing else can help until then.
    // Forced: while not linked, the bar is never suppressed by a close earlier
    // this session (putNotice still never shows it twice).
    if (linkNeeded()) {
        putNotice("activation", LINK_COPY.notice, LINK_COPY.button, linkFromSettings, true);
        sendEvent("link_prompt");
        return;
    }
    putNotice("activation", message, UPGRADE_COPY.activateButton, openUpgradeForLevel);
}

/**
 * Copy the support address a reader writes to for a computer reset. Copied,
 * not opened: Vencord's openExternal refuses mailto: links.
 */
function openResetHelp(): void {
    void copyToClipboard(SUPPORT_EMAIL)
        .then(() => toast(UPGRADE_COPY.emailCopied, "success"))
        .catch(() => { });
}

/**
 * The 3-computer limit, with a "GitHub" button that opens the issues page
 * (a toast cannot carry a link; a notice can). Never the buy panel.
 */
function showDeviceLimitNotice(force = false): void {
    deviceLimited = true;
    // Idempotent: a notice already up (or queued) is never queued twice.
    putNotice("activation", UPGRADE_COPY.deviceLimit, UPGRADE_COPY.deviceLimitButton, openResetHelp, force);
}

/**
 * "The installed app is too old" (appNotice.ts). A Vencord notice has one
 * button and an X, so "Later" is an inline link in the message that takes
 * only this notice down.
 */
function showAppNotice(): void {
    const later = () => takeNotice("appUpdate");
    const display = (
        <span>
            {APP_NOTICE_COPY.text}{" "}
            <a
                role="button"
                onClick={later}
                style={{ marginLeft: 6, textDecoration: "underline", cursor: "pointer", color: "inherit" }}
            >
                {APP_NOTICE_COPY.later}
            </a>
        </span>
    );
    putNotice("appUpdate", APP_NOTICE_COPY.text, APP_NOTICE_COPY.button, () => {
        (globalThis as any).VencordNative?.native?.openExternal?.(APP_DOWNLOAD_URL);
        takeNotice("appUpdate");
    }, false, display);
}

/**
 * "Subline updated, restart Discord" (updateNotice.ts). Restart stays the one
 * button; "What's new" is an inline link, as "Later" is above, to the release
 * page of the version on disk. It does not take the notice down: the restart
 * is still due. No version we can name, no link.
 */
function showUpdateNotice(version: string | null): void {
    const url = releaseNotesUrl(version);
    const display = url === null ? UPDATE_NOTICE_COPY.text : (
        <span>
            {UPDATE_NOTICE_COPY.text}{" "}
            <a
                role="button"
                onClick={() => {
                    if (isReleaseNotesUrl(url)) (globalThis as any).VencordNative?.native?.openExternal?.(url);
                }}
                style={{ marginLeft: 6, textDecoration: "underline", cursor: "pointer", color: "inherit" }}
            >
                {UPDATE_NOTICE_COPY.whatsNew}
            </a>
        </span>
    );
    showNotice(display as Parameters<typeof showNotice>[0], UPDATE_NOTICE_COPY.button, relaunch);
}

/**
 * The entitlement changed under a running session. Take the activation
 * notice down (or put it up), rebuild so the quality tier appears or goes,
 * redraw what is on screen, and translate the open channel if this install
 * can now read it.
 */
function onEntitlementChanged(): void {
    // A prior payer still to link: the bar that asks (never a block). Linked: gone.
    showMustLinkBar();
    if (activated()) takeNotice("activation");
    if (activated()) takeDownCheckingNotice();
    if (!running) return;   // stopped
    // The relay answered about the plan: a refusal hold from before it says
    // nothing any more (a payment that landed must not wait a minute).
    planHeldUntil = 0;
    // Not while a relay answer is being taken in (a dead code is dropped
    // before the account's answer is stored), and not while a saved code
    // waits for the relay: the answer itself decides which notice is right.
    if (!activated() && !applyingStatus && (savedCode() === "" || linkNeeded())) showActivationNotice();
    rebuildBatcher();
    notifyForcedInFlight();
    const open = SelectedChannelStore.getChannelId();
    if (open) catchUp(open);
}

/* --------------------------------------------------- reading language -- */


/** The reading language this session last translated into. */
let activeTargetLang: string | null = null;

/**
 * Earlier builds had a free-text language field, so the stored value can be
 * "pt-BR" or "English". The dropdown stores bare codes; turn an old value into
 * one when it maps cleanly, and drop what was cached under the old value.
 * Anything that does not map is left alone (the dropdown shows it as is).
 */
function normaliseTargetLangSetting(): void {
    const raw = settings.store.targetLang;
    const code = normalizeTargetLang(raw);
    if (code === null || code === raw) return;
    // Tidying an old value is not the reader changing the language (prefs.ts).
    withoutPrefStamp(() => { settings.store.targetLang = code; });
    if (typeof raw === "string") clearLanguage(raw);
}

/**
 * The settings page does not show the engine, and 0.2.9 has one (the relay,
 * spec decision 1), so a value an older build stored ("google", or a
 * bring-your-own-key engine from v0.1.8 and earlier) is moved to the relay
 * here, at start and on every account switch. No old setting can select an
 * engine this build does not run.
 */
function normaliseEngineSetting(): void {
    if (settings.store.engine !== ENGINE) settings.store.engine = ENGINE;
}

/**
 * The reading language changed under a running session. New translations use
 * the new language as soon as the batcher is rebuilt (the settings handler does
 * that right after this). What was cached in the old language is dropped, in
 * memory and on disk, so the store stops holding lines nobody can see, and the
 * channel on screen is caught up in the new language.
 */
function onTargetLangMaybeChanged(): void {
    const next = settings.store.targetLang;
    const prev = activeTargetLang;
    activeTargetLang = next;
    if (prev === null || prev === next) return;
    clearLanguage(prev);
    for (const k of [...qualityPhrases.keys()]) {
        if (k.startsWith(`${prev}\u0000`)) qualityPhrases.delete(k);
    }
    queueMicrotask(() => {
        if (!running) return;
        const open = SelectedChannelStore.getChannelId();
        if (open) catchUp(open);
    });
}

/* ------------------------------------------------------------ upgrade -- */

/**
 * The checkout the Activate or Add AI panel started, if any (checkout.ts). One
 * flow per session: choosing a plan again restarts it, stop() stops it.
 */
let checkoutFlow: CheckoutFlow | null = null;
/** What the open checkout is for: done once the relay says this install has it. */
let checkoutTarget: "automatic" | "ai" = "automatic";

function getCheckoutFlow(): CheckoutFlow {
    if (checkoutFlow !== null) return checkoutFlow;
    checkoutFlow = createCheckoutFlow({
        bearer: async () => tasteBearer(await installIdOnce()),
        // The static link names only the install: only for one the relay
        // said is linked to this account (checkout.ts header).
        staticLinkAllowed: () => linkState() === "linked",
        createCheckout: async (bearer, plan) => {
            const code = savedCode();
            const res = await transport.relayCheckout(code !== "" ? code : bearer, plan, bearer);
            return res.ok ? { ok: true, url: res.url } : { ok: false, error: res.error, errorCode: res.errorCode, status: res.status };
        },
        status: async bearer => {
            const code = savedCode();
            const res = await transport.relayStatus(code !== "" ? code : bearer, bearer);
            if (!res.ok) return { ok: false };
            const before = entitlementLevel();
            const saved = applyStatus(res);
            if (saved || before !== entitlementLevel()) onEntitlementChanged();
            // Done once the relay says this install has what was bought. The
            // purchase itself was already saved above (applyStatus), so the
            // flow is only told to stop polling.
            const done = checkoutTarget === "ai" ? entitlementLevel() === "ai" : activated();
            if (!done) return { ok: true };
            announcePurchase();
            return { ok: true, purchase: { code: savedCode(), plan: checkoutTarget } };
        },
        openExternal: url => (globalThis as any).VencordNative?.native?.openExternal?.(url),
        // In a browser the checkout tab opens at the click (checkout.ts ReservedTab).
        reserveWindow: () => isDesktop() ? undefined : reserveTab((globalThis as any).open?.bind(globalThis)),
        onPurchase: () => true,
        log: tasteLog,
        onPendingChange: onPaymentPendingChange
    });
    return checkoutFlow;
}

/**
 * P4. A payment started (or stopped being waited for). While it is on its
 * way nothing offers a second purchase: an open buy panel closes, and every
 * "Add AI" / "Activate" reads "Payment being confirmed". When it ends, the
 * "Payment being confirmed" panel closes. The ✦ preview lines are redrawn.
 */
function onPaymentPendingChange(pending: boolean): void {
    setPaymentPending(pending);
    if (pending) {
        closePanel("plan");
        closePanel("ended");
    } else {
        closePanel("planInfo");
    }
    notifyForcedInFlight();
}

/**
 * P5. What the install owns changed: a panel selling what it now has closes
 * (the plan panel and the ended panel once a subscription is here; also
 * once a payment is on its way, P4). A panel opened during a period stays:
 * a period still sells. The ✦ button, the plan card and ⚡ already read the
 * plan on every draw.
 */
function closePanelsForLevel(): void {
    const state = currentPlanView().state;
    if (state === "subscribed" || state === "pending") {
        closePanel("plan");
        closePanel("ended");
    }
}
let unsubscribePanels: (() => void) | null = null;

/**
 * Save a code the relay linked to this install (a purchase, a promo or an
 * early-user grant). Saving it switches the engine to the relay (settings.ts
 * syncEngineToCode); the entitlement, not the code, decides what that means.
 * Returns whether it was saved: not when it is already the saved code, and
 * not when it is the code the reader cleared by hand (the relay keeps the
 * link for 30 days, so without this it would come straight back).
 */
function adoptCode(code: string): boolean {
    const next = code.trim();
    if (next === "" || next === savedCode()) return false;
    if (next === settings.store.clearedPurchaseCode) return false;
    settings.store.sublineCode = next;
    if (settings.store.engine !== "relay") settings.store.engine = "relay";
    return true;
}

/** A week: how long Automatic works offline after the relay last answered, if it did not say. */
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60_000;

/**
 * A saved code is dropped as dead only after TWO dead answers for it at least
 * this far apart. The relay's storage can lag (a code minted a moment ago may
 * not be readable everywhere yet), and dropping a good code on one answer
 * would log a paying reader out.
 */
export const DEAD_CODE_CONFIRM_MS = 60 * 60_000;
let deadRecheckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A relay refusal (AI lapsed, not activated, a 4th computer) normally asks the
 * relay again at once. Not while the saved code has one unconfirmed dead
 * answer: the hourly re-check scheduled by deadCodeConfirmed owns that, and a
 * refusal-driven status call would only repeat the first strike. Returns
 * whether a refresh was started.
 */
function refreshAfterRefusal(): boolean {
    const code = savedCode();
    if (code !== "" && deadCodeSeen().code === code) return false;
    void refreshEntitlement();
    return true;
}

function deadCodeSeen(): { code: string; at: number; } {
    const v = settings.store.deadCodeSeen as { code?: unknown; at?: unknown; } | undefined;
    return typeof v?.code === "string" && typeof v?.at === "number" ? { code: v.code, at: v.at } : { code: "", at: 0 };
}

/**
 * The relay called `code` dead. True when this confirms an earlier dead answer
 * for the same code at least DEAD_CODE_CONFIRM_MS ago (drop it now). Otherwise
 * the first sighting is recorded and a re-check is scheduled for when the
 * hour is up; the code and what it owned stay meanwhile.
 */
function deadCodeConfirmed(code: string, now: number = Date.now()): boolean {
    const seen = deadCodeSeen();
    if (seen.code === code && now - seen.at >= DEAD_CODE_CONFIRM_MS) {
        settings.store.deadCodeSeen = { code: "", at: 0 };
        return true;
    }
    if (seen.code !== code) settings.store.deadCodeSeen = { code, at: now };
    const at = seen.code === code ? seen.at : now;
    if (deadRecheckTimer === null) {
        deadRecheckTimer = setTimeout(() => {
            deadRecheckTimer = null;
            void refreshEntitlement();
        }, Math.max(0, at + DEAD_CODE_CONFIRM_MS - now) + 1_000);
    }
    return false;
}

/**
 * The owner's off switch (surfaces/guard.tsx isFeatureOff), from a status
 * answer that states it. Absent or malformed: the last list stays (so does
 * it when the relay is down, since no answer reaches here). Written only when
 * it changed. Never throws.
 */
function takeOffSwitch(raw: unknown): void {
    try {
        const off = offListFrom(raw);
        if (off === undefined) return;
        const before = settings.store.remoteOff as unknown;
        if (Array.isArray(before) && before.join(",") === off.join(",")) return;
        settings.store.remoteOff = off;
        if (off.length > 0) logger.info(`switched off for now: ${off.join(", ")}`);
    } catch { /* the last list stays */ }
}

/**
 * Take in a good /v1/status answer: the entitlement (v2 relays only), today's
 * ✦ preview count, and any code to save. Returns whether a code was saved.
 * An answer from an older relay (no `automatic` field) changes nothing but a
 * linked purchase: it cannot say what this install owns.
 */
function applyStatus(res: Extract<Awaited<ReturnType<typeof transport.relayStatus>>, { ok: true; }>): boolean {
    takeOffSwitch(res.off);
    // A DEAD code (lapsed, refunded, revoked) is forgotten here and marked as
    // cleared, so the relay's link cannot bring it back, but only on the
    // second dead answer at least an hour after the first (deadCodeConfirmed).
    // Until then the saved code stays, and so does nothing replace it. The
    // relay still answers for the whole account behind this install, so an AI
    // lapse leaves Automatic in place; clearing the code asks again with the
    // install id (the settings handler in start()).
    let dropped = false;
    let deadPending = false;
    let saved = false;
    applyingStatus = true;
    try {
        if (res.deadCode !== undefined && res.deadCode === savedCode()) {
            if (deadCodeConfirmed(res.deadCode)) {
                // NOT marked as cleared by the reader. The relay never offers
                // a dead code back, so if it offers this one again it is live
                // again (a renewal paid after a declined card), and must be
                // taken back. Marking it cleared kept a paying subscriber on
                // ≈ for good. Only a code the reader removes by hand is
                // remembered as cleared (the settings handler).
                autoDroppedCode = res.deadCode;
                settings.store.sublineCode = "";
                dropped = true;
            } else {
                deadPending = true;
            }
        } else if (res.deadCode === undefined && savedCode() !== "" && deadCodeSeen().code === savedCode()) {
            // The relay knows the code after all: forget the earlier "dead".
            settings.store.deadCodeSeen = { code: "", at: 0 };
        }
        // The code next: the answer is then stored for the code it is about.
        // What the relay hands back wins (it prefers the Automatic code).
        const linked = res.code ?? res.purchase?.code;
        saved = linked !== undefined && !deadPending ? adoptCode(linked) : false;
    } finally {
        applyingStatus = false;
    }
    // First strike on a dead code: the answer is left out when it would LOWER
    // what is stored, so the plan stored for the code stays as it was until
    // the second dead answer (or a live one) settles it. A storage lag on the
    // relay must not downgrade a paying reader for an hour. An answer that
    // lowers nothing is taken (the code itself still waits): the first dead
    // sighting can be the link answer itself, and holding the stored "not
    // linked, nothing owned" kept a paying reader on the Link bar for an hour.
    // 0.2.9, a link or move answer: the link stands, but the relay could not
    // read the plan (`accessUnknown`, no ai, previews, access or token in it).
    // The last state stays (decision 16): only the link is news. The relay
    // is asked again for the plan.
    if (res.accessUnknown === true) {
        const e = getEntitlement();
        if (e !== null && typeof res.linked === "boolean" && e.linked !== res.linked) setEntitlement({ ...e, linked: res.linked });
        void refreshEntitlement();
        if (res.grant === "early") earlyGrantPending = true;
        return saved || dropped;
    }
    const answerLevel: Level = res.ai === true ? "ai" : res.automatic === true ? "automatic" : "none";
    const holdStored = deadPending && levelRank(answerLevel) < levelRank(entitlementLevel());
    if (typeof res.automatic === "boolean" && !holdStored) {
        const now = Date.now();
        // CLOCK SKEW. The relay's times are on its clock. A reader's clock
        // that runs a day fast would end Automatic a day early (and one that
        // runs slow, a day late), so every stated time is moved onto the
        // local clock by the difference the relay's `now` reveals.
        const skew = res.serverNow !== undefined ? res.serverNow - now : 0;
        const holder = currentHolderNow();
        // 0.2.9: the plan state, its times on the local clock too.
        const access = accessOnLocalClock(res.access, skew);
        setEntitlement({
            automatic: res.automatic,
            ai: res.ai === true,
            ...(res.aiUntil !== undefined ? { aiUntil: res.aiUntil - skew } : {}),
            ...(res.token !== undefined ? { token: res.token } : {}),
            tokenExpiresAt: res.tokenExpiresAt !== undefined ? res.tokenExpiresAt - skew : now + OFFLINE_GRACE_MS,
            checkedAt: now,
            ...(holder !== null ? { holder } : {}),
            ...(typeof res.linked === "boolean" ? { linked: res.linked } : {}),
            // A prior payer still to link (0.2.8): its plan works; the bar asks.
            ...(res.mustLink === true && res.linked === false ? { mustLink: true } : {}),
            // A purchase started here before 0.2.8, still on its way: a link asks the confirm.
            ...(res.pendingPurchase === true && res.linked === false ? { pendingPurchase: true } : {}),
            ...(access !== null ? { access } : {})
        });
        noteRelayClock(res.serverNow, now);
        if (res.previews !== undefined) recordTasteQuota(res.previews.used, res.previews.cap);
    }
    if (res.grant === "early") earlyGrantPending = true;
    return saved || dropped;
}

/**
 * A stated `access` with its times moved onto the local clock (see CLOCK SKEW
 * in applyStatus), or null when there is none or it is malformed.
 *
 * `startedAt` stays on the relay's clock: it is only the period's id
 * (planState.ts periodIdOf). The skew is measured after the answer arrives,
 * so it differs a little on every answer; a moved start would give the same
 * period a new id each time, and its two messages would come again.
 */
function accessOnLocalClock(raw: unknown, skew: number) {
    const a = accessFrom(raw);
    if (a === null) return null;
    const move = (t: number | undefined) => t === undefined ? undefined : t - skew;
    return {
        ...a,
        ...(a.endsAt !== undefined ? { endsAt: move(a.endsAt) } : {}),
        ...(a.resetsAt !== undefined ? { resetsAt: move(a.resetsAt) } : {})
    };
}

/** The relay just granted the early-user Automatic: the next announcement says so. */
let earlyGrantPending = false;
/**
 * The code applyStatus last dropped as dead, until the settings handler has
 * seen the change: that change was not the reader clearing the code.
 */
let autoDroppedCode = "";
/** True while applyStatus changes the saved code (see onEntitlementChanged). */
let applyingStatus = false;

/**
 * The fingerprint of the saved code and this install id, recorded as the
 * current one (entitlement.ts). Null only before the install id is known.
 */
function currentHolderNow(): string | null {
    const id = knownInstallId();
    if (id === null) return null;
    const h = holderFor(savedCode(), id);
    setCurrentHolder(h);
    return h;
}

const LEVEL_RANK: Record<Level, number> = { none: 0, automatic: 1, ai: 2 };
const levelRank = (level: Level) => LEVEL_RANK[level];

/** The plan and code the "You're on." notice was last shown for. */
let announcedPurchase = "";

/**
 * "You're on. Every message translates by itself now." A notice, not a toast:
 * it stays until dismissed, because a purchase usually lands while the buyer
 * is still in the browser. Once per plan and code, whichever path got there
 * first (the checkout poll, a status refresh, a code entered by hand).
 */
function announcePurchase(): void {
    const key = `${entitlementLevel()}:${savedCode()}`;
    if (!activated() || key === announcedPurchase) return;
    announcedPurchase = key;
    // An early user did not buy anything: thank them instead.
    const early = earlyGrantPending;
    earlyGrantPending = false;
    showNotice(early ? UPGRADE_COPY.earlyNotice : UPGRADE_COPY.purchasedNotice, UPGRADE_COPY.purchasedNoticeButton, popNotice);
}

/**
 * What every Activate, Upgrade and Add AI link does: the Activate panel for an
 * install with nothing (buy Automatic, or enter a code), the Add AI panel for
 * an Automatic owner, and nothing for an install that already has AI.
 */
function openUpgradeForLevel(): void {
    openUpgradeFor(false);
}

/** openUpgradeForLevel; `asked`: the relay was just asked (askThenOpenUpgrade), so it is not asked again. */
function openUpgradeFor(asked: boolean): void {
    // Not linked: Link first. Buying or a code would only be refused.
    if (linkNeeded()) {
        linkFromSettings();
        return;
    }
    // A plan from before, not linked yet (mustLink): the relay sells nothing
    // until it is linked, and the link binds that plan. The account confirm,
    // the link, then this again (the confirm covers what follows).
    if (mustLink()) {
        startLinkConfirmed(openUpgradeForLevel);
        return;
    }
    const level = entitlementLevel();
    if (level === "none" && deviceLimited) {
        // Buying again would not free a computer: the sentence and its link.
        sayResult(UPGRADE_COPY.deviceLimit, "failure");
        // Back on screen if the reader closed it; never a second copy.
        showDeviceLimitNotice(true);
        return;
    }
    const view = currentPlanView();
    // Not known yet whether this account is linked (a first start the relay
    // has not answered, a code just changed): ask the relay first. Its answer
    // puts up the Link (not linked) or the account confirm (a plan from
    // before) instead of a sale, which could otherwise reach the installer's
    // id every local account shares (checkout.ts header).
    if (!asked && view.state !== "subscribed" && view.state !== "pending" && linkState() === "unknown") {
        void askThenOpenUpgrade();
        return;
    }
    // THE PLAN PANEL (0.2.9 spec, decisions 11 and 15): the state, and
    // "Enter a code" at every level. Nothing to sell for a subscription or a
    // buyer, and P4: nothing sold twice while a payment is on its way. Every
    // purchase names the account first (withAccountConfirm), inside the
    // click, so a browser tab can still open for the checkout.
    if (view.state === "subscribed") {
        // Nothing to buy and no code to enter: a code adds nothing to a paid plan.
        openPlanPanel({ state: PLAN_COPY.onPanel });
        return;
    }
    if (view.state === "pending") {
        openPlanPanel({ state: view.hover, note: UPGRADE_COPY.purchasePending, enterCode: openCodeEntryOrLink });
        return;
    }
    openPlanPanel({
        state: view.hover,
        subscribe: plan => withAccountConfirm(() => startCheckout(plan)),
        enterCode: openCodeEntryOrLink,
        elsewhere: () => payElsewhereConfirmed(null)
    });
    // The prices, in front of a linked account with nothing yet.
    if (priceSeenApplies({ linkState: linkState(), level, code: savedCode() })) sendEvent("price_seen");
}

/**
 * WHAT THE ✦ BUTTON SAYS now (planState.ts): from the relay's last answer for
 * this account, the local clock, the Link state and a checkout opened here.
 * The ✦ button, the plan panel, ⚡ and the once-a-period messages all read it.
 */
function currentPlanView(now: number = Date.now()): PlanView {
    return planView({
        entitlement: getEntitlement(),
        level: entitlementLevel(now),
        now,
        linkNeeded: linkNeeded(),
        paymentPending: isPaymentPending()
    });
}

/** True while openUpgradeForLevel waits for the relay (a second press asks nothing more). */
let askingBeforeSale = false;

/**
 * The relay's answer first, then the panel (or the Link) it calls for. The
 * relay unreachable: said, and nothing opens. Answered, even with no link
 * state in it: the panel; the relay itself refuses a purchase for an
 * account that is not linked (403 not_linked), and the static link never
 * opens for one (checkout.ts staticLinkAllowed). A switch meanwhile: nothing.
 */
async function askThenOpenUpgrade(): Promise<void> {
    if (askingBeforeSale) return;
    askingBeforeSale = true;
    const epoch = accountEpoch;
    const session = statusSession;
    let answered = false;
    try {
        answered = await refreshEntitlement();
    } catch {
        answered = false;
    } finally {
        askingBeforeSale = false;
    }
    if (epoch !== accountEpoch || session !== statusSession) return;
    if (answered) openUpgradeFor(true);
    else sayResult(LINK_COPY.unreachable, "failure");
}

function startCheckout(plan: Plan): void {
    checkoutTarget = plan === "automatic" ? "automatic" : "ai";
    void getCheckoutFlow().start(plan).then(result => sayCheckoutResult(plan, result));
}

/** What a checkout (here or on another device) answered, said once. */
function sayCheckoutResult(plan: Plan, result: true | false | string): void {
    {
        if (result === true) {
            toast(UPGRADE_COPY.checkoutOpenedToast, "info");
        } else if (result === "unavailable" || result === "automatic_required") {
            // automatic_required: a relay from before 0.2.9 (AI only on top of
            // Automatic, which is not sold any more). Nothing opened.
            sayResult(UPGRADE_COPY.checkoutUnavailable, "failure");
        } else if (result === "unreachable") {
            // The relay could not be reached, and the static link may not
            // open on an install not known to be linked: nothing opened.
            sayResult(LINK_COPY.unreachable, "failure");
        } else if (result === "blocked") {
            // The browser blocked the checkout tab: nothing was asked or opened.
            sayResult(UPGRADE_COPY.checkoutBlocked, "failure");
        } else if (result === "already_owned") {
            // Nothing opened. AI owned means a second subscription was refused.
            sayResult(UPGRADE_COPY.alreadyAi, "info");
            void refreshEntitlement();
        } else if (result === "purchase_pending") {
            // Nothing opened: buying again would charge twice. The flow keeps
            // asking the relay, so it switches on by itself when it lands.
            sayResult(UPGRADE_COPY.purchasePending, "info");
        } else if (result === "not_linked") {
            // Nothing opened: the account must be linked first. Asking again
            // puts the Link bar up.
            sayResult(UPGRADE_COPY.notLinked, "failure");
            void refreshEntitlement();
        }
    }
}

/** "Enter a code" from the settings: Link first when the account is not linked. */
function openCodeEntryOrLink(): void {
    if (linkNeeded()) linkFromSettings();
    else if (mustLink()) startLinkConfirmed(openCodeEntryPanel);
    else openCodeEntryPanel();
}

/**
 * The code entry, after the account confirm: a code binds to the account
 * that is named first, "This plan will belong to @name" (0.2.8, EVERY BIND
 * NAMES THE ACCOUNT). Confirmed before the entry opens, so a mistyped code is
 * said in the field and can be typed again, with no second confirm.
 */
function openCodeEntryPanel(): void {
    withAccountConfirm(openCodeEntryConfirmed);
}

function openCodeEntryConfirmed(): void {
    openCodeEntry(async text => {
        const result = await submitCode(text);
        // The 3-computer limit also gets its notice, which carries the GitHub link.
        if (result === UPGRADE_COPY.deviceLimit) showDeviceLimitNotice();
        return result;
    });
}

/** A promo code: uppercase letters and digits, 4 to 16 (never a license key or an slp_ code). */
const PROMO_RE = /^[A-Z0-9]{4,16}$/;

/** The one sentence for each /v1/redeem refusal. */
function redeemErrorCopy(errorCode: string | undefined): string {
    switch (errorCode) {
        case "claimed": return UPGRADE_COPY.codeClaimed;
        case "not_found": return UPGRADE_COPY.codeNotFound;
        case "already": return UPGRADE_COPY.codeAlready;
        case "rate_limited": return UPGRADE_COPY.codeRateLimited;
        case "net_limited": return UPGRADE_COPY.codeNetLimited;
        case "device_limit": return UPGRADE_COPY.deviceLimit;
        case "not_linked": return UPGRADE_COPY.notLinked;
        case "account_too_new": return UPGRADE_COPY.accountTooNew;
        case "code_on_other_account": return UPGRADE_COPY.codeOnOtherAccount;
        case "code_in_use": return UPGRADE_COPY.codeInUse;
        default: return UPGRADE_COPY.codeUnreachable;
    }
}

/**
 * "Enter a code". A promo code (a server's code) is redeemed for this install
 * and the Subline code the relay mints is saved. Anything else is taken as a
 * license key or a Subline code: it is checked with the relay first and saved
 * only if it owns something. Resolves null when it worked, else the sentence
 * to show.
 */
async function submitCode(typed: string): Promise<CodeSubmitResult> {
    const text = typed.trim();
    if (text === "") return UPGRADE_COPY.codeEmpty;
    let install: string;
    try {
        install = tasteBearer(await installIdOnce());
    } catch {
        return UPGRADE_COPY.codeUnreachable;
    }
    const promo = text.toUpperCase();
    if (PROMO_RE.test(promo)) return redeemPromo(promo, install);
    // CHECK FIRST, LINK AFTER. A typed code is only checked (x-subline-check:
    // nothing is linked, no computer slot is used), and linked only when it
    // owns something. The account it joins was confirmed before the code
    // entry opened (openCodeEntryPanel), so it is not asked again. A mistyped
    // code, or someone else's, never takes one of an account's computers.
    let check: Awaited<ReturnType<typeof transport.relayStatus>>;
    try {
        check = await transport.relayStatus(text, install, { check: true });
    } catch {
        return UPGRADE_COPY.codeUnreachable;
    }
    const refused = statusRefusalCopy(check);
    if (refused !== null) return refused;
    if (!check.ok || typeof check.automatic !== "boolean") return UPGRADE_COPY.codeUnreachable;
    if (check.linked === false) return notLinkedAnswer();
    const valid = check.check !== undefined
        ? check.check.valid && (check.check.automatic || check.check.ai)
        : check.automatic || check.ai === true;
    if (!valid) return UPGRADE_COPY.codeNotFound;
    return linkTypedCode(text, install);
}

/** A promo code (a server's code): redeem it for this install and save the code the relay mints. */
async function redeemPromo(promo: string, install: string): Promise<string | null> {
    {
        let res: Awaited<ReturnType<typeof transport.relayRedeem>>;
        try {
            res = await transport.relayRedeem(install, promo);
        } catch {
            return UPGRADE_COPY.codeUnreachable;
        }
        // Another Discord account signed in meanwhile: not this one's code.
        if (!stillInstall(install)) return UPGRADE_COPY.codeUnreachable;
        if (!res.ok) {
            // "Already yours": this install owns it already, so ask what it owns.
            // Not linked: asking again puts the Link bar up.
            if (res.errorCode === "already" || res.errorCode === "not_linked") void refreshEntitlement();
            return redeemErrorCopy(res.errorCode);
        }
        adoptCode(res.code);
        await refreshEntitlement();
        if (!activated()) return UPGRADE_COPY.codeUnreachable;
        announcePurchase();
        return null;
    }
}

/** The sentence for a status call the relay refused, or null when it did not refuse. */
function statusRefusalCopy(res: Awaited<ReturnType<typeof transport.relayStatus>>): string | null {
    if (res.ok) return null;
    if (res.errorCode === "device_limit") return UPGRADE_COPY.deviceLimit;
    if (res.errorCode === "code_on_other_account") return UPGRADE_COPY.codeOnOtherAccount;
    if (res.errorCode === "code_in_use") return UPGRADE_COPY.codeInUse;
    if (res.errorCode === "not_linked") return notLinkedAnswer();
    return UPGRADE_COPY.codeUnreachable;
}

/** The relay said "link first" to a code: say so, and ask again (the Link bar follows). */
function notLinkedAnswer(): string {
    void refreshEntitlement();
    return UPGRADE_COPY.notLinked;
}

/** Is `install` still the signed-in account's install bearer? (A switch may have come in between.) */
function stillInstall(install: string): boolean {
    const id = knownInstallId();
    return id !== null && tasteBearer(id) === install;
}

/** The reader confirmed a checked code: link it to this computer and save it. */
async function linkTypedCode(text: string, install: string): Promise<string | null> {
    let res: Awaited<ReturnType<typeof transport.relayStatus>>;
    try {
        res = await transport.relayStatus(text, install);
    } catch {
        return UPGRADE_COPY.codeUnreachable;
    }
    // Another Discord account signed in meanwhile: nothing is saved for it.
    if (!stillInstall(install)) return UPGRADE_COPY.codeUnreachable;
    const refused = statusRefusalCopy(res);
    if (refused !== null) return refused;
    if (!res.ok || typeof res.automatic !== "boolean") return UPGRADE_COPY.codeUnreachable;
    if (res.linked === false) return notLinkedAnswer();
    if (!res.automatic && res.ai !== true) return UPGRADE_COPY.codeNotFound;
    const before = entitlementLevel();
    // Typed by the reader, so it wins even over a code they once cleared.
    if (text === settings.store.clearedPurchaseCode) settings.store.clearedPurchaseCode = "";
    applyStatus({ ...res, code: text });
    if (before !== entitlementLevel()) onEntitlementChanged();
    announcePurchase();
    return null;
}

function tasteLog(message: string): void {
    if (settings.store.debugLogging) logger.debug(`[plan] ${message}`);
}

/**
 * The status call is retried until the relay answers: 5s, 15s, 60s, then every
 * 5 minutes. Separately, a running install asks again every 24 hours, so an
 * online install always holds a fresh answer and never reaches the offline
 * limit (entitlement.ts).
 */
const STATUS_RETRY_MS = [5_000, 15_000, 60_000];
const STATUS_RETRY_EVERY_MS = 5 * 60_000;
let statusRetryTimer: ReturnType<typeof setTimeout> | null = null;
let statusAttempts = 0;
/** Bumped by stop(), so a status reply from a stopped session changes nothing. */
let statusSession = 0;
let entitlementTimer: ReturnType<typeof setInterval> | null = null;

/**
 * THE ENTITLEMENT CLOCK. A 24-hour setInterval used to be the only re-check,
 * and two things slipped past it:
 *   - the stored answer running out while Discord runs (the AI renewal
 *     moment: aiUntil is the billing date, and the relay only moves it when
 *     the renewal lands), which turned a paying subscriber's ✦ off for up to
 *     a day, every month;
 *   - a laptop asleep for a week: timers do not count sleep, the wall clock
 *     does, so the answer expired and nothing noticed for a day of awake time.
 * Now a one-minute tick reads the WALL CLOCK: it asks the relay when 24 hours
 * have passed since the last ask, just before the stored answer runs out,
 * and at once after a sleep. A level that changed on its own (time passed)
 * redraws the screen without waiting for any answer.
 */
const ENTITLEMENT_TICK_MS = 60_000;
/** A tick this late means the machine was asleep. */
const ENTITLEMENT_WAKE_GAP_MS = 5 * 60_000;
/** Asked this long before the stored answer runs out. */
const ENTITLEMENT_EXPIRY_LEAD_MS = 60_000;
/** Back online or back in focus asks again, at most this often. */
const ENTITLEMENT_NUDGE_MS = 10 * 60_000;
/** After AI lapses: ask again on this ladder, so a late renewal is picked up in minutes. */
const RENEWAL_FOLLOW_UPS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

let lastStatusAskAt = 0;
let lastEntitlementTickAt = 0;
let lastTickLevel: Level | null = null;
let renewalFollowUp: { step: number; at: number; } | null = null;
/** The expiry point the tick already asked about (see entitlementTick). */
let askedForExpiry: number | null = null;
let entitlementNudge: (() => void) | null = null;

/** When the stored answer (or its AI part) runs out, or null. */
function entitlementExpiry(): number | null {
    const e = getEntitlement();
    if (e === null) return null;
    const ai = e.ai && typeof e.aiUntil === "number" ? e.aiUntil : Number.POSITIVE_INFINITY;
    const at = Math.min(e.tokenExpiresAt, ai);
    return Number.isFinite(at) ? at : null;
}

/** AI just went away: start (or keep) the follow-up ladder. AI back: stop it. */
function noteLevelForRenewal(before: Level, after: Level, now: number): void {
    if (after === "ai") renewalFollowUp = null;
    else if (before === "ai" && renewalFollowUp === null) renewalFollowUp = { step: 0, at: now + RENEWAL_FOLLOW_UPS_MS[0]! };
}

function entitlementTick(now: number = Date.now()): void {
    const woke = lastEntitlementTickAt !== 0 && now - lastEntitlementTickAt > ENTITLEMENT_WAKE_GAP_MS;
    lastEntitlementTickAt = now;
    const level = entitlementLevel(now);
    if (lastTickLevel !== null && level !== lastTickLevel) {
        noteLevelForRenewal(lastTickLevel, level, now);
        onEntitlementChanged();
    }
    lastTickLevel = level;

    const checkedAt = getEntitlement()?.checkedAt ?? 0;
    const expiry = entitlementExpiry();
    let due = woke || now >= Math.max(checkedAt, lastStatusAskAt) + ENTITLEMENT_REFRESH_MS;
    // Once per expiry point: an answer that moved it (a renewal) arms it again.
    if (expiry !== null && now >= expiry - ENTITLEMENT_EXPIRY_LEAD_MS && askedForExpiry !== expiry) {
        askedForExpiry = expiry;
        due = true;
    }
    if (renewalFollowUp !== null && now >= renewalFollowUp.at) {
        const step = renewalFollowUp.step + 1;
        renewalFollowUp = step < RENEWAL_FOLLOW_UPS_MS.length ? { step, at: now + RENEWAL_FOLLOW_UPS_MS[step]! } : null;
        due = true;
    }
    if (due) void refreshEntitlement();
    // The last day can begin, and a period end, with no answer at all.
    checkPlanMessages("change");
}

/** Back online, or Discord back in focus: ask again, at most every 10 minutes. */
function nudgeEntitlement(): void {
    const now = Date.now();
    if (now - lastStatusAskAt < ENTITLEMENT_NUDGE_MS) return;
    entitlementTick(now);
    if (now - lastStatusAskAt >= ENTITLEMENT_NUDGE_MS) void refreshEntitlement();
}

function startEntitlementClock(): void {
    lastEntitlementTickAt = Date.now();
    lastTickLevel = entitlementLevel();
    entitlementTimer = setInterval(() => entitlementTick(), ENTITLEMENT_TICK_MS);
    try {
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            entitlementNudge = () => {
                nudgeEntitlement();
                // The 🌐 choices and settings changed on another computer meanwhile (at most every 10 minutes).
                channelSyncFocus();
                prefSyncFocus();
            };
            window.addEventListener("online", entitlementNudge);
            window.addEventListener("focus", entitlementNudge);
        }
    } catch { /* the tick alone still covers it */ }
}

function stopEntitlementClock(): void {
    if (entitlementTimer !== null) clearInterval(entitlementTimer);
    entitlementTimer = null;
    try {
        if (entitlementNudge !== null && typeof window !== "undefined") {
            window.removeEventListener("online", entitlementNudge);
            window.removeEventListener("focus", entitlementNudge);
        }
    } catch { /* nothing to undo */ }
    entitlementNudge = null;
    lastStatusAskAt = 0;
    lastEntitlementTickAt = 0;
    lastTickLevel = null;
    renewalFollowUp = null;
    askedForExpiry = null;
}

function scheduleStatusRetry(): void {
    if (statusRetryTimer !== null) return;
    const delay = STATUS_RETRY_MS[statusAttempts] ?? STATUS_RETRY_EVERY_MS;
    statusAttempts++;
    statusRetryTimer = setTimeout(() => {
        statusRetryTimer = null;
        void refreshEntitlement();
    }, delay);
}

function clearStatusRetry(): void {
    if (statusRetryTimer !== null) clearTimeout(statusRetryTimer);
    statusRetryTimer = null;
    statusAttempts = 0;
}

/**
 * Ask the relay what this install owns (v2 /v1/status), and act on it: save a
 * linked code, switch the session on or off, take the activation notice down
 * or put it up. Never awaited by anything the reader is waiting on, except
 * "Enter a code". A relay that cannot be reached leaves the stored answer in
 * charge until it runs out (entitlement.ts), and is asked again soon.
 * Resolves whether the relay answered (false: unreachable, or this account
 * was left meanwhile).
 */
async function refreshEntitlement(): Promise<boolean> {
    const session = statusSession;
    let answered = false;
    lastStatusAskAt = Date.now();
    try {
        const { credential, install } = await relayCredentials();
        // While this install does not own Automatic, say whether it was used
        // before 0.2.0 (taste.ts priorUseHint). The relay checks it against
        // its own records; it never trusts it alone.
        const prior = await priorUseHint(settings.store.freeTrialStartedAt);
        const res = await transport.relayStatus(credential, install, prior ? { prior: true } : undefined);
        if (session !== statusSession) return false;
        // Linked, on the install id from before: whose it is first (account.ts rule 3).
        // Another account's: answered, and this account gets an id of its own.
        if (res.ok && res.linked === true && !(await linkedLegacyIsMine())) return true;
        if (session !== statusSession) return false;
        if (res.ok) {
            answered = true;
            takeStatusAnswer(res, prior);
            // A dead code was dropped and nothing replaced it: ask again for
            // this install alone (its bearer is then the install id).
            if (res.deadCode !== undefined && credential !== install && savedCode() === "") void refreshEntitlement();
        } else if (res.errorCode === "device_limit") {
            // Not a network fault: this code is on 3 other computers already.
            // (A v2 status never answers 401 for a dead code: it answers 200
            // with `deadCode`, handled in applyStatus.)
            answered = true;
            clearStatusRetry();
            takeDownCheckingNotice();
            const before = entitlementLevel();
            setEntitlement(null);
            // The 3-computer limit: its own notice, with the GitHub link, and
            // never the buy panel.
            showDeviceLimitNotice();
            if (before !== "none") onEntitlementChanged();
            tasteLog(`the relay refused this install (${res.errorCode})`);
        } else if ((res.errorCode === "code_on_other_account" || res.errorCode === "code_in_use") && credential !== install && credential === savedCode()) {
            // The saved code is linked to ANOTHER Discord account (409), or its
            // plan is held by another computer that has not linked yet (409
            // code_in_use, a key shared on 0.2.5): it is not this account's
            // plan now. It is taken off this account (not as "cleared by hand";
            // the plan still has it, and the relay hands it back once it is
            // this account's), and the relay is asked again for this install alone.
            answered = true;
            // A key this account moved away itself (Move my plan): no alarm, it simply goes.
            if (res.moved !== true) sayResult(res.errorCode === "code_in_use" ? UPGRADE_COPY.codeInUse : UPGRADE_COPY.codeOnOtherAccount, "failure");
            dropRefusedCode(res.errorCode);
            void refreshEntitlement();
        } else {
            tasteLog(`what this install owns is unknown: ${res.error}`);
            await showUnreachableNotice(prior);
        }
    } catch {
        tasteLog("what this install owns is unknown: the status call did not complete");
        if (session === statusSession) await showUnreachableNotice(await priorUseHint(settings.store.freeTrialStartedAt).catch(() => false));
    }
    if (!answered && session === statusSession) scheduleStatusRetry();
    if (session === statusSession) checkPlanAtStart();
    return answered;
}

/**
 * The saved code is not this Discord account's plan now (409
 * code_on_other_account / code_in_use, from a status call or named by a link
 * answer). It is taken off this account, not as "cleared by hand": the plan
 * still has it, and the relay hands it back once it is this account's.
 */
function dropRefusedCode(why: string): void {
    logger.warn(`The saved code was taken off this account (${why}).`);
    lastSeenCode = "";
    settings.store.sublineCode = "";
    currentHolderNow();
}

/**
 * Take in a good status answer (from /v1/status, or /v1/link, which answers
 * the same way): what the install owns, the notices, "You're on.".
 */
function takeStatusAnswer(res: Extract<Awaited<ReturnType<typeof transport.relayStatus>>, { ok: true; }>, prior: boolean): void {
    clearStatusRetry();
    deviceLimited = false;
    // The hint stops once Automatic is here. A plain automatic:false to
    // a hinted request is the relay's definitive no: the early-user
    // check is over and the activation notice follows.
    if (res.automatic === true) markPriorHintDone();
    else if (prior && typeof res.automatic === "boolean") endEarlyCheck();
    takeDownCheckingNotice();
    const before = entitlementLevel();
    const saved = applyStatus(res);
    noteLevelForRenewal(before, entitlementLevel(), Date.now());
    lastTickLevel = entitlementLevel();
    if (saved || before !== entitlementLevel()) onEntitlementChanged();
    else if (!activated()) showActivationNotice();
    // Not linked (API 3): the Link bar, whatever else this answer changed,
    // and even with a saved code (it counts for nothing until linked).
    if (linkNeeded()) showActivationNotice();
    // A prior payer still to link: the bar that asks. Linked: gone.
    showMustLinkBar();
    // Linked: this computer remembers the account's name and plan (local only).
    rememberCurrentAccount();
    // Linked: the 🌐 choices follow the account (channelSync.ts). Not linked:
    // they stay on this computer, exactly as before. The same for Subline's settings.
    followChannelChoices();
    followPrefs();
    // "You're on." only when this answer RAISED what the install
    // owns (or granted the early Automatic). Losing AI also adopts a
    // code (the account's Automatic one), and that reader must not be
    // told they are on.
    if ((saved && levelRank(entitlementLevel()) > levelRank(before)) || res.grant === "early") announcePurchase();
    // The hidden daily ceiling, as the status says it: the same one notice
    // as a refused translation (decision 5), never a number.
    if (aiOn() && getEntitlement()?.access?.paused === true) showPausedNotice();
    checkPlanMessages("change");
    tasteLog(`the relay says: ${entitlementLevel()}, ${linkState()}`);
}

/**
 * Relay refusals that are about what this install owns, not about the network.
 * code_on_other_account / code_in_use: the saved code's plan is now on
 * another Discord account, or held by another computer; the status answer
 * that follows takes the code off this one.
 */
const ENTITLEMENT_REFUSAL_CODES: readonly string[] = ["not_activated", "ai_required", "device_limit", "not_linked", "code_on_other_account", "code_in_use"];
function isEntitlementRefusal(code: string | undefined): boolean {
    return code !== undefined && ENTITLEMENT_REFUSAL_CODES.includes(code);
}

/* ------------------------------------------------- LLM cooldown / fallback -- */

/**
 * Used only when a 429 arrives with no usable retry hint at all. Every real
 * Gemini 429 observed so far states its own delay in the error body, and
 * native.ts already substitutes 30s when an engine offers nothing, so this is
 * a third line of defence rather than the normal case.
 */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Per-engine "do not send to this engine before <timestamp>".
 *
 * A TIMESTAMP, not a flag and not a timer: expiry is then a comparison that
 * every flush does for itself, so the engine resumes automatically the first
 * time a batch becomes due after the window closes. Nothing has to fire, be
 * cancelled on stop(), or be restarted by the user.
 *
 * Per engine rather than global because switching Gemini → Claude mid-cooldown
 * should use Claude immediately; Claude's quota has nothing to do with
 * Gemini's.
 *
 * PERSISTED (see cooldownStore.ts) rather than held only in module state: a
 * restart used to clear the mark, so every Discord launch inside a rate-limit
 * window spent a request rediscovering the limit and greeted the user with a
 * rate-limit toast before showing them anything.
 */
function isCoolingDown(engine: EngineId): boolean {
    return Date.now() < cooldownUntil(engine);
}

/**
 * "0:45" / "1:05" — a live countdown in the ⚡ label, so this has to read as
 * counting DOWN rather than as a coarse "about how long" estimate.
 */
function formatCountdown(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * "Would an ⚡ click actually go through right now, for this engine — and if
 * not, for how long?" The single source both the chat-bar quota indicator and
 * the ⚡ popover label read from, so the two can never disagree about what
 * pressing ⚡ is about to do.
 *
 * WHAT CHANGED, AND WHY: this used to answer with a COUNT — how many requests
 * the plugin's own rate gate happened to be holding. A reader who did not
 * build this plugin has no way to know that number is an internal pacing
 * budget rather than the provider's own quota, and read `✦ 3` as "3 calls
 * remaining" — a reasonable reading of the glyph and number, and wrong. A
 * count also implies rationing, and on a generous quota there is nothing to
 * ration. What the reader can actually act on is READINESS: would ⚡ send
 * right now, and if not, how long until it would. That is what this returns.
 *
 * COOLDOWN TAKES PRIORITY on purpose: the rate gate can still be holding
 * tokens while the engine itself is parked after a 429 (the two are
 * independent — see `runTier`'s cooldown check, which runs BEFORE the gate is
 * ever asked), and "ready" would tell the user ⚡ works when clicking it would
 * actually do nothing.
 *
 * Otherwise readiness is the rate gate's: `rateGateAvailable()` is a PURE
 * read of the gate the relay's requests actually go through. (A provider's
 * own remaining count was a second limit for the bring-your-own-key Groq
 * engine; the relay reports none.)
 */
function describeQuotaState(
    engine: EngineId
): { cooling: true; remainingMs: number }
    | { cooling: false; ready: true }
    | { cooling: false; ready: false; remainingMs: number } {
    const remainingMs = cooldownUntil(engine) - Date.now();
    if (remainingMs > 0) return { cooling: true, remainingMs };
    if (rateGateAvailable() > 0) return { cooling: false, ready: true };
    return { cooling: false, ready: false, remainingMs: rateGateWaitMs() };
}

/**
 * A 429 from an LLM engine. Three things happen, in this order:
 *
 *  1. The engine is parked for as long as the API itself asked for. Retrying
 *     into a wall that just rejected us is how roughly half the observed API
 *     traffic became 429s; the point of this phase is to stop doing that.
 *  2. The rate gate is retuned if the response stated the real quota. See
 *     rateGate.ts — this is what stops the SAME 429 recurring once the
 *     cooldown lifts, so the cooldown stays close to what the API asked for
 *     rather than a padded guess. It is floored at the gate's refill interval
 *     (see below): the API's sub-second hint frees exactly one slot, which is
 *     not enough to be worth waking up for.
 *  3. The user is told, at most once per session, when the wait is long.
 *
 * The batch that triggered this is NOT lost: runTier marks its messages ⏳
 * and the channel's retry asks again just after the cooldown ends.
 */
function enterCooldown(
    engine: EngineId,
    retryAfterMs: number | undefined,
    quotaLimitPerMinute: number | undefined,
    // The engine's own error text, ONLY so the announcement can tell the
    // relay's daily allowance apart from an ordinary minute of throttling:
    // they arrive as the same 429 and have opposite remedies (wait / come back
    // tomorrow). Nothing else reads it, and it never reaches the DOM.
    errorText?: string
): void {
    const asked = typeof retryAfterMs === "number" && retryAfterMs > 0
        ? retryAfterMs
        : DEFAULT_COOLDOWN_MS;

    // Retune BEFORE flooring: the floor below is read off the gate, so a
    // response that states its quota should size the floor using the rate it
    // just taught us, not the one we were using when we broke it.
    if (typeof quotaLimitPerMinute === "number") {
        tuneRateGateToObservedLimit(quotaLimitPerMinute);
    }

    // The API's hint answers "when does ONE slot free up?" — 551ms in the
    // captured response, because that is when the oldest request ages out of
    // its rolling window. Taken literally that means: wait half a second, get
    // exactly one request through, and be rejected again. Repeated every
    // debounce window, that is the 429 treadmill this phase exists to stop.
    //
    // The floor is the gate's own refill interval rather than a constant,
    // because a cooldown shorter than that cannot change what actually
    // happens — the gate would withhold the token anyway — and because it
    // then tracks the retune above instead of needing its own tuning. The
    // retune is still what fixes the steady state; this only stops us
    // spending requests to relearn that during the transient.
    const cooldownMs = Math.max(asked, rateGateSettings().refillMs);
    setCooldown(engine, Date.now() + cooldownMs);

    announceCooldownOnce(cooldownMs, isDailyLimit(errorText), isMonthlyLimit(errorText));
}

/**
 * Did the relay say the DAY's allowance is gone, rather than this minute's?
 *
 * The relay answers both with 429. The daily one carries "daily limit reached"
 * and a `retryAfterMs` that runs to UTC midnight, so the ordinary "back in
 * about <duration>" wording would tell somebody at 9am to wait about 15h,
 * which reads as a broken plugin rather than a used-up allowance.
 */
function isDailyLimit(errorText: string | undefined): boolean {
    return typeof errorText === "string" && /daily limit reached/i.test(errorText);
}

/** The relay's optional monthly AI allowance is spent ("monthly limit reached"). */
function isMonthlyLimit(errorText: string | undefined): boolean {
    return typeof errorText === "string" && /monthly limit reached/i.test(errorText);
}

/**
 * A pause is not a failure, and must not be dressed as one.
 *
 * A 429 used to raise a RED toast saying "rate limited" for what is usually a
 * few seconds of waiting. Red means broken; ordinary users read it as the
 * plugin dying, on a pause that resolves itself before they finish reading the
 * sentence. So:
 *
 *  - THE RELAY BUSY (a per-minute 429, however long): SILENT. It is not the
 *    reader's to act on. The messages wear ⏳, ✦ resumes by itself, and the
 *    ⚡ label counts down for anybody who wants it.
 *  - THE DAY'S OR THE MONTH'S ALLOWANCE GONE (relay 429, "daily limit
 *    reached" / "monthly limit reached"): waiting a few seconds is not the
 *    remedy, so one neutral note says when ✦ is back.
 *  - The hidden daily ceiling (429 ai_paused) has its own notice, see
 *    showPausedNotice.
 *
 * Whatever is shown is shown ONCE per session: a catch-up storm can enter
 * cooldown on several batches in a row, and a toast per batch would be worse
 * than the problem it describes.
 */
function announceCooldownOnce(_cooldownMs: number, dailyLimit = false, monthlyLimit = false): void {
    let message: string;
    if (dailyLimit) message = "Today's ✦ translations are used up. ✦ is back tomorrow.";
    else if (monthlyLimit) message = "This month's ✦ translations are used up. ✦ is back next month.";
    // P9: Subline's own relay busy is not the reader's to act on.
    else return;

    if (announcedCooldown) return;
    announcedCooldown = true;
    toast(message, "info");
}

/**
 * THE HIDDEN DAILY CEILING (0.2.9, spec decision 5). The relay answered 429
 * ai_paused: this account's ✦ for today is spent (or no new period may start
 * from this address today). One plain notice says so, never a number, never
 * silent, and at most once a UTC day: the relay is not asked again until its
 * wait (UTC midnight) is over, so nothing repeats it meanwhile.
 */
let pausedNoticeDay = "";

function showPausedNotice(): void {
    const day = new Date().toISOString().slice(0, 10);
    if (pausedNoticeDay === day) return;
    pausedNoticeDay = day;
    putNotice("paused", UPGRADE_COPY.aiPaused, UPGRADE_COPY.aiPausedButton, () => takeNotice("paused"));
}

/* ------------------------------------------------- the plan messages -- */

/*
 * ONLY TWO MESSAGES PER PERIOD, EACH ONCE (0.2.9 spec, decision 12), and the
 * update panel once (decision 13). planState.ts decides what is due; this is
 * when, and the memory of what was shown:
 *
 *  - the last-day notice ("Your AI translation ends tomorrow." Subscribe /
 *    Later): a notice, whenever the plan is looked at (a relay answer, the
 *    minute tick, a channel switch);
 *  - the ended panel: a window, so only at a channel switch or the start
 *    (the first relay answer of the session, or its failure: by the clock a
 *    period that ended while Discord was closed is ended offline too), and
 *    never while the reader is typing (then it waits for the next switch);
 *  - the update panel: a window, once per computer, at the first start of
 *    0.2.9 whose answer says which of the four texts is true.
 *
 * What was shown is kept per computer and per Discord account (by period),
 * so two computers each show it once, and a second account on this computer
 * has its own. None of it depends on the ✦ button being on screen.
 */
export const PLAN_NOTES_KEY = "VcTranslate_planNotes";
export const UPDATE_PANEL_KEY = "VcTranslate_updatePanel029";
/** A key pressed this recently in a text field is typing: no window then. */
const TYPING_MS = 3_000;

let planNotes: PlanNotes = emptyNotes();
/** Where this account's notes are stored, once read (null: not read yet, nothing is shown). */
let planNotesKey: string | null = null;
/** The read asked for last (an account switch during a read wins). */
let planNotesWanted: string | null = null;
/** Whether the update panel was shown on this computer; null until read. */
let updatePanelShown: boolean | null = null;
/** The session's first look at the plan (the "next start") has happened. */
let planStartChecked = false;
/** Between start() and stop(): the plan messages may show. */
let planMessagesOn = false;
let lastKeyAt = 0;
let keyListener: ((e: unknown) => void) | null = null;

async function loadPlanNotes(key: string): Promise<void> {
    planNotesWanted = key;
    planNotesKey = null;
    let read: PlanNotes;
    try {
        read = notesFrom(await DataStore.get<unknown>(key));
    } catch {
        read = emptyNotes();
    }
    if (planNotesWanted !== key) return;
    planNotes = read;
    planNotesKey = key;
}

function notePlan(which: keyof PlanNotes, id: string): void {
    const key = planNotesKey;
    if (key === null) return;
    planNotes = withNote(planNotes, which, id);
    void DataStore.set(key, planNotes).catch(() => { });
}

/** The reader is typing in a text field right now (a key in the last 3 s, with the focus in one). */
function typingNow(): boolean {
    if (Date.now() - lastKeyAt >= TYPING_MS) return false;
    try {
        const el = (globalThis as any).document?.activeElement as { tagName?: string; isContentEditable?: boolean; } | null | undefined;
        if (!el) return false;
        return el.isContentEditable === true || el.tagName === "TEXTAREA" || el.tagName === "INPUT";
    } catch {
        return false;
    }
}

function listenForTyping(on: boolean): void {
    try {
        const doc = (globalThis as any).document;
        if (typeof doc?.addEventListener !== "function") return;
        if (keyListener !== null) doc.removeEventListener("keydown", keyListener, true);
        keyListener = null;
        if (!on) return;
        keyListener = () => { lastKeyAt = Date.now(); };
        doc.addEventListener("keydown", keyListener, true);
    } catch { /* no typing guard: the windows still come only at a switch or the start */ }
}

/** "Your AI translation ends tomorrow." with Subscribe, and "Later" inline (a notice has one button). */
function showLastDayNotice(): void {
    const later = () => takeNotice("plan");
    const display = (
        <span>
            {PLAN_COPY.lastDay}{" "}
            <a
                role="button"
                onClick={later}
                style={{ marginLeft: 6, textDecoration: "underline", cursor: "pointer", color: "inherit" }}
            >
                {PLAN_COPY.later}
            </a>
        </span>
    );
    putNotice("plan", PLAN_COPY.lastDay, PLAN_COPY.subscribe, () => {
        takeNotice("plan");
        openUpgradeForLevel();
    }, false, display);
}

function openWhatsNew(): void {
    (globalThis as any).VencordNative?.native?.openExternal?.(WHATS_NEW_URL);
}

/** The update panel, if it is due and its text is known. True when it opened. */
function maybeShowUpdatePanel(): boolean {
    if (updatePanelShown !== false) return false;
    // ✦ on for this account and this code: the answer is about this reader.
    if (entitlementLevel() !== "ai") return false;
    const text = updateTextFor(getEntitlement()?.access);
    if (text === null) return false;
    if (!openUpdatePanel(text, openWhatsNew)) return false;
    updatePanelShown = true;
    void DataStore.set(UPDATE_PANEL_KEY, true).catch(() => { });
    return true;
}

/**
 * Look at the plan and show what is due (see above). `trigger`: "start"
 * (the session's first look), "switch" (a channel switch) or "change" (a
 * relay answer, the minute tick). Never throws.
 */
function checkPlanMessages(trigger: "start" | "switch" | "change"): void {
    if (!planMessagesOn || planNotesKey === null) return;
    try {
        const view = currentPlanView();
        // The last-day notice is about a running period: gone once it is not.
        if (view.state !== "period") takeNotice("plan");
        if (lastDayDue(view, planNotes)) {
            notePlan("lastDay", view.periodId!);
            showLastDayNotice();
        }
        if (typingNow()) return;
        if (maybeShowUpdatePanel()) return;
        if ((trigger === "start" || trigger === "switch") && endedDue(view, planNotes)) {
            const opened = openEndedPanel(view.periodDays ?? NEW_DAYS_FALLBACK, plan => withAccountConfirm(() => startCheckout(plan)));
            if (opened) notePlan("ended", view.periodId!);
        }
    } catch (e) {
        logger.warn(`the plan messages failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** The session's first look at the plan, once (after the first relay answer, or its failure). */
function checkPlanAtStart(): void {
    if (planStartChecked || !planMessagesOn || planNotesKey === null) return;
    planStartChecked = true;
    checkPlanMessages("start");
}

/**
 * Is this the channel the user is actually looking at?
 *
 * DEFINITION: "focused" means `SelectedChannelStore.getChannelId()` equals this
 * channel id AT THE MOMENT THE MESSAGE ARRIVES. Nothing is remembered, nothing
 * is debounced — a message that lands one tick after the user navigates away is
 * simply not enqueued.
 *
 * NOT HANDLED, deliberately: popped-out channels and second Discord windows.
 * SelectedChannelStore reports one id for the main window, so a message in a
 * popped-out channel the user is genuinely reading reads as unfocused here.
 * The cost of being wrong is bounded and small: that message is translated
 * LATER (when the channel is next opened and catch-up runs over the backlog),
 * never NEVER. Detecting popouts would mean depending on more Discord
 * internals than this is worth.
 *
 * This is intentionally orthogonal to `channelActive`: globalAuto decides WHICH
 * channels are eligible at all, focus decides which eligible channel is worth
 * spending the day's budget on right now. A restart with globalAuto on used to
 * fan catch-up out across every open channel before the user had read a single
 * message — the single largest source of wasted requests.
 */
function isFocusedChannel(channelId: string): boolean {
    return SelectedChannelStore.getChannelId() === channelId;
}

/**
 * Does globalAuto cover this channel, so that it is on unless opted out?
 *
 * globalAuto means "every server channel I read", not "every private
 * conversation I have". Translating a public channel is a decision the user
 * makes for a room where everyone can already read everything; shipping a DM
 * to a third-party endpoint is a materially different one, and the spec puts
 * DMs out of scope. DMs and group DMs have no guild_id.
 */
function coveredByGlobalAuto(channelId: string): boolean {
    if (!settings.store.globalAuto) return false;
    const channel = ChannelStore.getChannel(channelId);
    return Boolean(channel?.guild_id);
}

function channelActive(channelId: string): boolean {
    // Nothing paid for: no channel translates.
    if (!activated()) return false;
    // A covered server channel is on unless the user switched it off here.
    if (coveredByGlobalAuto(channelId)) return !isChannelDisabled(channelId);
    // Anything else (globalAuto off, or a DM) is on only by explicit opt-in.
    return isChannelEnabled(channelId);
}

/** A short, human-readable description of a stored entry, for debug logging only. */
function describeStoredForLog(e: StoredTranslation | undefined): string {
    if (e === undefined) return "‹none›";
    if (isRealTranslation(e)) return `${e.via}:${JSON.stringify(e.text)}`;
    if ("skipped" in e) return `skipped(${e.via ?? "unmarked"})`;
    if ("failed" in e) return "failed";
    return "deferred";
}

/**
 * Why mayReplace() refused a write, for debug logging only — mirrors its two
 * refusal branches exactly (see upgrade.ts). Only called once a refusal is
 * already known, so `existing` is guaranteed to be a real translation here:
 * that is the only case mayReplace() ever returns false for.
 */
function refuseReasonForLog(existing: StoredTranslation | undefined, next: StoredTranslation): string {
    const existingVia = (existing as { via: EngineId }).via;
    if (!isRealTranslation(next)) return `a marker cannot replace ${existingVia}'s real translation`;
    return `${next.via} (rank ${rankOf(next.via)}) cannot replace ${existingVia} (rank ${rankOf(existingVia)})`;
}

/**
 * The ONLY way an engine result reaches the store. Two tiers write to the same
 * key from different latencies, so every write has to ask whether it is
 * actually an improvement — see upgrade.ts.
 */
function writeResult(key: string, value: StoredTranslation): void {
    const existing = getTranslation(key);
    const allowed = mayReplace(existing, value);
    if (settings.store.debugLogging) {
        logger.debug(
            allowed
                ? `[write] ${key}: wrote ${describeStoredForLog(value)}`
                : `[write] ${key}: refused ${describeStoredForLog(value)} over `
                  + `${describeStoredForLog(existing)} — ${refuseReasonForLog(existing, value)}`
        );
    }
    if (allowed) {
        setTranslation(key, value);
        // The beacon counts translations that were actually ACCEPTED into the
        // store the subtitle reads from — not results received, and not markers.
        // A refused write produced nothing the reader will ever see, and
        // counting it would let a dead install (every LLM result refused, or
        // every batch a failure marker) still report translations. See
        // statusBeacon.ts. Never the text, never the id: only which tier.
        if (isRealTranslation(value)) {
            recordTranslation(value.via);
            // The weekly note counts a message ONCE: the first time a real
            // translation for it reaches the store. The ✦ line replacing its
            // ≈ line is the same message (see weeklyNote.ts).
            if (!isRealTranslation(existing)) {
                showWeeklyNoteIfDue();
                countShown(value.lang);
            }
        }
    }
}

/** "This week: N messages in M languages." At most once a week, never for an empty one. */
function showWeeklyNoteIfDue(): void {
    const note = closeWeekIfDue();
    if (note === null) return;
    toast(note, "info");
}

/**
 * Has ✦ still got something to contribute to this message?
 *
 * Only ✦'s own verdict closes a message: a ✦ translation, or a ✦ skip. A
 * marker (⏳ deferred, ⚠ failed) or no entry at all leaves it open, but only
 * while the attempt ledger does not already hold it: a request that reached
 * a verdict and produced no line must not be bought again on every channel
 * open — see `qualityAttempted`.
 */
function needsQuality(key: string): boolean {
    if (qualityAttempted.has(key)) return false;
    const e = getTranslation(key);
    if (e === undefined) return true;
    if (isRealTranslation(e)) return rankOf(e.via) < 1;
    if ("skipped" in e) return e.via === undefined || rankOf(e.via) < 1;
    return true;   // failed / deferred — another go
}

/** The same text, ignoring case and whitespace: a forced answer that changed nothing. */
export function sameText(a: string, b: string): boolean {
    const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, "");
    return norm(a) === norm(b);
}

/**
 * Does this message already show a real ✦ translation? Used only to decide
 * whether the ⚡ preview (one of the day's five, when ✦ is off) has anything
 * left to offer. A ✦ SKIP does not count (decision 3: a ⚡ press always gives
 * a translation): an automatic skip, from a period or from 0.2.8, is exactly
 * what a forced preview overrides. Deliberately free of the ledger: the
 * ledger bounds AUTOMATIC re-attempts, and ⚡ exists to override it.
 */
function hasQualityTranslation(key: string): boolean {
    const e = getTranslation(key);
    return e !== undefined && isRealTranslation(e) && rankOf(e.via) >= 1;
}

/**
 * Reduce a failed batch to one of the beacon's error codes.
 *
 * A REDUCTION, not a summary: `res.error` is remote text, so none of it
 * reaches the beacon. The codes separate the failures that mean materially
 * different things to someone reading the diagnostics.
 */
/** The HTTP status an engine's error text names, when it names one. */
function beaconErrorStatus(res: { error: string } | null): number | undefined {
    const match = res === null ? null : /\bHTTP (\d{3})\b/.exec(res.error);
    return match === null ? undefined : Number(match[1]);
}

function beaconErrorCode(res: { error: string } | null): BeaconErrorCode {
    if (res === null) return "ipc-failed";
    if (/\bHTTP 429\b/.test(res.error)) return "rate-limited";
    if (/\bHTTP 401\b/.test(res.error)) return "auth-rejected";
    // 403 is NOT an auth failure. It is the network, region or ISP being
    // refused before the code is ever looked at.
    if (/\bHTTP 403\b/.test(res.error)) return "access-blocked";
    return "engine-error";
}

/**
 * HOLDS WITHOUT ⏳. Two refusals mean "do not ask now, and do not say
 * translating": the relay refused on the plan (402 not_linked, ai_required,
 * not_activated...: ✦ is off, the plan state says so) and the hidden daily
 * ceiling (429 ai_paused: its own notice says so, showPausedNotice). Until the
 * hold ends nothing is sent, nothing is marked, and the open channel asks again
 * by itself when it ends (armDeferredRetry). A plan hold lifts at once when the
 * relay's answer about the plan changes (onEntitlementChanged).
 */
let planHeldUntil = 0;
let pausedUntil = 0;
/** After a refusal about the plan, ✦ waits this long before asking again (the status answer usually settles it first). */
export const PLAN_REFUSAL_HOLD_MS = 60_000;

/** The wait before ✦ may be asked again: the latest of a 429's cooldown and the holds above (epoch ms). */
function relayWaitUntil(): number {
    return Math.max(cooldownUntil(ENGINE), planHeldUntil, pausedUntil);
}

/**
 * NO VERDICT, SO NO CHARGE, AND A SIGN. These messages' request never got an
 * answer about them (no answer at all, a 5xx, a 429, the relay cooling down):
 * the ledger charge is given back so they may be asked again, each one with
 * no line yet wears the quiet ⏳ line (never over a real line, a skip, or
 * anything else that already says something), and the channel's retry is
 * armed. A forced (⚡) request writes nothing here: the click shows its own
 * hint for a few seconds.
 */
function deferMessages(ids: readonly string[], targetLang: string, channelId: string | undefined, forced: boolean): void {
    for (const id of ids) {
        const key = makeKey(id, targetLang);
        qualityAttempted.delete(key);
        if (forced) continue;
        const e = getTranslation(key);
        if (e === undefined || "failed" in e || "deferred" in e) writeResult(key, { deferred: true });
    }
    if (!forced && channelId !== undefined && ids.length > 0) {
        noteWaiting(channelId, ids);
        armDeferredRetry(channelId);
    }
}

/**
 * A hold (see planHeldUntil): the charge is given back, nothing is marked, and
 * the channel asks again when it ends. A ⏳ line already there goes, for these
 * messages and for every one already waiting in the channel: nothing is asked
 * during the hold (the hidden ceiling lasts until UTC midnight), so
 * "translating…" would not be true. They stay on the channel's waiting list.
 */
function holdMessages(ids: readonly string[], targetLang: string, channelId: string | undefined): void {
    for (const id of ids) {
        const key = makeKey(id, targetLang);
        qualityAttempted.delete(key);
        dropDeferred(key);
    }
    const waiting = channelId === undefined ? undefined : deferredChannels.get(channelId);
    if (waiting !== undefined) for (const id of waiting) dropDeferred(makeKey(id, targetLang));
    if (channelId !== undefined && ids.length > 0) {
        noteWaiting(channelId, ids);
        armDeferredRetry(channelId);
    }
}

/**
 * The relay answered for the request but not for this message (a `failed`
 * row, or no row at all: the model left it out). The FIRST time: ⏳ and asked
 * again (deferMessages). The second time it has had its chance: the ledger
 * keeps the charge, so catch-up does not buy it a third time, and the quiet
 * ⚠ line says it was not translated. ⚡, an edit or a restart asks again.
 * Nothing at all is written for a forced (⚡) request: the hint says it.
 */
function omittedMessage(id: string, targetLang: string, channelId: string | undefined, forced: boolean): void {
    if (forced) return;
    const key = makeKey(id, targetLang);
    if (noteOmitted(key)) {
        deferMessages([id], targetLang, channelId, false);
        return;
    }
    writeResult(key, { failed: true });
}

/**
 * One ✦ flush. 0.2.9 has one tier (the relay), so there is one
 * implementation, and every message's fate is decided here.
 *
 * NEVER BLANK FOR GOOD WITH NO SIGN (0.2.9). With ✦ the only engine there is
 * no readable line underneath to fall back on, so every way a request can end
 * leaves the message in a state that says what is happening and recovers by
 * itself:
 *  - a translation or a skip: written (the skip shows nothing: the message
 *    needs no translation);
 *  - no answer about the whole request (no answer, a 5xx, 403, 401, a 429, a
 *    cooldown): ⏳, the charge given back, and the channel asks again
 *    (deferMessages, armDeferredRetry), ever more slowly while it fails;
 *  - the model left one message out: ⏳ and asked once more, then a quiet ⚠
 *    (omittedMessage);
 *  - a refusal about the plan, or the hidden daily ceiling: nothing marked,
 *    nothing sent until the hold ends (planHeldUntil, pausedUntil);
 *  - a message edited meanwhile: its answer is dropped and it is asked again
 *    with the new text (editEpoch).
 * Failures stay quiet (no toast, no red), and a refusal of the code (401)
 * asks the relay what this install owns.
 *
 * Everything else is load-bearing: the generation guard runs both before and
 * after the network await, `enterCooldown` parks the engine on a 429, and the
 * `finally` releases the in-flight ids however the flush ended.
 */
async function runTier(
    req: BatchRequest, myGeneration: number,
    channelId?: string,
    // Manual-⚡-only: set by forceQualityTranslate so it can learn WHY this
    // flush produced nothing, in terms the reader can act on (see
    // ForcedHint's own doc). The batcher's onFlush leaves this undefined.
    report?: (outcome: ForcedHint) => void,
    // The edit counter of each message when its text was fixed (at flush).
    // Only a split passes it down, so a part sent later still compares
    // against the text it actually carries.
    epochs?: ReadonlyMap<string, number>,
    // G2: the parts of ONE long message (runLongMessage). Their rows go here
    // instead of the store, so only the whole message is ever written, and
    // runLongMessage decides that message's fate.
    sink?: (results: Result[]) => void
): Promise<void> {
    const debug = settings.store.debugLogging;
    // A forced (⚡) request or the parts of a long message write no markers:
    // the click and runLongMessage settle those messages themselves.
    const quiet = report !== undefined || sink !== undefined;
    // Every id this call was handed, released in the finally below whatever
    // the request ends up carrying (fitting may drop or split messages).
    const handedIds = req.messages.map(m => m.id);
    // Ids handed on to a smaller request, which releases them itself.
    const delegated = new Set<string>();
    // Edited after their text was fixed: their answer describes words that no
    // longer exist, so nothing is written for them and they are asked again.
    const sentEpoch = epochs ?? new Map(req.messages.map(m => [m.id, editEpoch.get(m.id) ?? 0]));
    const stale = new Set<string>();
    let sweepChannel: string | undefined;
    const isStale = (id: string) => {
        if ((editEpoch.get(id) ?? 0) === (sentEpoch.get(id) ?? 0)) return false;
        stale.add(id);
        return true;
    };
    const live = (ids: readonly string[]) => ids.filter(id => !isStale(id));

    if (debug) {
        logger.debug(`[flush] relay: batch of ${handedIds.length} — ids=${JSON.stringify(handedIds)}`);
    }

    try {
        // Superseded by a later rebuild (the plan or the reading language
        // changed) before this flush even started: drop it rather than send
        // under a stale configuration. The finally below still releases the
        // ids. Unreachable today (rebuildBatcher drains and disposes with no
        // await in between) and kept as defence in depth; the invariant is
        // pinned by "leaves no stale timer behind" in index.test.ts.
        if (myGeneration !== batcherGeneration) {
            if (debug) logger.debug("[flush] relay: blocked — stale generation (pre-gate)");
            report?.({ kind: "gate" });
            return;
        }

        // A hold (a refusal about the plan, the hidden ceiling): nothing is
        // sent and nothing is marked. See planHeldUntil.
        if (Date.now() < Math.max(planHeldUntil, pausedUntil)) {
            if (debug) logger.debug("[flush] relay: held — the relay refused on the plan or the daily ceiling");
            report?.({ kind: "cooldown" });
            if (!quiet) holdMessages(handedIds, req.targetLang, channelId);
            return;
        }

        // Cooling down after a 429: do not spend a request to be told so
        // again. The messages wear ⏳ and are asked again just after it.
        if (isCoolingDown(ENGINE)) {
            if (debug) {
                logger.debug(
                    "[flush] relay: blocked — cooling down for another "
                    + `${formatCountdown(cooldownUntil(ENGINE) - Date.now())}`
                );
            }
            report?.({ kind: "cooldown" });
            if (sink === undefined) deferMessages(handedIds, req.targetLang, channelId, report !== undefined);
            return;
        }

        // Fit the ✦ request inside what the relay accepts BEFORE it costs a
        // gate slot: a 413 or 400 is refused every time it is sent, and a long
        // message kept in the context ring poisoned every later batch in the
        // channel. Each part of a split goes through the gate on its own.
        req = withinTextLimit(req, channelId);
        // G2: a message still over the per-text limit is translated whole,
        // in parts, on its own (runLongMessage). Never cut to its start.
        if (sink === undefined) {
            const long = req.messages.filter(m => m.text.length > LLM_TEXT_MAX);
            if (long.length > 0) {
                // A reply to a long message keeps its parent: as a clipped
                // copy, since the parent goes out as "<id>~p<n>" rows.
                req = { ...req, messages: withParentCopies(req.messages.filter(m => m.text.length <= LLM_TEXT_MAX), req.messages) };
                for (const m of long) {
                    if (await runLongMessage(m, req, myGeneration, channelId, report, sentEpoch)) stale.add(m.id);
                }
            }
        }
        if (req.messages.length === 0) return;
        const parts = fitLlmRequest(req);
        if (parts.length > 1) {
            if (debug) logger.debug(`[flush] relay: request too large, split into ${parts.length}`);
            for (const part of parts) for (const m of part.messages) delegated.add(m.id);
            for (const part of parts) await runTier(part, myGeneration, channelId, report, sentEpoch, sink);
            return;
        }
        req = parts[0]!;
        // P8: so an "out of context" report can be checked against what
        // the model was actually given. Counts only, never message text.
        if (debug) {
            const replies = req.messages.filter(m => m.replyToId !== undefined);
            const inBatch = replies.filter(m => req.messages.some(x => x.id === m.replyToId)).length;
            const quoted = replies.filter(m => m.replyTo !== undefined && !req.messages.some(x => x.id === m.replyToId)).length;
            logger.debug(
                `[flush] relay: context=${req.context.length} lines, replies=${replies.length} `
                + `(parent in batch ${inBatch}, parent quoted ${quoted}, parent missing ${replies.length - inBatch - quoted})`
            );
        }

        const gateWaitStarted = Date.now();
        await acquireSlot();
        if (debug) {
            const waitedMs = Date.now() - gateWaitStarted;
            logger.debug(
                waitedMs > 5
                    ? `[flush] relay: rate gate — waited ${waitedMs}ms for a slot`
                    : "[flush] relay: rate gate — slot was available immediately"
            );
        }
        // stop()/rebuild may have happened while this flush sat behind the
        // gate (resetRateGate() wakes queued waiters immediately for exactly
        // that reason). Re-check before spending a real request on a batch
        // nothing will ever read the result of.
        if (myGeneration !== batcherGeneration) {
            if (debug) logger.debug("[flush] relay: blocked — stale generation (post-gate)");
            report?.({ kind: "gate" });
            return;
        }

        // The request is about to be SPENT, so record it before it can fail.
        // Every earlier `return` above cost nothing and left the message
        // retryable. A part of a long message is not a message:
        // runLongMessage charged the message.
        if (sink === undefined) for (const m of req.messages) markQualityAttempted(makeKey(m.id, req.targetLang));

        // `null` means the IPC call itself rejected — distinct from an
        // `ok: false` response, which is an engine-level failure the native
        // side successfully reported. onFlush is void-returning and invoked
        // un-awaited, so an unhandled rejection here would otherwise just
        // vanish the batch with no marker.
        let res: Awaited<ReturnType<typeof transport.translateBatch>> | null;
        qualityRequestsOut++;
        try {
            // The saved code, or the install bearer when there is none; the
            // relay is told which install asks (the 3-computer limit).
            const { credential, install } = await relayCredentials();
            res = await transport.translateBatch(ENGINE, credential, JSON.stringify(req), "", debug, install);
        } catch {
            res = null;
        } finally {
            qualityRequestsOut--;
        }

        // THE race this second guard exists for: rebuildBatcher() can run
        // WHILE the line above is awaiting the network round trip (the plan
        // or the reading language changed). Re-check before any write, so a
        // superseded response is dropped. Its charge is given back: the
        // rebuild's catch-up asks again for whatever is still on screen.
        if (myGeneration !== batcherGeneration) {
            if (debug) logger.debug("[flush] relay: blocked — stale generation (post-response)");
            if (sink === undefined) for (const m of req.messages) qualityAttempted.delete(makeKey(m.id, req.targetLang));
            return;
        }

        if (res === null || !res.ok) {
            if (debug) {
                logger.debug("[flush] relay: response not ok — " + (res === null ? "IPC call rejected" : res.error));
            }
            // Tell the beacon THAT something failed and roughly what class of
            // thing it was — never the engine's message, which is remote text
            // (see BEACON_ERROR_CODES).
            const errorCode = beaconErrorCode(res);
            recordError(errorCode, beaconErrorStatus(res));

            // Refused for its SIZE (413, or the relay's 400 for an overlong
            // text): the same request is refused every time, so re-send it
            // smaller, now. Halves first, then a lone message without its
            // context. Each part meets the rate gate on its own.
            if (res !== null && isOversizeRefusal(res.error)) {
                const smaller = shrinkAfterRefusal(req);
                if (smaller.length > 0) {
                    logger.info(`[flush] relay: request refused for its size; re-sending in ${smaller.length} smaller part(s)`);
                    if (sink === undefined) for (const m of req.messages) qualityAttempted.delete(makeKey(m.id, req.targetLang));
                    for (const part of smaller) for (const m of part.messages) delegated.add(m.id);
                    for (const part of smaller) await runTier(part, myGeneration, channelId, report, sentEpoch, sink);
                    return;
                }
            }

            // Manual-⚡-only — see ForcedHint's own doc. Reuses the same
            // closed set of categories the beacon just recorded, so this can
            // never leak the engine's own error string into the DOM.
            report?.({ kind: "failed", code: errorCode });
            const ids = sink === undefined ? live(req.messages.map(m => m.id)) : [];

            // THE HIDDEN DAILY CEILING (spec decision 5): one plain notice,
            // nothing more is sent until the relay's wait is over (UTC
            // midnight), and no ⏳ line says "translating" meanwhile.
            if (res !== null && res.errorCode === "ai_paused") {
                pausedUntil = Date.now() + (typeof res.retryAfterMs === "number" && res.retryAfterMs > 0 ? res.retryAfterMs : DEFAULT_COOLDOWN_MS);
                tasteLog("the relay paused ✦ for today (the daily ceiling)");
                showPausedNotice();
                if (!quiet) holdMessages(ids, req.targetLang, channelId);
                return;
            }

            // A refusal about what this install owns (✦ off, not linked, a 4th
            // computer): ask the relay again, and the session follows its
            // answer. Nothing is marked; ✦ waits PLAN_REFUSAL_HOLD_MS (or
            // until that answer) instead of re-asking on every message.
            if (res !== null && isEntitlementRefusal(res.errorCode)) {
                tasteLog(`the relay refused ✦ (${res.errorCode}); asking what this install owns`);
                planHeldUntil = Date.now() + PLAN_REFUSAL_HOLD_MS;
                refreshAfterRefusal();
                if (!quiet) holdMessages(ids, req.targetLang, channelId);
                else for (const id of ids) qualityAttempted.delete(makeKey(id, req.targetLang));
                return;
            }

            // P9: the relay went unanswered. Surfaces read this.
            relayFailing = true;
            if (res !== null) {
                // Park the engine for as long as the relay asked for: retrying
                // into a wall that just rejected us is how half the observed
                // traffic became 429s. (`retryAfterMs` comes with a 429, or a
                // 503 that states its own wait — see native.ts.)
                if (res.retryAfterMs) enterCooldown(ENGINE, res.retryAfterMs, res.quotaLimitPerMinute, res.error);
                // The code was refused (401): the relay's status answer says
                // whether it is dead (applyStatus drops it). Asked again
                // meanwhile like any failure, ever more slowly.
                if (/\bHTTP 401\b/.test(res.error)) refreshAfterRefusal();
            }
            deferMessages(ids, req.targetLang, channelId, report !== undefined);
            return;
        }

        // The CEILING the relay states for this credential (rpmLimit). A real
        // number beats the untaught guess, and learning it from a success
        // means the gate reaches the relay's rate without ever buying a 429
        // first. Same retune as a 429's stated quota, and persisted the same way.
        relayFailing = false;
        if (typeof res.quotaLimitPerMinute === "number") {
            const retuned = tuneRateGateToObservedLimit(res.quotaLimitPerMinute);
            if (debug && retuned) {
                logger.debug(
                    `[flush] relay: rate gate retuned to the stated ceiling `
                    + `(${res.quotaLimitPerMinute}/min) — now one request every ${rateGateSettings().refillMs}ms`
                );
            }
        }

        if (sink !== undefined) {
            sink(res.results);
            return;
        }
        const forced = report !== undefined;
        const answered = new Set<string>();
        let verdicts = 0;
        for (const r of res.results) {
            // A row for a message this request never carried is dropped: it
            // must never write a line under some other message.
            const sent = req.messages.find(m => m.id === r.id);
            if (sent === undefined || answered.has(r.id)) continue;
            answered.add(r.id);
            const key = makeKey(r.id, req.targetLang);
            if (isStale(r.id)) {
                if (debug) logger.debug(`[response] relay ${r.id}: dropped, the message was edited meanwhile`);
                continue;
            }
            if (debug) {
                const outcome = "failed" in r ? "failed" : r.skip ? "skip" : `translation (${r.lang})`;
                logger.debug(`[response] relay ${r.id}: ${outcome}`);
            }
            if ("failed" in r) {
                // Transport says "the moment was bad" (⏳, asked again); a
                // verdict says the model gave no usable row (omittedMessage).
                if ("transport" in r && r.transport === true) deferMessages([r.id], req.targetLang, channelId, forced);
                else omittedMessage(r.id, req.targetLang, channelId, forced);
                continue;
            }
            verdicts++;
            // A ⚡ (forced) answer that is the message itself, or a skip from
            // a relay that predates `force`: the message is already in the
            // reader's language. Said in one short line, never a duplicate.
            // A forced skip never takes a readable line away, though: it is
            // only written where there is no translation to keep.
            if (req.force === true) {
                if (r.skip || sameText(r.text, sent.text)) {
                    const existing = getTranslation(key);
                    if (r.skip && isRealTranslation(existing)) continue;
                    writeResult(key, { lang: r.skip ? req.targetLang : r.lang, text: sent.text, via: ENGINE, same: true });
                    continue;
                }
            }
            if (r.skip) {
                // A skip has nothing to DISPLAY, but something must still be
                // WRITTEN: no entry looks like never requested, and catch-up
                // would re-send it on every channel open. In a mixed-language
                // chat most messages ARE already in the target language, so
                // this is the common case. Written through writeResult so it
                // cannot replace a real translation.
                writeResult(key, { skipped: true, via: ENGINE });
                continue;
            }
            const value: StoredTranslation = { lang: r.lang, text: r.text, via: ENGINE };
            writeResult(key, value);
            // P7: stored by the same rule it is reused by. A reply's line was
            // read against its parent, so it must never answer a non-reply.
            if (phraseReusable(sent)) rememberPhrase(sent.text, req.targetLang, value);
        }
        // An id the relay did not answer at all is an omitted row too: left
        // alone, it would be charged and blank for the rest of the session.
        for (const m of req.messages) {
            if (answered.has(m.id) || isStale(m.id)) continue;
            omittedMessage(m.id, req.targetLang, channelId, forced);
        }

        // THE RECOVERY SWEEP (see deferredChannels), only on evidence: at
        // least one message in this flush got a real answer, so the relay is
        // talking to us again and the channel's ⏳ backlog is worth re-asking
        // about. Run AFTER the finally below has released this batch's ids,
        // so a message deferred in this same batch is asked again too. The
        // retry timer starts again from its first, short delay.
        if (channelId !== undefined && verdicts > 0 && deferredChannels.has(channelId)) {
            clearDeferredRetry(channelId);
            if (stillWaiting(channelId)) sweepChannel = channelId;
        }
    } finally {
        // Fires once this flush has fully settled, whichever way it went
        // (sent, skipped for cooldown, stranded by a rebuild, rejected). That
        // is the earliest point these ids are safe to retry — not when they
        // were queued, and not only on the happy path.
        for (const id of handedIds) if (!delegated.has(id)) inFlightQuality.delete(id);
        // A ⚡ press that waited for this request (forceAfterFlight).
        if (forceAfterFlight.size > 0) releaseForcedAfterFlight(handedIds.filter(id => !delegated.has(id)));
        // Ask again for every message edited while this request was out, now
        // that its id is free. enqueue() applies the focus and skip rules.
        for (const id of stale) {
            const edited = lastEdit.get(id);
            if (edited !== undefined && myGeneration === batcherGeneration) enqueue(edited.pending, edited.isOwn);
        }
        if (sweepChannel !== undefined && myGeneration === batcherGeneration) catchUp(sweepChannel);
    }
}

/** A refusal that says "too big", which the same request will get every time. */
function isOversizeRefusal(error: string): boolean {
    return /\bHTTP (?:413|400)\b/.test(error);
}

/**
 * Keep every ✦ text inside the relay's per-text limit where that costs
 * nothing. Mention expansion can push a near-4,000-character message past it
 * (`<#id>` becomes a channel name of up to 100 characters), and one such text
 * made the relay refuse the whole batch. Such a message is sent as Discord
 * stored it when that fits. Anything still longer is translated in parts
 * (runLongMessage, G2).
 */
function withinTextLimit(req: BatchRequest, channelId: string | undefined): BatchRequest {
    if (!req.messages.some(m => m.text.length > LLM_TEXT_MAX)) return req;
    return { ...req, messages: req.messages.map(m => rawIfItFits(m, channelId)) };
}

/** One over-long message as Discord stored it, when that fits the limit. */
function rawIfItFits<M extends { id: string; text: string; }>(m: M, channelId: string | undefined): M {
    if (m.text.length <= LLM_TEXT_MAX) return m;
    let raw: unknown;
    try {
        raw = channelId ? (MessageStore.getMessage(channelId, m.id) as { content?: unknown; } | undefined)?.content : undefined;
    } catch {
        raw = undefined;
    }
    return typeof raw === "string" && raw.trim() !== "" && raw.length <= LLM_TEXT_MAX ? { ...m, text: raw } : m;
}

/** A message over the per-text limit, as the parts that are sent for it (G2). */
function partsRequest(m: BatchRequest["messages"][number], base: BatchRequest): {
    req: BatchRequest; parts: string[]; seps: string[];
} {
    const { parts, seps } = splitTextToLimit(m.text, LLM_TEXT_MAX);
    const { id: _id, text: _text, replyToId, replyTo, ...rest } = m;
    return {
        parts,
        seps,
        req: {
            ...base,
            // The reply link rides on the first part, where the model reads it first.
            messages: parts.map((text, i) => ({
                ...rest, id: partId(m.id, i), text,
                ...(i === 0 && replyToId !== undefined ? { replyToId } : {}),
                ...(i === 0 && replyTo !== undefined ? { replyTo } : {})
            }))
        }
    };
}

/**
 * G2. Translate one message over the relay's per-text limit WHOLE: its parts
 * go through runTier (same gate, cooldowns and error handling, consecutive
 * requests when they do not fit one), and the ✦ line is written only when
 * every part came back. A ✦ of only part of the message is never shown.
 * Nothing back at all is no verdict (⏳, asked again); some parts missing is
 * an omitted message (asked once more, then the quiet ⚠), as in runTier.
 * Returns true when the message was edited while its parts were out, so the
 * caller asks again with the new text.
 */
async function runLongMessage(
    m: BatchRequest["messages"][number], base: BatchRequest, myGeneration: number,
    channelId: string | undefined, report: ((outcome: ForcedHint) => void) | undefined,
    epochs: ReadonlyMap<string, number>
): Promise<boolean> {
    const key = makeKey(m.id, base.targetLang);
    const forced = report !== undefined;
    markQualityAttempted(key);
    const { req, parts, seps } = partsRequest(m, base);
    const rows = new Map<string, Result>();
    await runTier(req, myGeneration, channelId, report, undefined, results => {
        for (const r of results) rows.set(r.id, r);
    });
    if (myGeneration !== batcherGeneration) {
        qualityAttempted.delete(key);
        return false;
    }
    // Edited while out: these words no longer exist. Told to the caller, so
    // its finally asks again with the new text once this id is released.
    if ((editEpoch.get(m.id) ?? 0) !== (epochs.get(m.id) ?? 0)) return true;
    if (rows.size === 0) {
        // Nothing came back at all (a cooldown, a hold, a failed request).
        if (Date.now() < Math.max(planHeldUntil, pausedUntil)) {
            if (!forced) holdMessages([m.id], base.targetLang, channelId);
            else qualityAttempted.delete(key);
        } else {
            deferMessages([m.id], base.targetLang, channelId, forced);
        }
        return false;
    }
    const whole = joinParts(m.id, parts, seps, rows);
    if (whole === null || "failed" in whole) {
        logger.info(`[flush] ${m.id}: ${parts.length} parts, not all came back`);
        omittedMessage(m.id, base.targetLang, channelId, forced);
        return false;
    }
    if (whole.skip) {
        // A forced skip never takes a readable line away (as in runTier).
        if (!(base.force === true && isRealTranslation(getTranslation(key)))) writeResult(key, { skipped: true, via: ENGINE });
        return false;
    }
    writeResult(key, { lang: whole.lang, text: whole.text, via: ENGINE });
    return false;
}

/**
 * Force ONE message through the quality tier on the user's explicit say-so —
 * the click handler behind the force-quality popover button.
 *
 * Deliberately does not consult `needsQuality()`, the `qualityAttempted`
 * ledger, or `allowQuality`: those bound AUTOMATIC spending (catch-up,
 * scroll-back, live chat), and a user naming one specific message outranks
 * all three — that is the entire point of a manual override. What this does
 * NOT skip is `runTier()`'s own gates: the cooldown and the rate gate are
 * limits on the ENGINE (how much it can be asked right now), not on how a
 * request was chosen, and bypassing either would let one click spend the
 * quota every other message is waiting on, or hammer an engine that just
 * rejected us. Routed through `runTier()` itself — not a second call to
 * `transport.translateBatch` — so the write still lands through
 * `writeResult()`/`mayReplace()` exactly as an automatic batch does.
 *
 * ⚡ ALWAYS GIVES A TRANSLATION (0.2.9, spec decision 3): the request is
 * forced, so the relay translates it and never skips it. A press while an
 * AUTOMATIC request for the same message is waiting in the batcher takes it
 * out and sends the forced one instead; a press while that request is
 * already out waits for it (forceAfterFlight) and sends the forced one when
 * it settles without a line (a skip, a failure). A second press while a
 * forced request is out sends nothing more.
 */
async function forceQualityTranslate(message: Message): Promise<void> {
    const debug = settings.store.debugLogging;
    if (debug) logger.debug(`[force-quality] ${message.id}: click received`);

    // ✦ is off (the popover render() below shows ⚡ only when it can do
    // something, but the plan can change between render and click): an
    // install with ⚡ left asks for one of the day's five, else nothing.
    if (!aiOn()) {
        if (isAutomaticOnly()) {
            await previewPress(message);
            return;
        }
        if (debug) logger.debug(`[force-quality] ${message.id}: blocked — ✦ is off for this account`);
        return;
    }

    // A second press while this message's forced request is out: one spend
    // at a time per message.
    if (forcedInFlight.has(message.id)) {
        if (debug) logger.debug(`[force-quality] ${message.id}: blocked — a forced request is already out`);
        return;
    }
    if (inFlightQuality.has(message.id)) {
        // Still waiting in the batcher's window: taken out, sent forced below.
        if (qualityBatcher?.remove(message.id)) {
            inFlightQuality.delete(message.id);
        } else {
            // Already out: wait for it, then force unless it brought a line.
            if (debug) logger.debug(`[force-quality] ${message.id}: an automatic request is out; forcing when it settles`);
            forceAfterFlight.set(message.id, message);
            clearForcedHint(message.id);
            forcedInFlight.add(message.id);
            notifyForcedInFlight();
            return;
        }
    }
    if (debug) logger.debug(`[force-quality] ${message.id}: passed guards, spending a relay request`);
    inFlightQuality.add(message.id);
    // A hint left over from an EARLIER click on this same message must not
    // survive into this one — see clearForcedHint's own doc.
    clearForcedHint(message.id);
    // Manual-path-only indicator for TranslationAccessory — see the comment
    // on `forcedInFlight` above for why this is a second set rather than a
    // second use of inFlightQuality.
    forcedInFlight.add(message.id);
    notifyForcedInFlight();

    const req: BatchRequest = {
        messages: [{
            id: message.id,
            author: message.author?.username ?? "unknown",
            // Readable, like every other path: mentions as names, custom
            // emoji dropped. Never the raw tokens.
            text: readableContent(message.content ?? "", message.channel_id),
            replyToId: replyParentId(message),
            ...withReplyCopy(message)
        }],
        // The messages immediately BEFORE this one, read from the store.
        //
        // This used to send `context: []`, reasoning that a single out-of-band
        // request does not need the conversation ring. That was wrong in the
        // case it matters most. Romanized Maghrebi Arabic is where this plugin
        // is weakest, and a real example had the author's own English
        // rendering of the sentence one message above it — "when we type, we
        // write in a mix of arabic and french". Without it, "ki nebdew
        // nektbou" came back as "what's up" and the verb "write" vanished.
        //
        // Read from the store rather than from the live context ring: the ring
        // is a window on what is arriving NOW, so forcing an old scroll-back
        // message would hand the model a conversation that has nothing to do
        // with it — worse than no context at all.
        //
        // This is also the request that can least afford to be wrong: the user
        // clicked a button and is watching for the answer.
        context: contextBefore(message, FORCED_CONTEXT_SIZE),
        targetLang: settings.store.targetLang,
        // Translate it, never skip: the reader asked for this one.
        force: true
    };
    // Whichever way runTier settles — success, failure, cooldown block, a
    // stale-generation drop or a rate-gate rejection — the manual indicator
    // must come down. runTier's OWN finally already releases inFlightQuality
    // on every one of those paths (see runTier), so piggy-backing on the same
    // await here releases forcedInFlight at exactly the same point, never
    // stuck on a path runTier itself handles.
    //
    // `report` is how runTier tells THIS caller — and only this caller, see
    // ForcedHint's own doc — why nothing landed, so TranslationAccessory can
    // show a brief, self-clearing hint instead of the silence an automatic
    // failure gets. Success needs no report of its own: the store write is
    // what the accessory's ✦/≈ line already reacts to.
    try {
        await runTier(req, batcherGeneration, undefined, outcome => setForcedHint(message.id, outcome));
    } finally {
        forcedInFlight.delete(message.id);
        notifyForcedInFlight();
    }
}

/* ---------------------------------------------------- ✦ previews -- */

/**
 * The ✦ previews this install has been shown (⚡ while ✦ is off): the FULL ✦
 * translation of one message each, shown as its line. Kept apart
 * from the translation store on purpose: a preview is not an automatic
 * translation and must never be mistaken for one by catch-up or the cache.
 * Persisted (freePlan.ts), so a restart neither loses the line nor offers the
 * message again: one message never costs more than one preview.
 */
const previews = new Map<string, PreviewResult>();
/**
 * Messages with a preview request out right now. Set SYNCHRONOUSLY on the
 * press, before anything is awaited, so a double click sends one request.
 */
const previewPending = new Set<string>();

/**
 * The preview ledger for THIS session. rememberPreview writes the whole map
 * to disk, so a write before the ledger is read back, or after stop() cleared
 * the map, would replace up to 200 stored previews with one row, and those
 * messages would cost a second preview. So a press waits for the ledger, and
 * an answer that lands after stop() is dropped (previewSession).
 */
let previewSession = 0;
let previewLedgerLoaded = true;
let previewLedgerReady: Promise<void> = Promise.resolve();

/**
 * Has this message, AS IT READS NOW, had (or is it having) its one preview?
 * Then it is never offered again. An edit changes the content hash: the old
 * preview no longer describes the text (previewFor drops its line), so the
 * edited text is offered again and costs one more preview (the relay counts
 * the same id with different text as a new preview). A request already out
 * blocks a second one whatever the text.
 */
function previewTaken(message: Message): boolean {
    if (previewPending.has(message.id)) return true;
    return previewMatches(previews.get(message.id), message);
}

/**
 * Does this stored preview describe the message as it reads now, in the
 * reading language set now? A preview made in another reading language is
 * kept (switching back shows it again) but never shown for the new language. A row stored before the language was kept
 * has none, so it never matches.
 */
function previewMatches(p: PreviewResult | undefined, message: Message): p is PreviewResult {
    return p !== undefined && p.src === contentHash(message.content ?? "") && p.targetLang === settings.store.targetLang;
}

/**
 * The preview to show for this message, if any: only while ✦ is off (with ✦
 * on, every ✦ line comes from the store), and
 * only while the message still reads as it did when previewed. An edit makes
 * it stale: nothing shows for the new text until it is pressed again.
 */
function previewFor(message: Message): PreviewResult | undefined {
    if (!isAutomaticOnly()) return undefined;
    const p = previews.get(message.id);
    return previewMatches(p, message) ? p : undefined;
}

/**
 * An Automatic owner's ✦ preview of this message (✦ is off), from ⚡ in the
 * hover toolbar. Five a day, counted by the relay once per message.
 *
 * Shows "⚡ translating…" at once (forcedInFlight), and a second press while
 * it is out, or after it is done, sends nothing. Charged only once the relay
 * served it: a failure (relay down, a 5xx, a timeout, a failed row) leaves
 * the message free to be pressed again, and the relay counts a retry of the
 * same message as the same preview.
 */
async function previewPress(message: Message): Promise<void> {
    const id = message.id;
    const mySession = previewSession;
    if (!previewLedgerLoaded) {
        await previewLedgerReady;
        if (mySession !== previewSession) return;
    }
    if (previewTaken(message) || forcedInFlight.has(id)) return;
    if (rolloverTasteIfNewUtcDay()) void refreshEntitlement();
    if (tasteExhausted()) {
        // Today's five are used, so a press would send nothing. Offer the
        // one thing that does help, as the ⚡ "Subscribe" label does.
        tasteLog(`${id}: no preview, today's ${tasteCap()} are used`);
        openUpgrade();
        return;
    }
    previewPending.add(id);
    forcedInFlight.add(id);
    clearForcedHint(id);
    notifyForcedInFlight();
    let served = false;
    try {
        served = await sendPreview(message, mySession);
    } catch {
        served = false;
    } finally {
        previewPending.delete(id);
        forcedInFlight.delete(id);
        if (!served && !tasteExhausted()) setForcedHint(id, { kind: "preview" });
        notifyForcedInFlight();
    }
}

/** previewPress's request. True once the relay served it and the ✦ line is stored. */
async function sendPreview(message: Message, mySession: number): Promise<boolean> {
    const { credential, install } = await relayCredentials();
    const content = message.content ?? "";
    const base: BatchRequest = {
        messages: [],
        context: contextBefore(message, FORCED_CONTEXT_SIZE),
        targetLang: settings.store.targetLang,
        // The reader asked for this one: translate it, never skip.
        force: true,
        mode: "preview"
    };
    const one = rawIfItFits({
        id: message.id,
        author: message.author?.username ?? "unknown",
        text: readableContent(content, message.channel_id),
        replyToId: replyParentId(message),
        ...withReplyCopy(message)
    }, message.channel_id);
    // G2: over the relay's per-text limit, the whole message is previewed in
    // parts (consecutive requests when they do not fit one), never its start.
    const split = one.text.length > LLM_TEXT_MAX ? partsRequest(one, base) : null;
    const requests = split === null ? [{ ...base, messages: [one] }] : fitLlmRequest(split.req);
    const rows = new Map<string, Result>();
    for (const req of requests) {
        let res: Awaited<ReturnType<typeof transport.translateBatch>> | null;
        try {
            res = await transport.translateBatch("relay", credential, JSON.stringify(req), undefined, settings.store.debugLogging, install);
        } catch {
            res = null;
        }
        if (res !== null) noteRelayClock(res.serverNow);
        if (res === null || !res.ok) {
            if (res !== null && isDailyLimit(res.error)) markTasteExhausted();
            if (res !== null && isEntitlementRefusal(res.errorCode)) refreshAfterRefusal();
            tasteLog(`${message.id}: no preview (${res === null ? "IPC call rejected" : "the relay refused"})`);
            return false;
        }
        if (!(typeof res.quotaCap === "number" && res.quotaCap > TASTE_CAP)) recordTasteQuota(res.quotaUsed, res.quotaCap);
        for (const r of res.results) rows.set(r.id, r);
    }
    const r = split === null ? rows.get(message.id) : joinParts(message.id, split.parts, split.seps, rows) ?? undefined;
    // No row, a failed row, or a part missing: nothing to show (never part
    // of a message), so the reader may press again. The relay counts that
    // retry as this same preview.
    if (r === undefined || "failed" in r) {
        tasteLog(`${message.id}: no preview (the relay returned no translation)`);
        return false;
    }
    // A cut preview (an older or rolled-back relay cuts previews to their
    // first words) is never stored or shown as the full ✦ line. The press is
    // offered again, as joinParts does for a part.
    if (!r.skip && r.truncated === true) {
        tasteLog(`${message.id}: no preview (the relay sent a cut preview)`);
        return false;
    }
    const text = r.skip ? "" : cleanTranslation(r.text.trim(), content);
    // The plugin stopped while this was out: its map is empty, and writing it
    // now would replace the stored ledger with this one row.
    if (mySession !== previewSession) return false;
    noteTasteSpent();
    rememberPreview(previews, message.id, {
        text: text === "" ? null : text,
        ...(!r.skip && r.lang ? { lang: r.lang } : {}),
        src: contentHash(content),
        targetLang: base.targetLang
    });
    return true;
}

function rebuildBatcher() {
    // Anything still sitting in the debounce window would otherwise be lost
    // when dispose() clears it below. Drain it before the generation bump.
    const orphaned = qualityBatcher?.drainPending() ?? [];

    batcherGeneration++;
    const myGeneration = batcherGeneration;
    qualityBatcher?.dispose();
    // A ⚡ press waiting for a request of the old generation: that request's
    // answer is dropped (runTier), so the press is released here and may be
    // pressed again.
    for (const id of forceAfterFlight.keys()) forcedInFlight.delete(id);
    forceAfterFlight.clear();

    // ✦ ON: every message goes to the relay (0.2.9, the one tier). ✦ OFF:
    // nothing is translated by itself; ⚡ asks for one message at a time.
    qualityBatcher = aiOn()
        ? createBatcher({
            // Up to 3s and 25 messages a request (spec decision 7, types.ts).
            debounceMs: QUALITY_DEBOUNCE_MS,
            maxBatch: QUALITY_MAX_BATCH,
            contextSize: 8,
            supportsContext: ENGINE_CAPS[ENGINE].supportsContext,
            targetLang: settings.store.targetLang,
            onFlush: (req, channelId) => runTier(req, myGeneration, channelId)
        })
        : null;

    // Orphans are still marked in flight from their first pass. enqueue()
    // early-returns on that, which would silently drop every message caught
    // mid-debounce by a settings change — no entry, no marker, no retry.
    // Releasing the marks first is what makes the re-queue actually re-queue.
    for (const m of orphaned) inFlightQuality.delete(m.id);
    // ✦ off: no ⏳ line may go on saying "translating…" (dropAllWaiting).
    if (qualityBatcher === null) dropAllWaiting();
    // Re-queue under the new settings rather than marking them failed —
    // nothing about these messages failed, the settings changed under them.
    for (const m of orphaned) enqueue(m, false);
}

/**
 * Bind renderDiscordMarkup's resolver callbacks to the live Discord stores for
 * one channel. Snowflake -> readable-name lookups need the guild the channel
 * belongs to (a nickname and a role are both guild-scoped); a DM has none, so
 * user mentions fall back to the global name/username and roles to the neutral
 * placeholder. Every lookup is defensive — renderDiscordMarkup also wraps each
 * call — so a store that has not loaded yet degrades to the placeholder rather
 * than throwing.
 */
function markupResolversFor(channelId: string): MarkupResolvers {
    let guildId: string | undefined;
    try {
        guildId = (ChannelStore.getChannel(channelId) as { guild_id?: string } | undefined)?.guild_id;
    } catch {
        guildId = undefined;
    }
    return {
        user(id) {
            // Guild nickname first (what Discord's own client shows in that
            // server), then the account's global display name, then username.
            if (guildId) {
                const nick = GuildMemberStore.getNick(guildId, id);
                if (nick) return nick;
            }
            const u = UserStore.getUser(id) as { globalName?: string | null; username?: string } | undefined;
            return u?.globalName ?? u?.username ?? undefined;
        },
        channel(id) {
            return (ChannelStore.getChannel(id) as { name?: string } | undefined)?.name ?? undefined;
        },
        role(id) {
            if (!guildId) return undefined;
            return (GuildRoleStore.getRole(guildId, id) as { name?: string } | undefined)?.name ?? undefined;
        }
    };
}

/**
 * Rewrite Discord entity markup (`<@id>`, `<#id>`, `<@&id>`, `<:name:id>`) in a
 * message's content to the readable text Discord itself paints, so the
 * translator sees and returns "@deniz"/"#general"/":blob:" instead of a numeric
 * id it would mistranslate or mangle. See discordMarkup.ts for why this is
 * resolve-before-translate rather than mask-and-restore.
 */
function readableContent(text: string, channelId: string): string {
    // Decoded / normalised first (decode.ts), so the translator reads letters.
    // Custom emoji are dropped outright (customEmoji.ts): they carry no words,
    // and sent in any form they come back as ids or :NAME: junk.
    return renderDiscordMarkup(dropCustomEmoji(translatableText(text)), markupResolversFor(channelId));
}

/**
 * The single path from "this message needs handling" to the batcher, shared by
 * MESSAGE_CREATE, MESSAGE_UPDATE and catch-up. Keeping it in one place is what
 * stops the skip rule, the in-flight guard and the context bookkeeping from
 * drifting apart between the three callers — the edited-message path in
 * particular has to do exactly what the created-message path does.
 *
 * `recordContext` is false for exactly one caller: catch-up driven by a
 * scroll-back `LOAD_MESSAGES_SUCCESS` (see `initialHistoryPending`). Those
 * messages are translated like any other (since 2026-09-20), but none is
 * recorded as CONTEXT: the context ring is a window on the conversation being read, and
 * filling it with an hour-old stretch of history the user happened to scroll
 * past would evict exactly the recent messages that make the next live batch
 * worth its request. `allowQuality` remains for the manual-⚡ and settings
 * paths that decide per call whether the quality tier is in play at all.
 */
function enqueue(pending: PendingMessage, isOwn: boolean, allowQuality = true, recordContext = true) {
    // The owner switched message translation off: nothing is queued or sent.
    if (isFeatureOff("messages")) return;
    // The raw text, before the readable rewrite below, because that is what a
    // later MESSAGE_UPDATE carries and is compared with.
    rememberSeenText(pending.id, pending.text);
    // Two flavours of local skip, handled identically (0.2.9, decision 2:
    // only when there is nothing to translate): the structural one (own
    // message, nothing but emoji, links or laughter, see skip.ts) and the
    // linguistic one (we can tell locally that this is already in the
    // reader's language — see detectLang.ts, which is heavily biased toward
    // saying "no idea", i.e. toward spending the request).
    //
    // Both record context rather than writing a store entry, exactly as the
    // structural skip always has. Nothing is written because nothing was
    // decided by an ENGINE: re-examining the message on the next channel open
    // is a pure local function call that returns the same answer for free, and
    // not writing keeps a local guess out of the persisted cache, where a
    // heuristic mistake would otherwise outlive the session.
    const skipReason = localSkipReason(pending.text, isOwn);

    // Rewrite Discord entity markup to readable text for EVERYTHING downstream:
    // the batch text sent to the translator, the phrase-cache key, and the
    // conversation context handed to other messages' batches. Done AFTER the
    // skip decision above ON PURPOSE — shouldSkip/isConfidentlyTargetLanguage
    // must keep judging the raw content (a bare "<@123>" is still nothing to
    // translate and is still skipped; this is the separate transform skip.ts's
    // header calls out). renderDiscordMarkup never throws and never emits the
    // numeric id, so this cannot change whether a message is enqueued, only
    // what text it carries once it is.
    const readable = readableContent(pending.text, pending.channelId);
    if (readable !== pending.text) pending = { ...pending, text: readable };

    // P6 (field test 2026-10-08): EVERY message the reader sees is
    // conversation, whatever happens to it next: locally skipped, queued, a
    // cache hit, already in flight, or answered from qualityPhrases. Only
    // recording the skipped and the newly queued ones (as before) left holes
    // exactly where an earlier line had already been translated, so a reply
    // reached the model without the message it answered. The ring keeps them
    // in message order and de-duplicates by id (batcher.ts).
    //
    // Not for scroll-back (recordContext false) or a call that keeps ✦ out
    // (allowQuality false); see this function's doc comment.
    if (allowQuality && recordContext) qualityBatcher?.recordContext(pending);

    if (skipReason !== null) {
        // Guarded, not just quiet: with the setting off this must cost
        // nothing beyond the one boolean read below — no template string is
        // built. See settings.ts's debugLogging for what this is for and why
        // message text is included.
        if (settings.store.debugLogging) {
            logger.debug(
                `[enqueue] ${pending.id}: locally skipped by ${skipReason} `
                + `— text=${JSON.stringify(pending.text)}`
            );
        }
        // Already recorded as context above.
        return;
    }

    const key = makeKey(pending.id, settings.store.targetLang);

    // Already queued or awaiting a response: the store shows a miss for the
    // whole round trip, so "no entry" must not be read as "never requested".
    let wentQuality = false;
    if (allowQuality && qualityBatcher && !inFlightQuality.has(pending.id) && needsQuality(key)) {
        // An identical line already translated by ✦ this session: reuse the answer rather than buying a second, possibly
        // different one. Still routed through writeResult, so it cannot
        // replace anything better and the beacon counts it like any other.
        // P7: only a line that carries its own meaning; see qualityPhrases.
        const seen = phraseReusable(pending)
            ? qualityPhrases.get(phraseKey(pending.text, settings.store.targetLang))
            : undefined;
        if (seen !== undefined) {
            writeResult(key, seen);
            if (settings.store.debugLogging) {
                logger.debug(`[enqueue] ${pending.id}: reused a cached quality phrase`);
            }
        } else {
            inFlightQuality.add(pending.id);
            qualityBatcher.add(pending);
            wentQuality = true;
        }
    }

    if (settings.store.debugLogging) {
        logger.debug(`[enqueue] ${pending.id}: -> ${wentQuality ? "quality" : "nothing (in flight, already resolved, or ✦ off)"}`);
    }
}

/** Which local rule decided to skip a message — see `localSkipReason`. */
type LocalSkipReason = "shouldSkip" | "isConfidentlyTargetLanguage";

/**
 * Decided locally, for free, with no engine involved: either there is nothing
 * translatable left in the text (`shouldSkip`), or it is already in the
 * target language (`isConfidentlyTargetLanguage`) — or neither, `null`.
 *
 * Same short-circuit order as the `||` this replaces: `shouldSkip` is checked
 * first and `isConfidentlyTargetLanguage` only when it says no, so behaviour
 * is unchanged. Split out from a plain boolean (what `isLocallySkipped` below
 * still returns, for its two ordinary callers) so debugLogging can report
 * WHICH of the two rules fired — the enqueue-side logging exists specifically
 * so a message that silently never reaches an engine is still diagnosable
 * from the console.
 */
function localSkipReason(text: string, isOwn: boolean): LocalSkipReason | null {
    // Judge what the reader will actually get translated: a decoded code, or
    // fancy text normalised (decode.ts, normalize.ts).
    text = translatableText(text);
    if (shouldSkip(text, isOwn, settings.store.targetLang)) return "shouldSkip";
    if (isConfidentlyTargetLanguage(text, settings.store.targetLang)) return "isConfidentlyTargetLanguage";
    return null;
}

/**
 * Decided locally, for free, with no engine involved: either there is nothing
 * translatable left in the text, or it is already in the target language.
 *
 * Shared by enqueue() and catchUp() ON PURPOSE. catch-up has to predict the
 * same answer enqueue() will give, so that a message costing no request also
 * costs no catch-up budget — see the budget comment in catchUp().
 */
function isLocallySkipped(text: string, isOwn: boolean): boolean {
    return localSkipReason(text, isOwn) !== null;
}

/**
 * "de" -> "German", "ha" -> "Hausa".
 *
 * The two-letter code alone is not readable: a reader who sees "ha" has no way
 * to know it means Hausa, and therefore no way to notice that a message in a
 * German conversation was detected as a West African language — which is
 * precisely the moment the translation should be distrusted.
 *
 * Intl.DisplayNames ships with the runtime, so this costs no table of our own.
 * It throws on a malformed code and returns the input unchanged for a
 * well-formed one it doesn't know, so both fall back to showing the raw code.
 */
function languageName(code: string): string {
    try {
        return new Intl.DisplayNames([LocaleStore.locale || "en"], { type: "language" })
            .of(code) ?? code;
    } catch {
        return code;
    }
}

/**
 * The id of the message a reply points at, or undefined for a normal message.
 *
 * Discord exposes this two ways depending on how the message reached us —
 * `message_reference` on the Flux payload, `referenced_message` on a hydrated
 * store object — so both are checked rather than assuming the shape of
 * whichever path happened to be tested.
 */
function replyParentId(message: any): string | undefined {
    const ref = message?.message_reference?.message_id;
    if (typeof ref === "string") return ref;
    const hydrated = message?.referenced_message?.id;
    return typeof hydrated === "string" ? hydrated : undefined;
}

/**
 * R3: a short clipped copy of the message a reply answers, when Discord has
 * it: the hydrated `referenced_message`, else the message store. Undefined
 * for a normal message, and for a reply whose parent is deleted or was never
 * loaded (the relay then says only that it is a reply). Readable like every
 * other text the model sees (mentions as names, custom emoji dropped).
 */
function replyParentCopy(message: any, channelId: string): { author: string; text: string } | undefined {
    const parentId = replyParentId(message);
    if (parentId === undefined) return undefined;
    try {
        let parent: any = message?.referenced_message;
        if (!parent || parent.id !== parentId || typeof parent.content !== "string") {
            parent = MessageStore.getMessage(channelId, parentId);
        }
        if (!parent || typeof parent.content !== "string" || parent.content.trim() === "") return undefined;
        const text = readableContent(parent.content, channelId);
        if (text.trim() === "") return undefined;
        return { author: parent.author?.username ?? "unknown", text: clipParentText(text) };
    } catch {
        return undefined;
    }
}

/** `{ replyTo }` for a reply whose parent Discord has, else `{}`. */
function withReplyCopy(message: any): { replyTo?: { author: string; text: string } } {
    const replyTo = typeof message?.channel_id === "string" ? replyParentCopy(message, message.channel_id) : undefined;
    return replyTo !== undefined ? { replyTo } : {};
}

/** The PendingMessage for a Discord message: the one shape every path builds. */
function pendingFrom(message: any, channelId: string, text: string = message.content ?? ""): PendingMessage {
    const replyTo = replyParentCopy(message, channelId);
    return {
        id: message.id,
        author: message.author?.username ?? "unknown",
        text,
        channelId,
        replyToId: replyParentId(message),
        ...(replyTo !== undefined ? { replyTo } : {})
    };
}

/** How many preceding messages a forced translation gets as context. */
const FORCED_CONTEXT_SIZE = 6;

/**
 * The messages immediately before `message` in its channel, oldest-first.
 *
 * Positioned by ID rather than by taking the newest N, because the whole point
 * is the conversation around THIS message — which, for anything reached by
 * scrolling back, is nowhere near the newest.
 *
 * Empty-content messages (embeds, attachments, joins) are dropped: they cost
 * prompt tokens and carry nothing a translator can use. A message the store
 * does not have — the target was never loaded, or Discord's internals moved —
 * yields no context rather than throwing, because a forced translation with
 * imperfect context is still far better than one that errors.
 */
function contextBefore(message: any, size: number): { author: string; text: string }[] {
    const channelId = message?.channel_id;
    if (typeof channelId !== "string") return [];

    // `as any`: Vencord 1.15.9's discord-types dropped toArray() from the
    // declared ChannelMessages type, but Discord's class still has it (checked
    // against the public bundle: toArray(){return[...this._array]}). The
    // typeof check below keeps a real removal from throwing.
    const store = MessageStore.getMessages(channelId) as any;
    if (!store || typeof store.toArray !== "function") return [];

    let all: any[];
    try {
        all = store.toArray();
    } catch {
        return [];
    }

    const index = all.findIndex(m => m?.id === message.id);
    if (index < 0) return [];

    return all
        .slice(Math.max(0, index - size), index)
        .filter(m => typeof m?.content === "string" && m.content.trim() !== "")
        // Same readable-markup rewrite the enqueue path applies, so forced-path
        // context shows the model "@deniz"/"#general" instead of raw "<@123>".
        .map(m => ({ author: m.author?.username ?? "unknown", text: readableContent(m.content as string, channelId) }));
}

function onMessageCreate({ message, optimistic }: { message: Message; optimistic?: boolean; }) {
    if (optimistic || !message?.id) return;
    if (typeof message.content === "string") rememberSeenText(message.id, message.content);
    if (!channelActive(message.channel_id)) return;
    // Not the channel on screen: don't spend a request on it now. It is not
    // lost — opening that channel runs catch-up over its recent backlog.
    if (!isFocusedChannel(message.channel_id)) return;

    enqueue(
        pendingFrom(message, message.channel_id),
        message.author?.id === UserStore.getCurrentUser()?.id
    );
}

function onMessageUpdate({ message }: { message: Message; }) {
    if (!message?.id) return;

    // MESSAGE_UPDATE is not only fired for user edits. It also fires when a
    // link preview loads, an attachment finishes or a pin changes. Discord now
    // sends the whole message for those, with the text unchanged; older
    // payloads carried no `content` at all. Neither is an edit: the
    // translation we have (or are waiting for) still fits these words, and
    // dropping it would pay for every link message twice.
    const text = message.content;
    if (typeof text !== "string") return;
    if (seenText.get(message.id) === text) return;
    rememberSeenText(message.id, text);

    // A real edit. Whatever we had cached describes the pre-edit text, so it
    // is wrong now. ✦'s spent attempt is discarded with it, for
    // the same reason: it was spent on text that no longer exists, so the
    // edited message is entitled to its own.
    invalidateMessage(message.id);
    forgetQualityAttempts(message.id);

    // Any request already carrying the old text is now stale
    // (see runTier), and a copy still waiting in a debounce window is taken
    // out so the new text is what gets sent.
    editEpoch.set(message.id, (editEpoch.get(message.id) ?? 0) + 1);
    if (qualityBatcher?.remove(message.id)) inFlightQuality.delete(message.id);
    if (text === "") {
        lastEdit.delete(message.id);
        return;
    }

    const pending: PendingMessage = pendingFrom(message, message.channel_id, text);
    const isOwn = message.author?.id === UserStore.getCurrentUser()?.id;
    rememberEdit(pending, isOwn);

    if (!message.channel_id || !channelActive(message.channel_id)) return;
    // Same focus rule as a new message: an edit in a channel nobody is looking
    // at waits for that channel to be opened. The invalidation above already
    // happened, so it is a cache miss when catch-up gets to it.
    if (!isFocusedChannel(message.channel_id)) return;

    // Invalidating without re-queuing was the bug this replaces: the subtitle
    // vanished on edit and only came back on the next channel open. Goes
    // through enqueue() so the skip rule and the in-flight guard apply exactly
    // as they do for a new message. An edit landing while the original is
    // still in flight is skipped by that guard here; runTier then drops the
    // stale answer and asks again with this text (see editEpoch).
    enqueue(pending, isOwn);
}

/**
 * How many times each message has been edited this session. runTier compares
 * the value at flush with the value when the answer lands: a fix-a-typo edit
 * 0.3s after sending used to keep a ✦ line for the old words for good.
 */
const editEpoch = new Map<string, number>();
/** The latest edit of each message, so runTier can ask again with it. */
const lastEdit = new Map<string, { pending: PendingMessage; isOwn: boolean; }>();
const MAX_EDITS_KEPT = 500;
/**
 * The last raw text seen for each message (created, queued or edited), so a
 * MESSAGE_UPDATE that only adds a link preview is told apart from an edit.
 * Bounded: an id that fell out is treated as edited, which costs one request
 * at worst and never shows a translation of words that are gone.
 */
const seenText = new Map<string, string>();
const MAX_SEEN_TEXTS = 2_000;

function rememberSeenText(id: string, text: string): void {
    seenText.delete(id);
    seenText.set(id, text);
    if (seenText.size > MAX_SEEN_TEXTS) seenText.delete(seenText.keys().next().value!);
}

function rememberEdit(pending: PendingMessage, isOwn: boolean): void {
    lastEdit.delete(pending.id);
    lastEdit.set(pending.id, { pending, isOwn });
    if (lastEdit.size > MAX_EDITS_KEPT) lastEdit.delete(lastEdit.keys().next().value!);
}

interface CatchUpOptions {
    /**
     * For the one caller that KNOWS this channel is the one the user is now on,
     * but cannot prove it through SelectedChannelStore: CHANNEL_SELECT. Flux
     * hands that event to store handlers and plugin subscribers without a
     * guaranteed order, so SelectedChannelStore may still be reporting the
     * PREVIOUS channel when we run. Gating on the store there would mean
     * cold-channel catch-up — the headline feature — silently never firing.
     * The event's own payload is the authoritative statement of "this is now
     * the selected channel", so that caller passes true and every other caller
     * proves focus the normal way.
     */
    becomingFocused?: boolean;
    /**
     * True for a `LOAD_MESSAGES_SUCCESS` that is not the initial backlog
     * landing for a channel the user just opened, i.e. the user scrolling back
     * through history. Those messages are translated like any other, but are
     * not recorded as context — see
     * `initialHistoryPending` for why the ring must stay a window on the
     * conversation being read.
     */
    scrollBack?: boolean;
}

function catchUp(channelId: string, opts: CatchUpOptions = {}) {
    const { becomingFocused = false, scrollBack = false } = opts;
    // Every catch-up may spend on ✦; the scroll-back flag only steers
    // context. Kept as a local so a future exclusion is one line.
    const allowQuality = true;

    if (!channelActive(channelId)) return;
    if (!becomingFocused && !isFocusedChannel(channelId)) return;

    const count = settings.store.catchUpCount;
    if (count <= 0) return;

    // `as any`: see contextBefore (toArray is real, just no longer declared).
    const store = MessageStore.getMessages(channelId) as any;
    if (!store || typeof store.toArray !== "function") {
        // Not necessarily an error -- a channel with no messages loaded yet
        // legitimately has nothing to iterate. But if the store or method
        // itself is gone, Discord's internals moved and we'd otherwise fail
        // silently with no way to tell "empty channel" from "broken".
        logger.warn(`MessageStore.getMessages(${channelId}) has no usable toArray(); skipping catch-up.`);
        return;
    }

    // Walk newest-first over EVERY loaded message and cap on how many we
    // actually enqueue, rather than slicing the newest `count` up front.
    // Those are the same set on a first open, but they diverge as soon as you
    // scroll up: scrolling loads older history and re-fires this, and a
    // fixed tail slice would keep re-examining the same already-translated
    // recent messages while the newly-loaded older ones never got picked up.
    const all = store.toArray();
    const me = UserStore.getCurrentUser()?.id;

    // Select newest-first so the messages nearest the viewport win the budget,
    // then enqueue oldest-first.
    const candidates: any[] = [];
    // `count` is a budget of REQUESTS, not of messages looked at.
    //
    // A locally-skipped message deliberately writes nothing to the store (see
    // enqueue), so it never becomes "resolved" and turns up again on every
    // single catch-up. Counting those against the budget meant that in an
    // English-majority channel the newest ~20 English lines consumed catch-up
    // entirely and the foreign message further up — the only one that needed
    // translating, and the whole reason the plugin exists — was never reached.
    // Scrolling back could not fix it either, because each re-run spent the
    // budget on the same newest messages again.
    let budget = 0;
    for (let i = all.length - 1; i >= 0 && budget < count; i--) {
        const message = all[i];

        const key = makeKey(message.id, settings.store.targetLang);

        // A message is finished once ✦ has nothing left to do: needsQuality()
        // folds in the one-request-per-verdict ledger, and this loop is why:
        // catch-up runs on every channel open and on every scroll-up
        // (LOAD_MESSAGES_SUCCESS), so without it a message the model left out
        // twice would be re-requested here for the rest of the session. A ⏳
        // message (no verdict yet) is given back its charge, so it is asked
        // again here. See `qualityAttempted`.
        const quality = allowQuality
            && qualityBatcher !== null
            && !inFlightQuality.has(message.id)
            && needsQuality(key);
        if (!quality) continue;

        candidates.push(message);
        // Still enqueued above (a skipped message is real conversation and
        // belongs in the context window), just not charged for: enqueue() will
        // resolve it locally without ever reaching an engine.
        if (!isLocallySkipped(message.content ?? "", message.author?.id === me)) budget++;
    }
    // Back to chronological order before enqueuing, so the batcher's rolling
    // context window sees the conversation the right way round.
    candidates.reverse();

    if (settings.store.debugLogging) {
        logger.debug(
            `[catchUp] ${channelId}: scrollBack=${scrollBack} `
            + `candidates=${candidates.length} budgetSpent=${budget}/${count}`
        );
    }

    // P6: the backlog the reader is looking at is conversation even where it
    // needs no work (already translated, a cache hit from an earlier session).
    // Only candidates used to reach the context ring, so on a channel open the
    // newest lines before a live message were whatever happened to still need
    // translating, not the conversation. Recorded before the candidates are
    // enqueued and flushed below; the ring orders by message id and drops
    // duplicates, so the two catch-ups of one open record each line once.
    // Not for scroll-back: see enqueue()'s doc comment.
    const ring = allowQuality ? qualityBatcher : null;
    if (!scrollBack && ring !== null) {
        const queued = new Set(candidates.map(m => m.id));
        for (const message of all.slice(-CONTEXT_RING_SIZE)) {
            if (queued.has(message?.id) || typeof message?.id !== "string") continue;
            if (typeof message.content !== "string" || message.content.trim() === "") continue;
            const line = {
                id: message.id,
                author: message.author?.username ?? "unknown",
                text: readableContent(message.content, channelId),
                channelId
            };
            ring.recordContext(line);
        }
    }

    for (const message of candidates) {

        // Skipped messages still shape the conversation, so enqueue() turns
        // them into context instead of a request. pushContext() de-duplicates
        // by message id, which matters here: catch-up runs for BOTH
        // CHANNEL_SELECT and LOAD_MESSAGES_SUCCESS on a single channel open,
        // so without that the same backlog would be pushed into the 8-slot
        // ring twice, evicting genuine context with copies of itself.
        enqueue(
            pendingFrom(message, channelId),
            message.author?.id === me,
            allowQuality,
            // Scrolled-past history is translated but not remembered.
            !scrollBack
        );
    }

    // SEND NOW. Catch-up hands the batcher a backlog that is already complete;
    // the debounce window exists to group a burst of LIVE messages, and waiting
    // it out here only delayed the ✦ line on every channel open by the whole
    // window.
    if (candidates.length > 0 && allowQuality) qualityBatcher?.flushNow();
}

function onChannelSelect({ channelId }: { channelId: string; }) {
    if (!channelId) return;
    // The backlog may not be fetched yet for a channel not visited this
    // session, so the history load that follows is still part of THIS open and
    // belongs in the quality tier's context. Armed before catch-up runs, so a
    // synchronous LOAD_MESSAGES_SUCCESS could not outrun it.
    armInitialHistory(channelId);
    // This event IS the focus change, so it does not have to ask
    // SelectedChannelStore whether it has caught up yet.
    catchUp(channelId, { becomingFocused: true });
    // A 🌐 choice made on another computer for a channel not known here until now.
    void channelOpened(channelId);
    // The ended panel waits for a channel switch (decision 12).
    checkPlanMessages("switch");
}

// CHANNEL_SELECT fires before Discord has necessarily fetched the backlog
// of a channel not yet visited this session, so MessageStore.getMessages()
// can still be empty when catchUp() above runs -- exactly the "tab back in
// after a game" case the feature exists for. LOAD_MESSAGES_SUCCESS is
// Discord's event for "message history for this channel just landed"; it's
// confirmed as a real client event via the FluxEvents union in
// packages/discord-types/src/fluxEvents.d.ts, but no existing Vencord
// plugin subscribes to it, so its `channelId` payload field is inferred
// from MessageStore's own consistent naming (getMessages(channelId),
// isLoadingMessages(channelId)) and CHANNEL_SELECT's confirmed shape, not
// independently verified against a real dispatch.
function onMessagesLoaded(payload: any) {
    patchHealthWatch?.noteMessagesLoaded();
    // The payload shape for this event is not exercised anywhere in the
    // Vencord checkout, so the field name is unverified. Accept the two
    // plausible spellings and log loudly if neither is present, so a
    // Discord-internals change is diagnosable instead of a silent no-op --
    // this is the headline "tab back in after a game" case, so a silent
    // failure here would be the worst kind: no error, just nothing happens.
    const channelId: string | undefined = payload?.channelId ?? payload?.channel_id;
    if (!channelId) {
        logger.warn(
            "LOAD_MESSAGES_SUCCESS payload had no channelId/channel_id; " +
            "cold-channel catch-up will not run. Payload keys: " +
            Object.keys(payload ?? {}).join(", ")
        );
        return;
    }
    // No `becomingFocused` here: by the time history has actually landed,
    // SelectedChannelStore is settled, and this event also fires for a channel
    // the user is NOT looking at (scrolling loads more history, background
    // fetches). Requiring real focus is what keeps it from re-opening the
    // fan-out this phase closed.
    //
    // The FIRST load after a channel open is that open's own backlog — the
    // "tab back in after a game" case CHANNEL_SELECT was too early to serve.
    // Every load after it is the user scrolling back through history. Both get
    // ✦ (changed 2026-09-20: scroll-back used to be limited, a bound for a
    // personal Gemini free-tier key that the relay now enforces server-side);
    // only the context recording differs — see `initialHistoryPending`.
    catchUp(channelId, { scrollBack: !takeInitialHistory(channelId) });
}

const TEXT_COLOUR = "var(--text-default, var(--text-normal, #dbdee1))";

/** The translation itself: keeps the message's own line breaks (see the accessory). */
const TRANSLATION_TEXT_STYLE = { whiteSpace: "pre-wrap" } as const;

/** The direction of a line written in the reader's language. */
function translationDir(): "rtl" | "auto" {
    return isRtlLang(settings.store.targetLang) ? "rtl" : "auto";
}

/**
 * How each engine's output is announced on the subtitle itself: ✦, and the
 * engine's name in the hover. One lookup keyed by EngineId, so the glyph and
 * the hover text cannot disagree. 0.2.9 writes only relay lines; the
 * bring-your-own-key rows are for lines an older build stored. There is no ≈
 * any more (spec decision 1): Google's lines are dropped when the store loads.
 */
const ENGINE_PROVENANCE: Record<EngineId, { glyph: string; label: string; }> = {
    claude: { glyph: "✦", label: "Claude" },
    gemini: { glyph: "✦", label: "Gemini" },
    groq: { glyph: "✦", label: "Groq" },
    relay: { glyph: "✦", label: "Subline" }
};

/**
 * The short, human phrase for a `failed` hint's tooltip — "if it is cheap,
 * include a short human phrase... so the user can tell 'wait a minute' from
 * 'something is broken' without turning on debug logging." Reuses
 * `BeaconErrorCode` rather than inventing a second vocabulary, so this can
 * never drift from what the beacon itself already records — and, same as
 * that code, is never the engine's own (potentially remote-text-bearing)
 * error string.
 */
function describeFailureReason(code: BeaconErrorCode): string {
    switch (code) {
        case "rate-limited": return "rate limited";
        case "auth-rejected": return "not accepted";
        case "ipc-failed":
        case "engine-error":
        default: return "no answer";
    }
}

/**
 * What a `ForcedHint` renders as — glyph text plus a longer tooltip. Text
 * differs across all three kinds (not just the tooltip) so "wait a minute"
 * reads as visibly different from "something is wrong" even for a reader who
 * never hovers.
 */
function forcedHintDisplay(hint: ForcedHint): { text: string; title: string } {
    switch (hint.kind) {
        case "cooldown":
            return {
                text: "⚡ cooling down",
                title: "✦ is cooling down after a rate limit. Nothing was sent. Try ⚡ again in a moment."
            };
        case "gate":
            return {
                text: "⚡ rate limited",
                title: "Nothing was sent: the request was still waiting for its turn. Try ⚡ again."
            };
        case "failed":
            return {
                text: "⚡ translation failed",
                title: `The request failed (${describeFailureReason(hint.code)}).`
            };
        case "preview":
            return { text: PREVIEW_FAILED_HINT, title: PREVIEW_FAILED_HINT };
    }
}

/**
 * "✦ ES · the leak says the album drops friday": a ⚡ translation while ✦ is
 * off (one of the day's five), the FULL ✦ translation, as the message's one
 * line. It looks like any ✦ line: nothing to buy on it (0.2.9 spec, decisions
 * 6 and 12, "never sales text under a message"). See previewPress.
 */
function previewLine(preview: PreviewResult) {
    recordRendered();
    if (preview.text === null) {
        return (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }} data-subline-preview="">
                {UPGRADE_COPY.nothingToTranslate}
            </div>
        );
    }
    const provenance = ENGINE_PROVENANCE.relay;
    const label = preview.lang === undefined ? null : languageLabel(preview.lang);
    const langName = label === null ? null : languageName(label);
    return (
        <div style={{ fontSize: "0.95rem", color: TEXT_COLOUR, fontStyle: "italic" }} data-subline-preview="">
            <span style={{ color: "var(--text-muted)" }} title={`Translated by ${provenance.label}${langName === null ? "" : ` · ${langName}`}`}>
                {provenance.glyph}{label === null ? "" : ` ${label}`} ·{" "}
            </span>
            <span dir={translationDir()} style={TRANSLATION_TEXT_STYLE}>{preview.text}</span>
        </div>
    );
}

function TranslationAccessory({ message }: { message: Message; }) {
    const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);

    React.useEffect(() => {
        // Two independent publishers, same subscribe/notify shape: the
        // translation store's own subscribe() for the four resolved states,
        // and forcedInFlight's for the manual ⚡ click's transient "still
        // running" state (see the comment on `forcedInFlight`). Either firing
        // must re-render this message's accessory.
        const unsubStore = subscribe(forceUpdate);
        const unsubForced = subscribeForcedInFlight(forceUpdate);
        // A channel switched on or off (here, or on another computer).
        const unsubChannels = subscribeChannels(forceUpdate);
        return () => {
            unsubStore();
            unsubForced();
            unsubChannels();
        };
    }, []);

    if (isFeatureOff("messages")) return null;
    if (!channelActive(message.channel_id)) return null;
    return withDecodedLine(message, translationLines(message));
}

/**
 * "decoded · morse · HAPPY BIRTHDAY": a message written entirely in a code, decoded on
 * this computer (decode.ts). Free on every plan and never sent anywhere. Any
 * translation of the decoded text (when it is foreign) renders under it as the
 * normal subtitle line. No ≈ or ✦ glyph: those name a translator, and nothing
 * translated this.
 */
function decodedLine(message: Message) {
    const decoded = decodeMessage(message.content);
    if (decoded === null) return null;
    return (
        <div style={{ fontSize: "0.95rem", color: TEXT_COLOUR, fontStyle: "italic" }}>
            <span style={{ color: "var(--text-muted)" }} title={DECODED_TITLE}>
                {decodedPrefix(decoded.kind)}
            </span>
            <span dir="auto" style={TRANSLATION_TEXT_STYLE}>{decoded.text}</span>
        </div>
    );
}

/** The decoded line (if any) above whatever the translation lines are. */
function withDecodedLine(message: Message, lines: any) {
    const decoded = decodedLine(message);
    if (decoded === null) return lines;
    if (lines === null) return decoded;
    return <div>{decoded}{lines}</div>;
}

/** Everything under a message except the decoded line. Hook-free; see TranslationAccessory. */
function translationLines(message: Message) {
    // No engine component: whatever engine produced this line, this is where
    // it is read from.
    const key = makeKey(message.id, settings.store.targetLang);
    const stored = getTranslation(key);
    // A line from an engine this build does not know (a Google line can only
    // come from an older build, and the store drops those on load) is never
    // shown: the message reads as having no entry.
    const entry: StoredTranslation | undefined = isRealTranslation(stored) && !Object.prototype.hasOwnProperty.call(ENGINE_PROVENANCE, stored.via)
        ? undefined
        : stored;

    // A manual ⚡ click currently out for this message. Read AFTER the store
    // lookup above but used throughout below — this is the one thing in this
    // component that is not itself a StoredTranslation, so it is threaded
    // through every branch rather than folded into `entry`.
    const forcing = isForcedInFlight(message.id);
    // The transient, self-clearing outcome of the MOST RECENT manual click —
    // present only once `forcing` has already come back down (see
    // forceQualityTranslate/setForcedHint), so a stale hint from an earlier
    // click can never render alongside a fresh "⚡ translating…". Never read
    // when `forcing` is true, for exactly that reason.
    const hint = forcing ? undefined : forcedHintFor(message.id);

    // A ⚡ translation while ✦ is off REPLACES whatever marker this message
    // has (a skip, ⏳, ⚠): one line. Only a real ✦ line from the store
    // outranks it.
    const preview = previewFor(message);
    if (preview !== undefined && !(isRealTranslation(entry) && rankOf(entry.via) >= 1)) return previewLine(preview);

    if (!entry) {
        // Nothing to show yet — UNLESS a forced request is why: the reader
        // clicked ⚡ on a message that had never been translated at all, and
        // would otherwise see nothing happen until the response lands,
        // possibly several seconds away.
        if (forcing) {
            return (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    ⚡ translating…
                </div>
            );
        }
        // Same reasoning, once the click has SETTLED without a store write —
        // exactly the case a failed forced request produces (see runTier).
        if (hint) {
            const { text, title } = forcedHintDisplay(hint);
            return (
                <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}
                    title={title}
                >
                    {text}
                </div>
            );
        }
        return null;
    }

    // A skipped message is already in the target language: there is nothing to
    // subtitle. This MUST come before the failure branch — the marker exists so
    // catch-up can tell "resolved, nothing to show" from "never requested", and
    // falling through would label a perfectly fine message "translation
    // failed". Same "nothing to show, but a forced click just changed that"
    // exception as the no-entry branch above: ⚡ is offered on a skipped
    // message too (see forceQualityPopoverRender), so this is a real,
    // reachable state, not a dead one.
    if ("skipped" in entry) {
        if (forcing) {
            return (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    ⚡ translating…
                </div>
            );
        }
        if (hint) {
            const { text, title } = forcedHintDisplay(hint);
            return (
                <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}
                    title={title}
                >
                    {text}
                </div>
            );
        }
        return null;
    }

    // Colours come from Discord's own theme tokens rather than a bare opacity:
    // the accessory container already renders muted, so stacking an opacity on
    // top compounded into invisible text on the dark theme.
    //
    // The token chain matters. Discord renamed its primary text token, so
    // --text-normal no longer resolves in current builds; an unresolvable var()
    // invalidates the whole declaration and the text silently inherits the
    // container's muted colour, i.e. becomes unreadable. --text-default is the
    // current name, --text-normal the legacy one, and the literal is a
    // dark-theme-readable last resort if Discord renames it again.
    if ("failed" in entry) {
        // The AI left this message out twice (runTier omittedMessage). Quiet,
        // and recoverable: ⚡ asks again.
        return (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }} title={UPGRADE_COPY.failedTitle} data-subline-failed="">
                {UPGRADE_COPY.failedLine}
                {forcing && " · ⚡ translating…"}
                {!forcing && hint && (
                    <span title={forcedHintDisplay(hint).title}> · {forcedHintDisplay(hint).text}</span>
                )}
            </div>
        );
    }

    // ⏳: ✦ got no answer about this message yet (no answer, a 5xx, a rate
    // limit, the relay cooling down). It is asked again by itself (runTier,
    // armDeferredRetry), so the line says so and nothing else: never blank
    // with no sign, never an alarm (0.2.9).
    if ("deferred" in entry) {
        return (
            <div
                style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}
                title={UPGRADE_COPY.waitingTitle}
                data-subline-waiting=""
            >
                {UPGRADE_COPY.waitingLine}
                {forcing && " · ⚡ translating…"}
                {!forcing && hint && (
                    <span title={forcedHintDisplay(hint).title}> · {forcedHintDisplay(hint).text}</span>
                )}
            </div>
        );
    }

    // ⚡ said this message is already in the reader's language: one short
    // line, never the message again.
    if (entry.same === true) {
        return (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }} data-subline-same="">
                {UPGRADE_COPY.nothingToTranslate}
                {forcing && " · ⚡ translating…"}
            </div>
        );
    }

    // The prefix says both WHAT language this was and WHERE it came from. The
    // whole prefix stays on the muted token and the body on the --text-default
    // chain. `title` spells the glyph out on hover, since a symbol alone can't
    // teach its own meaning. No label at all for "und", "zxx" or anything
    // that names no language.
    const provenance = ENGINE_PROVENANCE[entry.via];
    const label = languageLabel(entry.lang);
    const langName = label === null ? null : languageName(label);
    const title = `Translated by ${provenance.label}${langName === null ? "" : ` · ${langName}`}`;

    // SPEC §7 STEP 4, and the only thing this project accepts as proof the
    // install works: a translation reached the screen. Everything else the
    // installer can see — the patch, the load, even a translation sitting in
    // the store — is also true of the install described in spec §6, where a
    // Discord frontend change leaves the mod loading and rendering nothing.
    //
    // A timestamp assignment and nothing else, which is what makes it safe in a
    // render body: no React state, no counter, so a StrictMode double render or
    // a concurrent re-render produces exactly the same beacon as one render.
    recordRendered();

    return (
        <div style={{ fontSize: "0.95rem", color: TEXT_COLOUR, fontStyle: "italic" }}>
            <span style={{ color: "var(--text-muted)" }} title={title}>
                {provenance.glyph}{label === null ? "" : ` ${label}`} ·{" "}
            </span>
            {/*
              * LINE BREAKS SHOW. A two-line message came back as two lines and
              * was painted as one: HTML collapses "\n" to a space unless the
              * text says otherwise. pre-wrap keeps the breaks and still wraps.
              */}
            {/*
              * dir: the reader's language decides the direction, and [dir]
              * isolates the text from the ✦ prefix and the hints after it.
              * "auto" for left-to-right targets, so a line that is still in
              * the source script takes its own direction.
              */}
            <span dir={translationDir()} style={TRANSLATION_TEXT_STYLE}>{cleanTranslation(entry.text.trim(), message.content ?? "")}</span>
            {/*
              * ALONGSIDE the line above, never instead of it — a forced click
              * on a message that already carries a line must not take that
              * readable line away while the request is out. Same muted token
              * as the provenance prefix. The settled-failure hint gets the
              * identical treatment once the click comes back down.
              */}
            {forcing && (
                <span style={{ color: "var(--text-muted)" }}> · ⚡ translating…</span>
            )}
            {!forcing && hint && (
                <span style={{ color: "var(--text-muted)" }} title={forcedHintDisplay(hint).title}>
                    {" "}· {forcedHintDisplay(hint).text}
                </span>
            )}
        </div>
    );
}

/**
 * Registered separately from `messagePopoverButton` below, via the lower-level
 * `@api/MessagePopover` — the same real mechanism `messagePopoverButton`
 * itself is backed by (see `startPlugin`/`stopPlugin` in Vencord's
 * `PluginManager.ts`), just called under a second identifier. `definePlugin`'s
 * declarative field only ever holds ONE button, because PluginManager
 * registers it keyed by the plugin's own name; a second, independently
 * visible action needs its own key. This is not a new registration mechanism,
 * only a second use of the one Vencord already provides for exactly this.
 */
export const FORCE_QUALITY_POPOVER_ID = "VcTranslate-forceQuality";

/** The 🌐 popover button: on is the globe, off the same globe dimmed (P2). */
const CHANNEL_ICON_ON = { fontSize: "1rem" } as const;
const CHANNEL_ICON_OFF = { fontSize: "1rem", opacity: 0.4, filter: "grayscale(1)" } as const;
/**
 * The 🌐 itself: on is the globe, off the same globe dimmed. It follows the
 * lists as they change (a click here, or a choice made on another computer
 * of the same account), not only when the popover is drawn again.
 */
function ChannelGlobe({ channelId }: { channelId: string; }) {
    const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribeChannels(forceUpdate), []);
    const on = channelActive(channelId);
    return <span style={on ? CHANNEL_ICON_ON : CHANNEL_ICON_OFF} data-subline-channel-icon={on ? "on" : "off"}>🌐</span>;
}
/** The toast when the 🌐 switch could not be saved. */
const CHANNEL_TOGGLE_FAILED = "Couldn't save that. Try again.";

/**
 * The ⚡ popover action: "spend one of the LLM's requests on THIS message,
 * right now." Distinct from the 🌐 channel toggle above (which is a per-CHANNEL
 * setting, no request involved) both in glyph — so the two are never confused
 * in the hover toolbar — and in what it does: a one-shot, per-MESSAGE spend.
 *
 * With ✦ on it is offered on EVERY message (decision 3: ⚡ always gives a
 * translation): a press asks again, forced, even over a ✦ line or a skip.
 * With ✦ off it is one of the day's five (a preview), hidden once ✦ has
 * spoken for the message. Hidden with nothing paid for.
 */
function forceQualityPopoverRender(message: Message) {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return null;

    // Nothing paid for: nothing to press.
    if (!activated()) return null;
    // ✦ off: a ✦ PREVIEW, one of the day's five, on any message.
    const preview = !aiOn() && isAutomaticOnly();
    if (!aiOn() && !preview) return null;

    const key = makeKey(message.id, settings.store.targetLang);

    if (preview) {
        // A preview: nothing to ask once ✦ translated it. A ✦ skip is no
        // answer to a reader who asks: ⚡ stays, and a press is forced. An AI
        // subscriber keeps ⚡ on every message (below), even one ✦ translated.
        if (hasQualityTranslation(key)) return null;
        // A new UTC day is a new five, so yesterday's "used up" never
        // outlives midnight on the button.
        if (rolloverTasteIfNewUtcDay()) void refreshEntitlement();
        if (tasteExhausted()) {
            // Today's five are used, so a press would send nothing. Offer the
            // one thing that does help: the plan panel ("No AI translations
            // left today · Subscribe", decision 6). While a payment is on its
            // way, say that instead (P4); a press says what happens next.
            if (isPaymentPending()) {
                return {
                    label: UPGRADE_COPY.paymentPending,
                    icon: () => <span style={{ fontSize: "1rem" }}>⚡</span>,
                    message,
                    channel,
                    onClick: () => openUpgrade()
                };
            }
            return {
                label: UPGRADE_COPY.popoverUpgrade,
                icon: () => <span style={{ fontSize: "1rem" }}>⚡</span>,
                message,
                channel,
                onClick: () => openUpgrade()
            };
        }
        // Nothing to offer once one has been asked for this text of the
        // message: asking again would spend another of the five for the same
        // answer. An edit is new text, so it is offered again.
        if (previewTaken(message)) return null;
        return {
            label: UPGRADE_COPY.popoverPreview.replace("{n}", String(tasteRemaining())),
            icon: () => <span style={{ fontSize: "1rem" }}>⚡</span>,
            message,
            channel,
            onClick: () => {
                void forceQualityTranslate(message);
            }
        };
    }
    // Say what pressing this would actually do — the user should not have to
    // guess whether ⚡ is worth clicking right now, and the wording has to
    // stay honest when the answer is "nothing" (cooling down, or not ready).
    //
    // Checked FIRST, ahead of the quota description: a forced request already
    // out for THIS message (the same forcedInFlight guard forceQualityTranslate
    // itself checks) means a click right now does nothing at all, which
    // outranks readiness. See TranslationAccessory's own `⚡ translating…`
    // line for the same state reflected on the message.
    //
    // A countdown, not a count, is the only number it shows (ready /
    // cooling / a wait): the ✦ button carries no number at all.
    const quota = describeQuotaState(ENGINE);
    const spendDescription = forcedInFlight.has(message.id)
        ? "already translating…"
        : quota.cooling
            ? `cooling down, ${formatCountdown(quota.remainingMs)} left`
            : quota.ready
                ? "ready to send now"
                : `not ready, ${formatCountdown(quota.remainingMs)} left`;

    // And the plan state, as the ✦ button says it: where there is no message
    // box (or the ✦ button is hidden), ⚡ is where the state shows.
    return {
        label: `Translate with AI now (${spendDescription}) · ${currentPlanView().hover}`,
        icon: () => <span style={{ fontSize: "1rem" }}>⚡</span>,
        message,
        channel,
        onClick: () => {
            void forceQualityTranslate(message);
        }
    };
}

/**
 * THE ✦ BUTTON in the message box (0.2.9 spec, decision 11): the one place
 * that shows the plan state, in every state, next to the message input via
 * Vencord's `@api/ChatButtons` (`chatBarButton` below).
 *
 *  - On (a period, not started yet, subscribed, a buyer): VIBRANT. The ✦ is
 *    a moving colour gradient with a glow that pulses, so the shine is
 *    plain to see whether it is on or off. A reader who asked for less
 *    motion (prefers-reduced-motion) gets the same colours and a still glow.
 *  - Off: the same ✦, grey. Same box, same size in every state; no text and
 *    no number on it (the hidden daily ceiling is never shown).
 *  - The hover text says the state (planState.ts); a click opens the plan
 *    panel (openUpgradeForLevel: the Link first when not linked).
 *
 * Not drawn where Discord draws no buttons (a channel the reader cannot type
 * in), and gone when the reader hides it (Vencord's right-click hide): then
 * ⚡ and Subline → Settings say the state, and the one-time panels still
 * come (they do not depend on this button).
 *
 * LIVE: redrawn on every relay answer and payment change, and at the moment
 * a running period ends (it turns grey then, with no answer needed), and
 * once a minute for the days left.
 */
export const SPARK_CLASS = "subline-spark";

/** The button's own style: drawn with it, so nothing outlives the plugin. */
export const SPARK_CSS = `
@keyframes subline-spark-flow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@keyframes subline-spark-shine {
  0%, 100% { filter: saturate(0.85) brightness(0.9) drop-shadow(0 0 1px rgba(255, 176, 32, 0.55)); }
  50% { filter: saturate(0.85) brightness(0.95) drop-shadow(0 0 2.5px rgba(255, 79, 163, 0.6)); }
}
.${SPARK_CLASS} { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; font-size: 16px; line-height: 1; font-weight: 700; user-select: none; }
.${SPARK_CLASS}-on {
  background: linear-gradient(90deg, #ffb020, #ff4fa3, #a855f7, #38bdf8, #34d399, #ffb020);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: subline-spark-flow 3s linear infinite, subline-spark-shine 2.4s ease-in-out infinite;
}
.${SPARK_CLASS}-off { color: var(--interactive-normal, #b5bac1); opacity: 0.5; filter: grayscale(1); }
@media (prefers-reduced-motion: reduce) {
  .${SPARK_CLASS}-on {
    animation: none;
    filter: saturate(0.85) brightness(0.9) drop-shadow(0 0 1.5px rgba(255, 79, 163, 0.55));
  }
}
`;

/** The longest single wait for the end of a period (SparkButton): a day. */
const SPARK_END_STEP_MS = 24 * 60 * 60_000;

function SparkButton(props: ChatBarProps & { isMainChat: boolean; isAnyChat: boolean; }) {
    const [, redraw] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribeEntitlement(redraw), []);
    React.useEffect(() => subscribePaymentPending(redraw), []);
    React.useEffect(() => {
        const id = setInterval(redraw, 60_000);
        return () => clearInterval(id);
    }, []);
    const view = currentPlanView();
    // A running period turns grey the moment it ends, not up to a minute later.
    // However far off the end is (a promo's 30 days are past what one timer
    // can wait), timers of at most a day are chained up to it, so a button
    // drawn on day 1 and kept open still redraws at the end itself.
    const endsAt = view.on ? getEntitlement()?.access?.endsAt : undefined;
    React.useEffect(() => {
        if (endsAt === undefined) return;
        let id: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
            const wait = endsAt - Date.now();
            if (wait < 0) return;
            const step = wait + 50;
            id = step > SPARK_END_STEP_MS ? setTimeout(arm, SPARK_END_STEP_MS) : setTimeout(redraw, step);
        };
        arm();
        return () => clearTimeout(id);
    }, [endsAt]);
    // The edit box and other small bars: only the main and side message boxes.
    if (props?.isAnyChat === false) return null;
    return (
        <ChatBarButton tooltip={view.hover} onClick={() => openUpgradeForLevel()}>
            <style>{SPARK_CSS}</style>
            <span
                className={`${SPARK_CLASS} ${SPARK_CLASS}-${view.on ? "on" : "off"}`}
                data-subline-spark={view.on ? "on" : "off"}
                aria-hidden="true"
            >
                ✦
            </span>
        </ChatBarButton>
    );
}

/* ------------------------------------------------------------ surfaces -- */

/*
 * TEXT OUTSIDE MESSAGES, WHILE ✦ IS ON. Custom statuses, bios, embeds,
 * polls, reply and forward previews, and the open channel's topic, thread
 * title, tags and live event. See surfaces/ for the cache, the batching
 * service and the components; this section is the wiring into the plugin's
 * engines, plan and Discord.
 *
 * Every hook here is one Discord already renders through a Vencord API this
 * plugin already relies on (message accessories, member list decorators, the
 * chat bar), plus one webpack patch reused from Vencord's own UserVoiceShow
 * (the profile's name row). A slot that is not there after a Discord update
 * renders nothing; nothing else changes.
 */

let surfaceCache: SurfaceCache | null = null;
let surfaceService: SurfaceService | null = null;
let surfaceBudget: SurfaceBudget | null = null;

/** The message-accessory id the surfaces register. */
export const SURFACE_ACCESSORY_ID = "VcTranslateSurfaces";

/**
 * Surfaces are translated while ✦ is on (0.2.9: there is no Google ≈ for an
 * install whose ✦ is off), with the setting on. Anything else gets Discord
 * exactly as it was.
 */
function isPaidSurfaceUser(): boolean {
    if (surfaceService === null) return false;
    if (settings.store.translateSurfaces === false) return false;
    return aiOn();
}

/**
 * Names and pronouns (0.2.8): while ✦ is on, with the "Names and pronouns"
 * setting on. Its own setting, not the surfaces one.
 */
function isNamesUser(): boolean {
    if (surfaceService === null) return false;
    if (settings.store.translateNames === false) return false;
    return aiOn();
}

/** Whether surfaces may ask the relay (✦): only while ✦ is on. */
function surfaceQualityAllowed(): boolean {
    return aiOn();
}

function surfaceDebug(message: string): void {
    if (settings.store.debugLogging) logger.debug(message);
}

/**
 * One surface batch through the same relay, credential, cooldowns and rate
 * gate as messages, with NO conversation context. Surface requests count
 * against the same daily ceiling on the relay (they are ordinary relay
 * requests). Any refusal is quiet: `null` ("not now") and the cooldown the
 * message pipeline would also have recorded. Never a toast.
 */
async function translateSurfaceBatch(texts: string[], options?: SurfaceSendOptions): Promise<SurfaceOutcome> {
    // "busy" for every refusal BEFORE anything is sent: it costs the
    // surfaces no per-minute slot and is asked again in seconds (see
    // SurfaceOutcome). `null` is kept for a request that went out.
    if ((!isPaidSurfaceUser() && !isNamesUser()) || !surfaceQualityAllowed()) { surfaceDebug("[surface] held: no AI, or both settings off"); return "busy"; }
    // The relay cooling down or held (a refusal about the plan, the daily
    // ceiling): messages wait too, so surfaces do not ask either.
    if (Date.now() < relayWaitUntil()) { surfaceDebug("[surface] held: the relay asked to wait"); return "busy"; }
    // MESSAGES FIRST. A surface request takes a rate-gate slot only when no
    // message request is out or waiting at the gate, never queues for one,
    // and leaves two slots free, so even a second message batch right after
    // does not wait. Messages still in the batcher's window do not hold it
    // (see qualityRequestsOut).
    if (qualityRequestsOut > 0 || !tryAcquireIdleSlot(2)) { surfaceDebug(`[surface] held: messages first (${qualityRequestsOut} out, or no free slot)`); return "busy"; }
    const req: BatchRequest = {
        // Custom emoji never go out (customEmoji.ts). A bio's key is its raw
        // text, so this is where they are taken out.
        messages: texts.map((text, i) => ({ id: `s${i}`, author: "", text: dropCustomEmoji(text) })),
        context: [],
        targetLang: settings.store.targetLang,
        // A ✦ click on a name: the relay translates it, never skips it.
        ...(options?.force === true ? { force: true as const } : {})
    };
    let res: Awaited<ReturnType<typeof transport.translateBatch>>;
    try {
        const { credential, install } = await relayCredentials();
        res = await transport.translateBatch(ENGINE, credential, JSON.stringify(req), "", settings.store.debugLogging, install);
    } catch {
        return null;
    }
    if (!res.ok) {
        surfaceDebug(`[surface] relay: not ok (${beaconErrorCode(res)})`);
        if (res.errorCode === "ai_paused") {
            // The hidden daily ceiling: the same hold and notice as messages.
            pausedUntil = Date.now() + (typeof res.retryAfterMs === "number" && res.retryAfterMs > 0 ? res.retryAfterMs : DEFAULT_COOLDOWN_MS);
            showPausedNotice();
        } else if (isEntitlementRefusal(res.errorCode)) {
            planHeldUntil = Date.now() + PLAN_REFUSAL_HOLD_MS;
            refreshAfterRefusal();
        } else if (res.retryAfterMs) {
            enterCooldown(ENGINE, res.retryAfterMs, res.quotaLimitPerMinute, res.error);
        } else if (/\bHTTP 401\b/.test(res.error)) {
            refreshAfterRefusal();
        }
        return null;
    }
    relayFailing = false;
    const byId = new Map(res.results.map(r => [r.id, r]));
    return texts.map((_, i) => {
        const r = byId.get(`s${i}`);
        if (r === undefined || "failed" in r) return "fail";
        if (r.skip) return "skip";
        if (r.truncated) return "fail";
        return { lang: r.lang, text: r.text };
    });
}

/**
 * P9: the last relay request for messages got no answer (down, timed out, a
 * 5xx, malformed). Surfaces read it through `qualityPaused`, so no ✦ click
 * is offered on a name while the relay is down. Cleared by the next relay
 * answer, from messages or surfaces.
 */
let relayFailing = false;

function startSurfaces(): SurfaceService {
    surfaceCache = new SurfaceCache({
        storage: { get: key => DataStore.get(key), set: (key, value) => DataStore.set(key, value) },
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
    });
    surfaceBudget = new SurfaceBudget(
        { get: key => DataStore.get(key), set: (key, value) => DataStore.set(key, value) },
        () => Date.now()
    );
    surfaceService = new SurfaceService({
        isPaid: isPaidSurfaceUser,
        namesAllowed: isNamesUser,
        qualityAllowed: surfaceQualityAllowed,
        qualityPaused: () => relayFailing || Date.now() < relayWaitUntil(),
        targetLang: () => settings.store.targetLang,
        locallySkipped: text => shouldSkip(text, false, settings.store.targetLang) || isConfidentlyTargetLanguage(text, settings.store.targetLang),
        translate: translateSurfaceBatch,
        cache: surfaceCache,
        budget: surfaceBudget,
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        debug: surfaceDebug
    });
    setSurfaceService(surfaceService);
    setSurfaceRtl(() => isRtlLang(settings.store.targetLang));
    return surfaceService;
}

/** For tests: the running surface service, or null. */
export function __surfaceService(): SurfaceService | null {
    return surfaceService;
}

/** Embeds, polls and forwards of one message, as small lines under it. */
function SurfaceAccessoryImpl({ message }: { message: Message; }) {
    if (isFeatureOff("messages") || !isPaidSurfaceUser() || message == null) return null;
    const channelId = (message as any).channel_id as string;
    // THE SAME RULE AS MESSAGES. A DM, a group DM, or a channel the reader
    // switched off sends nothing, embeds and polls included. A DM the reader
    // opted in is translated like its messages are.
    if (typeof channelId !== "string" || !channelActive(channelId)) return null;
    const texts: SurfaceText[] = messageSurfaceTexts(message)
        .map(t => ({ ...t, text: readableContent(t.text, channelId) }));

    // Reply previews are NOT here: a "Reply" line above the message's own
    // line read as the message's translation. The quoted message's
    // translation is shown in place in Discord's reply bar instead
    // (replyQuoteChildren).
    if (texts.length === 0) return null;
    return <SurfaceLines texts={texts} />;
}
const SurfaceAccessory = safe("message accessory", SurfaceAccessoryImpl, surfaceDebug);

/** Is `userId` the reader themselves? Their own text is never translated. */
function isCurrentUser(userId: unknown): boolean {
    try {
        return typeof userId === "string" && userId !== "" && userId === UserStore.getCurrentUser()?.id;
    } catch {
        return false;
    }
}

/**
 * Is this a server (guild) channel? Channel-level surfaces (topics, voice
 * status, thread and forum titles, tags, stage topics, event and rules text)
 * are only ever translated there: NEVER in a DM or group DM, which have no
 * guild_id.
 */
function isGuildChannel(channel: unknown): boolean {
    const guildId = (channel as any)?.guild_id;
    return typeof guildId === "string" && guildId !== "";
}

/**
 * Channel-level text follows THE SAME RULE AS MESSAGES in that channel: only
 * where messages would be translated (Global Auto and the per-channel switch),
 * and never in a DM or group DM.
 */
function channelTextAllowed(channel: unknown): boolean {
    const id = (channel as any)?.id;
    return isGuildChannel(channel) && typeof id === "string" && channelActive(id);
}

function channelIdTextAllowed(channelId: unknown): boolean {
    return typeof channelId === "string" && channelTextAllowed(ChannelStore.getChannel(channelId));
}

/**
 * What each wrapped Discord parser translates, and whether it has room for a
 * line. `parseTopic` also renders a voice channel's description, so the label
 * is the neutral "Description", not "Topic". `guildOnly: false` is for
 * membership rules, which only exist in a server and may be rendered with no
 * channel id at all.
 */
const PARSER_SURFACES: Record<string, { kind: SurfaceKind; label: string; tight: boolean; guildOnly: boolean; }> = {
    "topic": { kind: "topic", label: "Description", tight: false, guildOnly: true },
    "topic-truncated": { kind: "topic", label: "Description", tight: true, guildOnly: true },
    "voice-status": { kind: "voice-status", label: "Voice status", tight: true, guildOnly: true },
    "rule": { kind: "rule", label: "Rule", tight: false, guildOnly: false },
    "guidelines": { kind: "guidelines", label: "Guidelines", tight: false, guildOnly: true },
    "event": { kind: "event", label: "Event", tight: false, guildOnly: true }
};

/**
 * May this parser's text go, given Discord's parser state? A channel id means
 * the channel's own rule (as for messages). An event with no channel follows
 * the guild-level rule: allowed in a server.
 */
function parserStateAllowed(parser: string, state: unknown): boolean {
    const s = state as { guildId?: unknown; channelId?: unknown } | null | undefined;
    if (typeof s?.channelId === "string" && s.channelId !== "") return channelIdTextAllowed(s.channelId);
    return parser === "event" && typeof s?.guildId === "string" && s.guildId !== "";
}

/**
 * What a wrapped Discord parser returns: its own output untouched, plus, for
 * a paid install and a foreign text in a channel that translates messages, a
 * small line after it (roomy) or the translation in its place once ✦ has it
 * (tight: the header topic, voice status). Anything else returns Discord's
 * output exactly as made. Called only through its crash guard (wrapParser):
 * a throw here gives Discord's output and is reported.
 */
export function decorateParsed(parser: string, args: unknown[], out: unknown, reparse?: (text: string) => unknown): unknown {
    const source = args[0];
    if (!isPaidSurfaceUser() || typeof source !== "string" || source.trim() === "") return out;
    const spec = PARSER_SURFACES[parser];
    if (spec === undefined) return out;
    if (spec.guildOnly && !parserStateAllowed(parser, args[2])) return out;
    // What goes to the relay is the READABLE text: mentions as names,
    // custom emoji as :name:. Never raw <#id>, <@id> or <:name:id> tokens.
    const channelId = (args[2] as { channelId?: unknown } | null | undefined)?.channelId;
    const markup = markupFor(source, typeof channelId === "string" ? channelId : null);
    const texts: SurfaceText[] = [{ kind: spec.kind, label: spec.label, text: markup.readable }];
    if (!spec.tight) return [out, <SurfaceLines key="subline-surface" texts={texts} />];
    return (
        <TightSwap
            key="subline-surface"
            original={out}
            text={markup.readable}
            tooltip={markup.readable}
            render={translation => renderWithMarkup(translation, markup.tokens, reparse, source)}
        />
    );
}

/** Raw Discord tokens: a custom emoji, a channel, role or user mention. */
const RAW_TOKEN = /<a?:\w+:\d+>|<#\d+>|<@&\d+>|<@!?\d+>/;
const RAW_TOKENS = /<a?:\w+:\d+>|<#\d+>|<@&\d+>|<@!?\d+>/g;

/**
 * A text's readable form (what is sent), plus each raw token paired with its
 * readable form, so the translation can have its mentions and emoji put back
 * before Discord's own parser renders it.
 */
function markupFor(source: string, channelId: string | null): { readable: string; tokens: Array<[string, string]>; } {
    const resolve = (text: string) => channelId === null ? text : readableContent(text, channelId);
    const tokens: Array<[string, string]> = [];
    for (const raw of new Set(source.match(RAW_TOKENS) ?? [])) {
        const readable = resolve(raw);
        if (readable !== raw && readable !== "") tokens.push([readable, raw]);
    }
    // Longest first, so "@Ann" never eats part of "@Anna".
    tokens.sort((a, b) => b[0].length - a[0].length);
    return { readable: resolve(source), tokens };
}

/**
 * The translated text as Discord renders it: readable mentions and emoji
 * turned back into Discord's tokens, then Discord's own parser. Null (keep
 * Discord's original) when the model answered with raw tokens of its own,
 * or when anything throws.
 */
function renderWithMarkup(translation: string, tokens: Array<[string, string]>, parse?: (text: string) => unknown, source = ""): unknown {
    try {
        // Custom emoji junk out first (an id, :NAME:, a raw emoji token): a
        // translation is shown without it, never replaced by the original.
        const cleaned = cleanTranslation(translation, source);
        if (cleaned.trim() === "") return null;
        if (RAW_TOKEN.test(cleaned)) return null;
        let restored = cleaned;
        for (const [readable, raw] of tokens) restored = restored.split(readable).join(raw);
        return parse ? parse(restored) : restored;
    } catch {
        return null;
    }
}

/** Each wrapped parser's feature, for the owner's off switch. */
const PARSER_FEATURES: Readonly<Record<string, FeatureId>> = {
    "topic": "topic", "topic-truncated": "topic", "voice-status": "voice-status", "rule": "rules", "guidelines": "guidelines", "event": "event"
};

/** decorateParsed, crash-guarded: Discord's own output on a throw or with the feature off. */
const decorateGuarded = guard(
    "wrapParser",
    (args: [string, unknown[], unknown, ((text: string) => unknown)?]) => args[2],
    (...args) => PARSER_FEATURES[args[0]] ?? null,
    decorateParsed
);

/**
 * Wrap one of Discord's parser functions. Runs when Discord loads the parser
 * module, so it must never throw (its guard hands back `fn`): anything but a
 * function is returned as is. Discord's own parse runs OUTSIDE the guard, so
 * a throw of Discord's stays Discord's; only Subline's part is guarded.
 */
function wrapParser(parser: string, fn: unknown): unknown {
    if (typeof fn !== "function") return fn;
    const original = fn as (...args: unknown[]) => unknown;
    return function (this: unknown, ...args: unknown[]) {
        const self = this;
        const out = original.apply(self, args);
        return decorateGuarded(
            parser, args, out,
            // The same parser, with the same state, for the translation.
            text => original.apply(self, [text, ...args.slice(1)])
        );
    };
}

/** Called only through a crash guard (stageTopicProps, threadTitleProps): a throw gives `{ children: text }`. */
function overflowProps(text: unknown, channel: unknown): Record<string, unknown> {
    const children = tightChildren(text, text, channel);
    if (children === text || typeof text !== "string") return { children: text };
    return { children, "aria-label": tightTranslation(text)?.text ?? text };
}

/**
 * THE ORIGINAL CHILD, UNTOUCHED, unless this is a paid install and the text's
 * channel translates messages. Then Discord's child stays until ✦ has the
 * text, and the translation takes its place ("✦ ...", the original in the
 * tooltip). It sits inside Discord's own element, so it keeps Discord's
 * styling and truncation. Called only through a crash guard.
 */
function tightChildren(original: unknown, text: unknown, channel: unknown): unknown {
    if (!isPaidSurfaceUser() || !channelTextAllowed(channel) || typeof text !== "string" || text.trim() === "") return original;
    return <TightSwap key="subline-surface" original={original} text={text} />;
}

/**
 * The reply bar's quoted line, translated in place ("✦ ...", the original in
 * the tooltip). The message store's translation is reused when there is one
 * (never bought twice). Only when there is none, the quoted message is not in
 * its channel's loaded list (the message pipeline has it), and its channel
 * translates messages, is it asked for, as a ✦-only surface. Until then, and
 * for anything Discord hides, Discord's own quoted line.
 */
function ReplyQuoteImpl({ original, referenced }: { original: unknown; referenced: any; }) {
    const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribe(forceUpdate), []);
    const fallback = (original ?? null) as any;
    const quoted = referenced?.message;
    const content = typeof quoted?.content === "string" ? quoted.content : "";
    const channelId = quoted?.channel_id;
    if (typeof quoted?.id !== "string" || typeof channelId !== "string" || content.trim() === "") return fallback;
    const markup = markupFor(content, channelId);
    // A quoted message with a code in it shows decoded, in place, the way a
    // translation does (original on hover). Decoding is local and free, so
    // this is on every plan, wherever the message's own decoded line shows.
    const decoded = channelActive(channelId) ? decodedInPlace(content, channelId) : null;
    if (!isPaidSurfaceUser()) return decoded ?? fallback;
    // Discord's markdown parser renders the translation, so mentions, links
    // and emoji look as they do in the original.
    const render = (translation: string) =>
        renderWithMarkup(translation, markup.tokens, text => Parser.parse(text, true, { channelId }), content);
    const stored = getTranslation(makeKey(quoted.id, settings.store.targetLang));
    // A line from an engine this build does not know (an older build's
    // Google line) is never shown, here either: read as no line.
    const existing = isRealTranslation(stored) && !Object.prototype.hasOwnProperty.call(ENGINE_PROVENANCE, stored.via) ? undefined : stored;
    if (existing !== undefined && "skipped" in existing) return decoded ?? fallback;
    // Already in the reader's language (a ⚡ answer): the original stays.
    if (isRealTranslation(existing) && existing.same === true) return decoded ?? fallback;
    if (isRealTranslation(existing)) {
        const shown = render(existing.text.trim());
        if (shown === null || shown === undefined) return fallback;
        const glyph = ENGINE_PROVENANCE[existing.via].glyph;
        return (
            <span title={markup.readable} data-subline-surface="in-place">
                <span style={{ opacity: 0.75 }}>{glyph} </span><span dir={translationDir()}>{shown as any}</span>
            </span>
        );
    }
    if (decoded !== null) return decoded;
    if (!channelActive(channelId) || isLoadedInChannel(channelId, quoted.id)) return fallback;
    return <TightSwap original={original} text={markup.readable} tooltip={markup.readable} render={render} />;
}
// Not safe(): that renders nothing on a throw. replyQuoteChildren's crash guard
// puts it in a SurfaceBoundary, which renders Discord's own line instead.
const ReplyQuote = ReplyQuoteImpl;

/**
 * The quoted text with its code decoded in place ("decoded · HAPPY BIRTHDAY
 * @Gojer"), the readable original as its tooltip. Null when it has no code.
 */
function decodedInPlace(content: string, channelId: string) {
    const d = decodeMessage(content);
    if (d === null) return null;
    // The code as written (mentions made readable), not the decoded text the
    // translation pipeline judges.
    let readable = content;
    try {
        readable = renderDiscordMarkup(content, markupResolversFor(channelId));
    } catch {
        readable = content;
    }
    const text = d.inPlace ?? d.text;
    let shown: unknown = text;
    try {
        shown = Parser.parse(text, true, { channelId }) ?? text;
    } catch {
        shown = text;
    }
    return (
        <span title={readable} data-subline-surface="in-place">
            <span style={{ opacity: 0.75 }}>{decodedPrefix(d.kind)}</span>{shown as any}
        </span>
    );
}

/** Discord's MessageFlags.HIDDEN_SUSPENDED_USER (1 << 17), checked the way Discord checks it. */
const HIDDEN_SUSPENDED_USER = 1 << 17;

function isHiddenSuspended(message: any): boolean {
    try {
        if (typeof message?.hasFlag === "function") return message.hasFlag(HIDDEN_SUSPENDED_USER) === true;
        return typeof message?.flags === "number" && (message.flags & HIDDEN_SUSPENDED_USER) !== 0;
    } catch {
        return true;
    }
}

/** Is this message in the currently loaded message list of its channel? */
function isLoadedInChannel(channelId: string, messageId: string): boolean {
    try {
        const list: any = MessageStore.getMessages(channelId);
        if (list == null) return false;
        if (typeof list.has === "function") return list.has(messageId) === true;
        const all: any[] = typeof list.toArray === "function" ? list.toArray() : [];
        return all.some(m => m?.id === messageId);
    } catch {
        return false;
    }
}

/**
 * Set the first time Discord renders an option card through the card patch
 * (onboardingOptionLines), for the rest of the session: the cards carry
 * their options' lines, so the heading does not.
 */
let onboardingCardsSeen = false;

/**
 * Lines under an onboarding question: the question's own line, then the
 * options whose original is not next to them, each with that original
 * (surfaces/extract.ts onboardingHeadingTexts). Discord renders the option
 * cards after this, in the same pass, so whether the card patch is live is
 * known only once that pass is committed: until then the cards are taken as
 * live, so a working card patch never shows an option twice, not even for a
 * frame. If no card reported by then (Discord moved the card), every option
 * shows here instead. Asked again for each question shown (by its id).
 */
function OnboardingLinesImpl({ prompt }: { prompt: unknown; }) {
    const id = typeof (prompt as any)?.id === "string" ? (prompt as any).id as string : "";
    const [committedFor, setCommittedFor] = React.useState<string | null>(null);
    React.useEffect(() => { setCommittedFor(id); }, [id]);
    if (!isPaidSurfaceUser()) return null;
    const { lines, pairs } = onboardingHeadingTexts(prompt, onboardingCardsSeen || committedFor !== id);
    if (lines.length === 0 && pairs.length === 0) return null;
    return (
        <>
            {lines.length > 0 && <SurfaceLines texts={lines} />}
            {pairs.length > 0 && <SurfaceLines texts={pairs} withOriginal />}
        </>
    );
}
const OnboardingLines = safe("onboarding lines", OnboardingLinesImpl, surfaceDebug);

/** Lines inside one option card, under its title and description. */
function OnboardingOptionLinesImpl({ option }: { option: unknown; }) {
    if (!isPaidSurfaceUser()) return null;
    const texts = onboardingOptionTexts(option);
    return texts.length === 0 ? null : <SurfaceLines texts={texts} />;
}
const OnboardingOptionLines = safe("onboarding option lines", OnboardingOptionLinesImpl, surfaceDebug);

/* ------------------------------------------------- names and pronouns -- */

/**
 * A name, with its translation on hover (0.2.8): Discord's own child,
 * untouched, unless this install has a plan with "Names and pronouns" on,
 * the name is not the reader's own, and it holds a letter in a script the
 * reader does not read (names.ts). Then the same child inside a hover
 * (namesUi.tsx), which checks the script again on every render. A name the
 * reader reads gets nothing at all, on any plan (owner rule 3, 2026-10-16).
 * A name only in letters no reading language uses (runes, names.ts
 * aiOnlyName) gets the hover only where ✦ can be asked: an AI plan.
 * Discord's own child on any throw (the handler's crash guard). `userId` is
 * read inside the guard: a record Discord is still building may throw on a
 * property read.
 */
function nameHover(handler: HandlerId, original: unknown, name: unknown, userId: () => unknown): unknown {
    if (original == null || !isNamesUser() || isCurrentUser(userId())) return original;
    if (nameToTranslate(name, settings.store.targetLang) === null
        && (aiOnlyName(name) === null || currentSurfaceService()?.canAskQuality() !== true)) return original;
    return <SafeNameHover key="subline-name" handler={handler} original={original} name={name} />;
}

/**
 * The texts of one profile card: its display name (or server nickname), the
 * username when it is another name, and the pronouns. Never a server, channel
 * or role name. Null when none of them is in a script the reader does not
 * read: then nothing is appended and nothing is sent.
 */
function profileNameTexts(props: any) {
    const target = settings.store.targetLang;
    const names: unknown[] = [];
    const shown = typeof props?.displayName === "string" ? props.displayName.trim().toLocaleLowerCase() : "";
    for (const name of [props?.displayName, props?.user?.username]) {
        // The username only when it is another name, not the same in lower case.
        if (name !== props?.displayName && typeof name === "string" && name.trim().toLocaleLowerCase() === shown) continue;
        if (nameToTranslate(name, target) !== null) names.push(name);
        // Runes and the like: only where ✦ can be asked (namesUi.tsx ProfileNameLine).
        else if (aiOnlyName(name) !== null && currentSurfaceService()?.canAskQuality() === true) names.push(name);
    }
    const pronouns = props?.pronouns;
    if (names.length === 0 && pronounsToTranslate(pronouns, target) === null) return null;
    return { names, pronouns };
}

/** The id of the right-click item. An identifier, never shown. */
export const REPORT_MENU_ITEM_ID = "subline-report-translation";

/**
 * "Report translation" on the message right-click menu. Chosen over a hover
 * button because the hover toolbar is in front of every message all the time,
 * while the right-click menu is only opened on purpose, and a report is rare.
 * The item appears only on a message with a real Subline translation for the
 * reading language, and attaches that ONE message: its own text and the
 * translation shown, never any other message. Opening it sends nothing; the
 * reader reviews and presses Send. Never throws: a broken menu entry must not
 * break Discord's menu.
 */
export const reportContextMenu: NavContextMenuPatchCallback = (children, props) => {
    try {
        const message = props?.message as Message | undefined;
        if (!message || typeof message.id !== "string") return;
        const target = settings.store.targetLang;
        const report = reportFor(message.content, getTranslation(makeKey(message.id, target)) as any, target);
        if (!report) return;
        children.push(
            <Menu.MenuItem
                id={REPORT_MENU_ITEM_ID}
                key={REPORT_MENU_ITEM_ID}
                label={FEEDBACK_COPY.contextMenu}
                action={() => openReportModal(report)}
            />
        );
    } catch (err) {
        logger.warn("Couldn't add the report item to the message menu.", err);
    }
};

export default definePlugin({
    name: "VcTranslate",
    description: "Automatically translates incoming messages and shows them as subtitles.",
    // This is a local userplugin — do not attribute it to a Vencord maintainer
    // via `Devs.*`. Put your own handle here.
    authors: [{ name: "surfer", id: 0n }],
    settings,

    // "Report translation" on a message's right-click menu, only on a message
    // that shows a Subline translation. Declarative, so Vencord adds and
    // removes it with the plugin. See reportContextMenu.
    contextMenus: { message: reportContextMenu },

    renderMessageAccessory: props => (
        <TranslationAccessory message={props.message} />
    ),

    /*
     * Where Discord shows text outside messages. See surfaces/patches.ts:
     * every find and match there was checked against Discord's current
     * public web bundle, and each replacement fails on its own.
     */
    patches: SURFACE_PATCHES.map(({ find, replacement }) => ({ find, replacement })),
    // Every method below is called from a patch inside Discord's own code,
    // and every one is crash-guarded (surfaces/guard.tsx): on any throw, and
    // when the owner's off switch names its feature, it returns exactly what
    // Discord had there (null where the patch appends a child, the original
    // child where it wraps one), and every element it returns sits in a
    // boundary that renders Discord's original if it throws while rendering.
    // For anyone who is not a paid install each returns Discord's value too.
    // Every profile bio (the About Me section, the full profile, the DM side
    // profile, the minimal popout): Discord's own bio renderer element,
    // translated IN PLACE with a toggle at its end. Discord's element
    // unchanged for anyone not paid, for an empty bio, for the reader's own
    // bio, or on any throw.
    bioInPlace: guard("bioInPlace", "first", () => "bio", (original: unknown, userBio: unknown, userId?: unknown) => {
        if (!isPaidSurfaceUser() || original == null || typeof userBio !== "string" || userBio.trim() === "") return original;
        const uid = userId ?? (original as any)?.props?.userId;
        if (isCurrentUser(uid)) return original;
        return <BioInPlace element={original} bio={userBio} userId={uid} />;
    }),
    // Props for Discord's OverflowTooltip around a stage topic or a thread
    // title: exactly { children } as Discord had it for anyone not paid.
    // Paid: the in-place translation, and an aria-label that is always a
    // real string (the translation once known, else the original), since
    // the tooltip derives its label from string children only.
    stageTopicProps: guard("stageTopicProps", "props", () => "stage-topic", (topic: unknown, channel: unknown) => overflowProps(topic, channel)),
    threadTitleProps: guard("threadTitleProps", "props", () => "thread-title", (title: unknown, thread: unknown) => overflowProps(title, thread)),
    forumTitleChildren: guard("forumTitleChildren", "first", () => "forum-title",
        (original: unknown, channel: any) => tightChildren(original, channel?.name, channel)),
    // A tag pill knows its tag, not its channel: it follows the rule of the
    // channel being viewed (the forum, or a post in it).
    forumTagChildren: guard("forumTagChildren", "first", () => "forum-tag", (name: unknown) =>
        tightChildren(name, name, ChannelStore.getChannel(SelectedChannelStore.getChannelId() ?? ""))),
    // Member list and DM list: the custom status text (user-level, allowed
    // wherever it is shown).
    statusTextChildren: guard("statusTextChildren", "first", () => "status-list", (original: unknown, text: unknown) => {
        if (!isPaidSurfaceUser() || typeof text !== "string" || text.trim() === "") return original;
        if (decodeMessage(text) !== null) {
            const lead = typeof original === "string" ? /^\s*/.exec(original)![0] : "";
            return <>{lead}<DecodedStatus key="subline-surface" text={text} /></>;
        }
        return <TightSwap key="subline-surface" original={original} text={text} />;
    }),
    onboardingHeading: guard("onboardingHeading", "first", () => "onboarding", (heading: unknown, prompt: unknown) => {
        if (!isPaidSurfaceUser()) return heading;
        return [heading, <OnboardingLines key="subline-surface" prompt={prompt} />];
    }),
    // Inside each option card, after its title and description. Called for
    // every card Discord renders, so it also tells the heading the card patch
    // is live (before any other check: that is about the patch, not the plan).
    onboardingOptionLines: guard("onboardingOptionLines", "null", () => "onboarding", (option: unknown) => {
        onboardingCardsSeen = true;
        if (!isPaidSurfaceUser() || option === null || typeof option !== "object") return null;
        return <OnboardingOptionLines key="subline-surface" option={option} />;
    }),
    // The profile custom status: the translation IN PLACE of the status text
    // inside Discord's bubble, with a toggle at its end (see the patch). The
    // status string itself for anyone not paid, for the reader's own status
    // (which includes the live preview while they type one), or on a throw.
    statusBubbleText: guard("statusBubbleText", "first", () => "status-profile", (text: unknown, props: any) => {
        if (!isPaidSurfaceUser() || props?.sublineSelf === true || typeof text !== "string" || text.trim() === "") return text;
        // A status in a code: decoded here, then translated if foreign.
        if (decodeMessage(text) !== null) return <DecodedStatus text={text} />;
        return <StatusBubbleText text={text} userId={props?.sublineUser} />;
    }),
    // Called inside the bubble's render, as an input to its measuring effect.
    useSurfaceVersion: guardHook("useSurfaceVersion", "status-profile", useSurfaceVersion),
    // The reply bar's quoted line. Nothing for a blocked, ignored or
    // suspended author: Discord's own line, and nothing is sent.
    replyQuoteChildren: guard("replyQuoteChildren", "first", () => "reply-quote", (original: unknown, props: any) => {
        if (original == null) return original;
        if (props?.isReplyAuthorBlocked === true || props?.isReplyAuthorIgnored === true) return original;
        if (isHiddenSuspended(props?.referencedMessage?.message)) return original;
        // Nothing paid for: Discord's own value, untouched. With the
        // surfaces setting off, only a decoded code (local, free).
        if (!activated()) return original;
        if (!isPaidSurfaceUser() && decodeMessage(props?.referencedMessage?.message?.content) === null) return original;
        return <ReplyQuote original={original} referenced={props?.referencedMessage} />;
    }),
    wrapParser: guard("wrapParser", args => args[1], () => null, wrapParser),
    // NAMES AND PRONOUNS (0.2.8). One patch per place (see surfaces/patches.ts);
    // each method returns Discord's own value exactly for anyone without a
    // plan, with "Names and pronouns" off, for the reader's own name, for a
    // name in the reader's script without an AI plan, and on any throw.
    // The message author's name, and the replied-to author's in a reply
    // preview (the same component): props are Discord's username props.
    messageAuthorName: guard("messageAuthorName", "first", () => "name-message", (original: unknown, name: unknown, props: any) =>
        nameHover("messageAuthorName", original, name, () => props?.message?.author?.id ?? props?.userOverride?.id)),
    // A user mention in a message ("@name"): the user's own name is the text.
    mentionName: guard("mentionName", "first", () => "name-mention", (original: unknown, name: unknown, user: any) =>
        nameHover("mentionName", original, name, () => user?.id)),
    // The profile card (popout, full profile, DM side profile): a small grey
    // line under the name and the pronouns. Null (nothing appended) for
    // anyone without a plan, with the setting off, for the reader's own
    // profile, when there is nothing to show, or on any throw.
    profileNameLine: guard("profileNameLine", "null", () => "name-profile", (props: any) => {
        if (!isNamesUser() || isCurrentUser(props?.user?.id)) return null;
        const texts = profileNameTexts(props);
        if (texts === null) return null;
        return <SafeProfileNameLine key="subline-names" handler="profileNameLine" texts={texts} />;
    }),

    // Declarative — unlike the force-quality popover above, this is the ONLY
    // chat-bar button this plugin registers, so it needs no second, manual
    // registration through the lower-level `@api/ChatButtons` functions;
    // PluginManager registers and unregisters this field itself, exactly as
    // it does `messagePopoverButton` below. The ✦ plan button (SparkButton).
    chatBarButton: {
        icon: () => <span style={{ fontSize: "1rem" }}>✦</span>,
        render: SparkButton
    },

    messagePopoverButton: {
        icon: () => <span style={{ fontSize: "1rem" }}>🌐</span>,
        render(message: Message) {
            const channel = ChannelStore.getChannel(message.channel_id);
            if (!channel) return null;

            const on = channelActive(message.channel_id);
            return {
                label: on ? "Disable auto-translate here" : "Enable auto-translate here",
                // P2: off is the same globe, dimmed and grey. The fog emoji used
                // before rendered on Windows as a struck-through ≈.
                // Redrawn when the lists change, also from another computer (channelSync.ts).
                icon: () => <ChannelGlobe channelId={message.channel_id} />,
                message,
                channel,
                onClick: async () => {
                    try {
                        // Two lists, because "off here" means opposite things
                        // in the two modes: with globalAuto covering this
                        // channel it is an opt-out, otherwise it withdraws an
                        // opt-in (see channels.ts).
                        const nowOn = coveredByGlobalAuto(message.channel_id)
                            ? await toggleChannelOptOut(message.channel_id)
                            : await toggleChannel(message.channel_id);
                        // `becomingFocused: true` — the user just clicked a
                        // button on a message in this channel and explicitly
                        // asked for it to be translated. That click is a
                        // stronger statement of intent than the focus check
                        // exists to infer, and it is the one place where
                        // spending the budget was directly requested.
                        if (nowOn) catchUp(message.channel_id, { becomingFocused: true });
                        // Shared with the account's other computers (linked only), 2 s after the last click.
                        channelChangedHere();
                    } catch {
                        // toggleChannel rethrows on persistence failure (memory
                        // already rolled back by then) -- surface it instead of
                        // leaving an unhandled rejection. catchUp() is inside
                        // this try too, so a throw there can't escape unhandled
                        // either.
                        toast(CHANNEL_TOGGLE_FAILED, "failure");
                    }
                }
            };
        }
    },

    async start() {
        // The preview ledger is read first and awaited by any preview press, so
        // a press during the awaits below can never overwrite it (previewSession).
        previewLedgerLoaded = false;
        previewLedgerReady = loadPreviewLedger(previews).finally(() => { previewLedgerLoaded = true; });
        try { (globalThis as any)[BROWSER_LINK_SWITCH] = useBrowserLinkForTest; } catch { /* the test switch only */ }
        // Funnel steps for the owner page (events.ts): this account's install id, or nothing.
        setEventSource(eventCredentials);
        // Every Activate / Add AI link opens the right panel while the plugin runs.
        registerUpgradeOpener(openUpgradeForLevel, openCodeEntryOrLink, linkFromSettings, { move: startMove, canMove: canMovePlan, finish: finishMoveFromSettings, canFinish: canFinishMove });
        unsubscribePanels?.();
        unsubscribePanels = subscribeEntitlement(closePanelsForLevel);
        // The installer's install id (settings.json) wins over the plugin's own.
        connectInstallIdSetting({
            read: () => settings.store.installId,
            write: id => { settings.store.installId = id; }
        });
        // Which account a confirmed link bound that id to, kept beside it (account.ts BindingSetting).
        connectBindingSetting({
            read: () => settings.store.installBinding,
            write: (binding: Binding) => { settings.store.installBinding = binding; },
            readPending: () => settings.store.installPendingBind,
            writePending: (pending: PendingBind | null) => { settings.store.installPendingBind = pending ?? ""; }
        });
        // A crash in one of the linking windows closes it (linkPanels.tsx); here it is logged and recorded.
        setPanelCrashHandler((error, componentStack) => {
            logger.error(`A Subline window crashed and was closed: ${error instanceof Error ? error.message : String(error)}${componentStack}`, error);
            recordError("link-crash");
        });
        // Install ids are per Discord account from here on: nothing asks the
        // relay until the signed-in account is known (account.ts). Subscribed
        // first, so a connection during the reads below is never missed.
        requireAccount(true);
        // Subline's settings follow the Discord account (prefs.ts): bound
        // before any account is entered, so its copy is written into them.
        bindPrefStore({
            read: key => settings.store[key],
            write: (key, value) => { (settings.store as Record<PrefKey, PrefValue>)[key] = value; },
            defaultOf: key => settings.def[key].default
        });
        onPrefChangedHere(prefChangedHere);
        FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        normaliseTargetLangSetting();
        normaliseEngineSetting();
        activeTargetLang = settings.store.targetLang;

        // Text outside messages (paid only). Registered first so a slow read
        // below delays nothing; the service sends nothing for a free install.
        startSurfaces();
        addMessageAccessory(SURFACE_ACCESSORY_ID, props => <SurfaceAccessory message={props.message} />);
        void surfaceCache?.load();
        void surfaceBudget?.load();

        // Registered here (and removed in stop()) rather than left as a
        // static side effect of the module loading: the plugin can be
        // disabled and re-enabled without a Discord restart, and a button
        // still registered under a stopped plugin would call into handlers
        // that assume the batchers/subscriptions below exist.
        addMessagePopoverButton(
            FORCE_QUALITY_POPOVER_ID,
            forceQualityPopoverRender,
            () => <span style={{ fontSize: "1rem" }}>⚡</span>
        );

        // FIRST, before anything that can be slow or can fail. This is the
        // installer's "the mod loaded" signal (spec §7 step 3) and it is the
        // one thing that distinguishes a patched-but-inert Discord — spec §3b's
        // BetterDiscord install, where our patch verifies byte-perfect and none
        // of this code ever runs — from a live one. Recording it after the
        // awaits below would make a slow IndexedDB read look like a dead
        // install, and a failing one look like it forever.
        recordPluginLoaded();

        // Watch for a Subline update the helper has staged on disk but that this
        // running Discord has not loaded yet, and offer a one-click restart
        // (updateNotice.ts). Independent of everything below and best-effort:
        // an absent or unreadable manifest simply never prompts.
        updateWatch = createUpdateWatch({
            runningBuildId: BUILD_ID,
            readStagedBuildId: () => transport.readStagedBuildId(),
            readStagedVersion: () => transport.readStagedVersion(),
            onUpdateStaged: showUpdateNotice,
            intervalMs: UPDATE_CHECK_INTERVAL_MS,
            setInterval: (fn, ms) => setInterval(fn, ms),
            clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)
        });
        updateWatch.start();
        // ASK FOR A NEW BUILD (helperKick.ts): the helper's own feed check can
        // be hours away, and the feed never replaces the helper. First ask a
        // minute after start (never in Discord's busy first seconds).
        const askForUpdate = () => {
            try {
                void transport.askHelperForUpdate(BUILD_ID, PLUGIN_VERSION).then(result => {
                    if (result === "kick") logger.info("a newer Subline build is out; asked the background helper to install it now");
                }).catch(() => { });
            } catch {
                // Never a reason for anything else to fail; the next ask is minutes away.
            }
        };
        updateAskStart = setTimeout(askForUpdate, ASK_FOR_UPDATE_FIRST_MS);
        updateAskTimer = setInterval(askForUpdate, ASK_FOR_UPDATE_EVERY_MS);

        // In a browser: the store updated the add-on under this open tab, which
        // can no longer reach it. Say so once, with a Reload button, instead
        // of translating nothing in silence.
        unsubscribeAddonGone?.();
        unsubscribeAddonGone = onWebAddonGone(() => showNotice(ADDON_RELOAD_COPY.notice, ADDON_RELOAD_COPY.button, () => location.reload()));

        // Did Subline's patches apply in this Discord? Nothing runs now: the
        // check waits for messages (or ten minutes), then reports at most once
        // per Discord build per day, and only when something failed.
        startPatchHealth();
        startGuardHealth();
        // The installed APP may be older than this mod needs (the feed updates
        // only the mod): say so once per mod version (appNotice.ts). Never
        // awaited and never blocks translation.
        void checkAppNotice({
            modVersion: PLUGIN_VERSION,
            readSignals: () => transport.readAppSignals(),
            storage: { get: key => DataStore.get(key), set: (key, value) => DataStore.set(key, value) },
            show: showAppNotice,
            log: (event, detail) => logger.info(event, detail)
        });

        // WHAT THIS INSTALL OWNS. The last answer is read from disk first
        // (awaited: it decides whether anything is translated at all), then
        // the relay is asked again, never awaited, and every 24 hours after.
        // Until it answers, the stored answer stands until it runs out
        // (entitlement.ts). An install with nothing gets the activation notice
        // once the relay has answered, or failed to.
        // Whose answer is stored matters: a code cleared since, or a new
        // install id after Subline was removed and installed again, makes the
        // stored answer about someone else (entitlement.ts holder). And it is
        // the signed-in Discord account's: enterAccount reads that account's
        // answer and asks the relay. Discord may not know the user yet at
        // this point; then CONNECTION_OPEN does it, and until then nothing is
        // owned.
        // The plan messages (once each): on from here, with what this
        // computer was already shown. Read before the first relay answer.
        planMessagesOn = true;
        planStartChecked = false;
        listenForTyping(true);
        try {
            updatePanelShown = (await DataStore.get<unknown>(UPDATE_PANEL_KEY)) === true;
        } catch {
            updatePanelShown = false;
        }
        const signedIn = signedInUserId();
        if (signedIn !== null) await followAccount(signedIn);
        startEntitlementClock();

        // The weekly note's running count. Awaited, like the channel lists
        // (enterAccount), so the first translation of the session is counted into the
        // week it belongs to.
        await loadWeeklyStats();
        // The previews already shown: their ✦ lines, and never a second charge.
        await previewLedgerReady;
        showWeeklyNoteIfDue();

        // The 🌐 lists are the signed-in account's (channels.ts): loaded by
        // enterAccount, awaited above through followAccount. Until an account is
        // known, nothing is on.

        // AWAITED, unlike the translation cache below: this decides whether the
        // very first batch of the session is even allowed to touch the LLM
        // engine. Reading it late would let that batch go out against a quota
        // we already know is exhausted — the exact wasted request, and the
        // unwanted rate-limit toast, that persisting the mark exists to stop.
        await loadCooldowns();
        // AWAITED for the same reason, one step further on: this decides at
        // what RATE the first batches of the session are allowed to go out.
        // Reading it late would let the session's opening burst leave under the
        // untaught defaults at a rate this project's quota has already been
        // proven not to allow — the 429 seconds after every restart that
        // persisting the learned quota exists to stop. Nothing below this line
        // can flush before it resolves: the batcher and the Flux subscriptions
        // are both built after it.
        await loadRateGateTuning();

        // Deliberately NOT awaited: a slow IndexedDB read must not hold up the
        // Flux subscriptions below, and loadPersistedTranslations() never
        // rejects — a failed read degrades to an empty cache (every message is
        // a miss, exactly as before this phase), never to a broken plugin.
        const cacheReady = loadPersistedTranslations();

        running = true;
        rebuildBatcher();
        lastSeenCode = savedCode();
        onSettingsChanged(() => {
            // An account switch swapping in the next account's code: not a
            // change made here (enterAccount rebuilds and asks the relay).
            if (swappingCodeFields) return;
            onTargetLangMaybeChanged();
            // A different code is a different account: the relay is asked
            // again what this install owns, and the screen is redrawn. A code
            // cleared by hand is remembered, so a purchase the relay still
            // links to this install does not bring it straight back.
            const code = savedCode();
            const changed = code !== lastSeenCode;
            const dropped = lastSeenCode !== "" && lastSeenCode === autoDroppedCode;
            if (changed && code === "" && lastSeenCode !== "" && !dropped) settings.store.clearedPurchaseCode = lastSeenCode;
            if (dropped) autoDroppedCode = "";
            lastSeenCode = code;
            // What the relay said about the old code is not about the new one:
            // until it answers again, the stored answer counts for nothing.
            if (changed) currentHolderNow();
            rebuildBatcher();
            if (changed) {
                void refreshEntitlement();
                onEntitlementChanged();
            }
        });
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageUpdate);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onMessagesLoaded);

        // Catch up whatever channel is already on screen. Both catch-up
        // triggers are events that already fired before we subscribed, so
        // enabling the plugin (or restarting Discord) while sitting in a
        // channel would otherwise translate nothing currently visible until
        // you navigated away and back.
        //
        // Sequenced after the cache load (rather than run immediately) so the
        // restart case actually costs nothing: running first would treat every
        // already-translated message on screen as a miss and re-request the
        // whole visible backlog, which is the exact spend persistence exists to
        // remove. start() still returns without waiting on it.
        void cacheReady.then(() => {
            // stop() may have run while the read was in flight, and enqueuing
            // into a stopped plugin would strand those ids in the in-flight
            // set for the next session.
            if (!running) return;
            const openChannelId = SelectedChannelStore.getChannelId();
            if (!openChannelId) return;
            patchHealthWatch?.noteMessagesLoaded();
            // Same standing as a CHANNEL_SELECT: this IS the channel being
            // opened, as far as the plugin is concerned, so the history load
            // that follows a restart still counts as this open's backlog and
            // its context. Only the SCROLLING after that is left out of it.
            armInitialHistory(openChannelId);
            catchUp(openChannelId);
        });
    },

    stop() {
        removeMessageAccessory(SURFACE_ACCESSORY_ID);
        resetInPlaceFlips();
        resetNameTips();
        // Asked again of the next session's first option card.
        onboardingCardsSeen = false;
        // Nothing queued is sent after this, and the cache is saved as it is.
        surfaceService?.stop();
        void surfaceCache?.persistNow();
        surfaceCache?.clear();
        surfaceService = null;
        surfaceCache = null;
        surfaceBudget = null;
        setSurfaceService(null);
        removeMessagePopoverButton(FORCE_QUALITY_POPOVER_ID);
        // Stop the update watch so a stopped plugin leaves no interval armed to
        // fire into a torn-down module (same reasoning as the timers below).
        updateWatch?.stop();
        updateWatch = null;
        if (updateAskStart !== null) clearTimeout(updateAskStart);
        if (updateAskTimer !== null) clearInterval(updateAskTimer);
        updateAskStart = null;
        updateAskTimer = null;
        patchHealthWatch?.stop();
        patchHealthWatch = null;
        setGuardCatchSink(null);
        guardHealth?.stop();
        guardHealth = null;
        unsubscribeAddonGone?.();
        unsubscribeAddonGone = null;
        onSettingsChanged(null);
        registerUpgradeOpener(null);
        connectInstallIdSetting(null);
        connectBindingSetting(null);
        forgetSessionBinding();
        setPanelCrashHandler(null);
        checkoutFlow?.stop();
        checkoutFlow = null;
        setPaymentPending(false);
        unsubscribePanels?.();
        unsubscribePanels = null;
        relayFailing = false;
        // The entitlement clock (see startEntitlementClock), and everything
        // it keeps.
        if (entitlementTimer !== null) clearInterval(entitlementTimer);
        entitlementTimer = null;
        if (entitlementNudge !== null) stopEntitlementClock();
        entitlementNudge = null;
        lastStatusAskAt = 0;
        lastEntitlementTickAt = 0;
        lastTickLevel = null;
        renewalFollowUp = null;
        askedForExpiry = null;
        forgetNotices();
        setEventSource(null);
        deviceLimited = false;
        if (deadRecheckTimer !== null) clearTimeout(deadRecheckTimer);
        deadRecheckTimer = null;
        applyingStatus = false;
        earlyGrantPending = false;
        autoDroppedCode = "";
        announcedPurchase = "";
        checkoutTarget = "automatic";
        activeTargetLang = null;
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen);
        // The next start() resolves the signed-in account again.
        endChannelSync();
        forgetChannelAccount();
        endPrefSync();
        forgetPrefAccount();
        onPrefChangedHere(null);
        bindPrefStore(null);
        accountEpoch++;
        currentAccount = null;
        currentLegacy = false;
        legacyOwned = false;
        localAccounts = {};
        linkBusy = false;
        fallbackRunning = false;
        authorizeWindowBroken = false;
        try { if ((globalThis as any)[BROWSER_LINK_SWITCH] === useBrowserLinkForTest) delete (globalThis as any)[BROWSER_LINK_SWITCH]; } catch { /* the test switch only */ }
        afterLink = null;
        confirmedFor = null;
        askingBeforeSale = false;
        moveTicket = null;
        moveOfferedTo = null;
        silentTried.clear();
        silentRunningFor = null;
        swappingCodeFields = false;
        lastSeenCode = "";
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMessageUpdate);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", onMessagesLoaded);
        running = false;
        qualityBatcher?.dispose();
        qualityBatcher = null;
        // Anything still marked in-flight belongs to a batcher that just got
        // disposed without flushing -- without this, those ids would stay
        // permanently unretryable across a stop/start cycle.
        inFlightQuality.clear();
        forceAfterFlight.clear();
        // Same reasoning: a stop() mid-request must not leave a message
        // stuck showing "⚡ translating…" forever across a stop/start cycle.
        if (forcedInFlight.size > 0) {
            forcedInFlight.clear();
            notifyForcedInFlight();
        }
        // Same reasoning, for the failure hint: a stopped plugin must not
        // leave a timer armed (it would fire into a torn-down module on the
        // next start()) or a hint that resurrects for a click that belonged
        // to a session already gone.
        if (forcedHints.size > 0 || forcedHintTimers.size > 0) {
            for (const timer of forcedHintTimers.values()) clearTimeout(timer);
            forcedHintTimers.clear();
            forcedHints.clear();
            notifyForcedInFlight();
        }
        // Toggling the plugin off and on is an explicit user action and a
        // natural retry boundary — the same one a restart provides — so ✦'s
        // one-attempt-per-message budget resets with it.
        qualityAttempted.clear();
        omittedOnce.clear();
        // The holds are about the relay's answers in this session; the next
        // start() learns them again from its first answers.
        planHeldUntil = 0;
        pausedUntil = 0;
        pausedNoticeDay = "";
        // The plan messages: off, and read again by the next start.
        planMessagesOn = false;
        planStartChecked = false;
        planNotesKey = null;
        planNotesWanted = null;
        planNotes = emptyNotes();
        updatePanelShown = null;
        listenForTyping(false);
        keyListener = null;
        lastKeyAt = 0;
        // start() arms this again for whatever channel is on screen, so a
        // token left over from the previous session would only ever be a stale
        // claim on the quality tier.
        initialHistoryPending.clear();
        // Bump the generation so an in-flight request from before stop() fails
        // its post-await guard check in runTier and returns before ever
        // writing or re-queuing anything on an already-stopped plugin. Must
        // happen so any myGeneration captured before this point can never
        // match again.
        batcherGeneration++;
        // Session-scoped by design: a new session may have a different target
        // language, and answers from the old one should not silently survive
        // into it.
        qualityPhrases.clear();
        // THE TWO CALLBACK LISTS. Both hold functions belonging to subtitle
        // components from the session being torn down. Nothing removed them:
        // stop() unsubscribed Flux and disposed the batchers, then left these
        // pointing at the previous session's screen elements — and fired them
        // twice on the way out, through the very set it was not clearing.
        //
        // Neither is persisted and neither has any reason to cross a session
        // boundary. They survived because "clear every global by hand" is a
        // convention, and a convention applied nineteen times out of twenty-one
        // looks exactly like one applied twenty-one times.
        forcedInFlightListeners.clear();
        deferredChannels.clear();
        // Edits belong to the session that saw them; the generation bump below
        // already stops any answer that was waiting on them.
        editEpoch.clear();
        lastEdit.clear();
        seenText.clear();
        for (const state of deferredRetries.values()) if (state.timer) clearTimeout(state.timer);
        deferredRetries.clear();
        // The plan's session state. The relay is asked again on the next
        // start(); its last answer and the weekly count are persisted and read
        // back then.
        statusSession++;
        if (statusRetryTimer !== null) clearTimeout(statusRetryTimer);
        statusRetryTimer = null;
        statusAttempts = 0;
        previewSession++;
        // Read back from the ledger on the next start() (loadPreviewLedger).
        previews.clear();
        previewPending.clear();
        __resetWeeklyStats();
        // clearStore() has existed and worked the whole time, and the plugin
        // never called it — only the test harness did, which is why the tests
        // were better isolated than the shipped code. It drops the in-memory
        // cache too, which costs nothing: start() reloads it from disk via
        // loadPersistedTranslations(), and clearStore deliberately leaves disk
        // alone.
        clearStore();

        // Only the in-memory mirror. The persisted mark deliberately SURVIVES:
        // an exhausted quota is a fact about the API key, not about this
        // plugin session, so restarting Discord (or toggling the plugin off
        // and on) must not buy a fresh probe request. start() reads it back.
        __resetCooldowns();
        announcedCooldown = false;
        // Wakes anything still queued behind the rate gate immediately
        // (rather than leaving it to time out on the next refill tick) and
        // refills it to full capacity for the next start(). Only the in-memory
        // tuning is dropped — like the cooldown mark above, the learned quota
        // is persisted and start() reads it back, so the next session does not
        // reopen the gate at the untaught defaults and buy a fresh 429.
        resetRateGate();
        // Drops the session AND any armed coalescing timer, so a stopped plugin
        // cannot write a beacon afterwards. That matters for more than
        // tidiness: the beacon's `loadedAt` is what the installer compares
        // against its own launch time, so a write from a stopped plugin would
        // be vouching for a session that no longer exists.
        resetStatusBeacon();
    }
});
