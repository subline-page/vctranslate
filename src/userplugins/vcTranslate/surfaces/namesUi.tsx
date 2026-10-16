/**
 * How names and pronouns show (0.2.8): HOVER, NOT INLINE, except on the
 * profile card. Too much translation ruins reading, so a name in a message
 * or a mention looks exactly as before. Resting the pointer on it shows
 * "Translation: …" in Discord's own tooltip. The original is never replaced.
 * Names are translated only where the reader is READING, never where they
 * are PICKING someone (no member list, DM list or voice channel: owner
 * decision 2026-10-16).
 *
 * ONLY WHAT SAYS SOMETHING. A name or pronouns get a hover or a line only
 * when they hold a letter in a script the reader does not read (names.ts),
 * checked again on every render against the reading language of that moment.
 * The tooltip or line never shows an empty answer, or one that only hands
 * the name back (sayNothingNew), and never shows while an answer is still
 * on its way: a tooltip that says nothing is never shown.
 *
 * LAZY, AND ONLY ON A REST. A name's tooltip opens after the pointer rests
 * on it for NAME_TIP_DWELL_MS, as Discord's own tooltips do. Passing over
 * names shows nothing and sends nothing; the translation is asked for only
 * once the tooltip is open. The profile card is the exception: it is opened
 * on purpose, and shows its line at once.
 *
 * ✦ WHEN GOOGLE HAS NOTHING (AI plans). A name in a script the reader cannot
 * read that Google hands back, skips or is unsure of, still opens its
 * tooltip on an AI plan, as "Translation: ✦" with only the button: the AI
 * may read it (owner decision 2026-10-16). Only once Google has answered,
 * never while it is still on its way, and never on Automatic. A name only in
 * letters of a script no reading language uses (runes: names.ts aiOnlyName)
 * is never sent to Google at all, and gets the same ✦ alone.
 *
 * ✦ FOR AI PLANS. Next to a translation, the tooltip and the profile line
 * carry a small ✦ button that asks the relay for that name
 * (SurfaceService.askQuality). Automatic plans get no ✦. The tooltip stays
 * open while the pointer moves onto it, so the button can be reached; a
 * click never reaches Discord's own handlers around the name (the popout,
 * the context menu).
 *
 * FAIL SAFE. Every hook runs first and unconditionally; everything after is
 * wrapped, and any throw renders Discord's own value. No surface service (the
 * plugin is stopped) renders Discord's own value too. That try only covers
 * the component's own body: Discord's Tooltip and the ✦ button render later,
 * as children, outside it, and a patched-in call site has no boundary of its
 * own. So the patches place SafeNameHover and SafeProfileNameLine, which put
 * each inside Vencord's ErrorBoundary: an error anywhere below renders
 * Discord's own name (or, for the profile line, nothing), never reaching
 * Discord's tree, and is noted for the crash-guard report (surfaces/guard.tsx)
 * under the handler that placed it.
 */

import ErrorBoundary from "@components/ErrorBoundary";

import { type HandlerId, noteGuardCatch } from "./guard";

import { NAMES_COPY } from "../upgradeCopy";
import { React, Tooltip } from "@webpack/common";

import type { SurfaceEntry } from "./cache";
import { aiOnlyName, nameToTranslate, pronounsToTranslate, sayNothingNew } from "./names";
import { currentSurfaceService, fastUnsure, translationDir } from "./ui";

export interface NameDisplay {
    glyph: "≈" | "✦";
    text: string;
}

/**
 * What to show for a name's cached entry: ✦ when there is one, else Google's
 * ≈ unless it is unsure (the same rule as every surface). Never an answer
 * that says nothing new about `originals` (the name as Discord shows it and
 * as it was sent): then Google's text is shown, still marked ✦ when ✦ was
 * asked (the AI checked it and had nothing better, so the press always
 * shows a change: owner test 2026-10-16), then nothing. Null otherwise.
 */
export function nameDisplay(entry: SurfaceEntry | null | undefined, source: string, ...originals: unknown[]): NameDisplay | null {
    if (!entry) return null;
    const q = entry.quality?.text.trim();
    if (q && !sayNothingNew(q, source, ...originals)) return { glyph: "✦", text: q };
    const f = entry.fast;
    if (!f || fastUnsure(f, source)) return null;
    const t = f.text.trim();
    if (sayNothingNew(t, source, ...originals)) return null;
    return { glyph: entry.quality ? "✦" : "≈", text: t };
}

/* ----------------------------------------------------- the open tooltip -- */

/**
 * Which name's tooltip is open. One pointer, so one at a time. Leaving the
 * name closes it after a short grace, so the pointer can cross the gap onto
 * the tooltip (and its ✦); entering the tooltip keeps it open.
 */
export const NAME_TIP_GRACE_MS = 200;
/** How long the pointer rests on a name before its tooltip opens (Discord's own tooltips wait about as long). */
export const NAME_TIP_DWELL_MS = 500;
let openTip: number | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** The name the pointer is resting on, not open yet, and its timer. */
let dwell: { id: number; timer: ReturnType<typeof setTimeout>; } | null = null;
let nextTipId = 0;
const tipListeners = new Set<() => void>();

function notifyTips(): void {
    for (const l of [...tipListeners]) {
        try { l(); } catch { /* one listener never breaks the rest */ }
    }
}

function cancelClose(): void {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
}

function cancelDwell(): void {
    if (dwell !== null) clearTimeout(dwell.timer);
    dwell = null;
}

/**
 * The pointer entered a name: its tooltip opens once it has rested there for
 * NAME_TIP_DWELL_MS. Already open (the pointer came back from its tooltip):
 * it stays open.
 */
export function restOnNameTip(id: number): void {
    if (openTip === id) {
        cancelClose();
        return;
    }
    if (dwell?.id === id) return;
    cancelDwell();
    dwell = {
        id,
        timer: setTimeout(() => {
            dwell = null;
            openNameTip(id);
        }, NAME_TIP_DWELL_MS)
    };
}

export function openNameTip(id: number): void {
    cancelClose();
    if (openTip === id) return;
    openTip = id;
    notifyTips();
}

/** Close `id` after the grace (the pointer may be on its way to the tooltip); a rest not over yet is dropped. */
export function leaveNameTip(id: number): void {
    if (dwell?.id === id) cancelDwell();
    if (openTip !== id) return;
    cancelClose();
    closeTimer = setTimeout(() => {
        closeTimer = null;
        if (openTip === id) {
            openTip = null;
            notifyTips();
        }
    }, NAME_TIP_GRACE_MS);
}

/** Close now (a click on the name opens Discord's popout; the tooltip goes). */
export function closeNameTip(): void {
    cancelClose();
    cancelDwell();
    if (openTip === null) return;
    openTip = null;
    notifyTips();
}

export function isNameTipOpen(id: number): boolean {
    return openTip === id;
}

/** For tests and stop(): nothing open, no timer left behind. */
export function resetNameTips(): void {
    cancelClose();
    cancelDwell();
    openTip = null;
}

/** Re-render when a translation lands or a tooltip opens or closes. */
function useNameUpdates(): void {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        try {
            tipListeners.add(force);
            const off = currentSurfaceService()?.subscribe(force);
            return () => {
                tipListeners.delete(force);
                try { off?.(); } catch { /* already gone */ }
            };
        } catch {
            return undefined;
        }
    }, []);
}

/** Stops an event here: Discord's handlers around the name never see it. */
function stopHere(e: any): void {
    try {
        e?.stopPropagation?.();
        e?.preventDefault?.();
    } catch { /* nothing to stop */ }
}

const ASK_STYLE = { cursor: "pointer", marginInlineStart: "0.4em", userSelect: "none", whiteSpace: "nowrap" } as const;

/** The ✦ button: asks the relay for `text` once; its click stays here. */
export function AskAiButton({ text }: { text: string; }) {
    return (
        <span
            role="button"
            tabIndex={-1}
            data-subline-ask-ai=""
            aria-label={NAMES_COPY.askAi}
            title={NAMES_COPY.askAi}
            style={ASK_STYLE}
            onMouseDown={stopHere}
            onPointerDown={stopHere}
            onKeyDown={stopHere}
            onClick={(e: any) => {
                stopHere(e);
                try { currentSurfaceService()?.askQuality(text); } catch { /* nothing asked */ }
            }}
        >
            {NAMES_COPY.aiGlyph}
        </span>
    );
}

/**
 * Discord's Tooltip takes pointer events only when `disableTooltipPointerEvents`
 * is exactly false (checked in Discord's bundle, 2026-10-14: the Tooltip class's
 * renderTooltip). Without them the ✦ inside could not be clicked. Vencord's
 * typings do not list the prop, hence the cast.
 */
const TIP_POINTER = { disableTooltipPointerEvents: false } as any;

/** What the tooltip says after "Translation:": "≈ …" or "✦ …", or "✦ …" (the dots) while a ✦ asked for is on its way. */
function tipBody(shown: NameDisplay, waitingQuality: boolean): string {
    if (waitingQuality) return `${NAMES_COPY.aiGlyph} ${NAMES_COPY.waiting}`;
    return `${shown.glyph} ${shown.text}`;
}

/**
 * A name with its translation on hover. `original` is Discord's own child,
 * rendered exactly as it was inside a plain span; `name` is the name as
 * Discord has it. Whether it gets anything is decided again on every render
 * for the reading language of that moment (names.ts): a name the reader
 * reads now renders Discord's child alone, and asks nothing.
 *
 * The tooltip opens only once the pointer has rested on the name and there
 * is a translation that says something new; it asks Google only while open.
 */
export function NameHover({ original, name }: { original: unknown; name: unknown; }) {
    useNameUpdates();
    const [id] = React.useState(() => ++nextTipId);
    try {
        const service = currentSurfaceService();
        if (service === null) return (original ?? null) as any;
        const google = nameToTranslate(name, service.readingLanguage());
        const text = google ?? aiOnlyName(name);
        if (text === null) return (original ?? null) as any;
        const open = isNameTipOpen(id);
        // Asked for only while open: a rest on the name, never a render. An
        // AI-only name is never sent to Google.
        const entry = open ? service.want(text, { name: true, noGoogle: google === null }) : service.peek(text);
        const shown = nameDisplay(entry, text, name);
        const askedWaiting = service.waiting(text, "quality");
        const waitingQuality = shown !== null && askedWaiting;
        // No ✦ once one came back, even one that said nothing new: asking again gets the same.
        const canAsk = shown !== null && !entry?.quality && !waitingQuality && service.canAskQuality();
        // Google is done and had nothing: an AI plan is still offered ✦ alone.
        const offerOnly = shown === null && !askedWaiting && !entry?.quality
            && !service.waiting(text, "fast") && service.canAskQuality();
        const visible = open && (shown !== null || offerOnly || askedWaiting);
        const tip = (
            <span
                data-subline-name-tip=""
                onMouseEnter={() => openNameTip(id)}
                onMouseLeave={() => leaveNameTip(id)}
            >
                {NAMES_COPY.label}{" "}
                {shown !== null && <span dir={translationDir()}>{tipBody(shown, waitingQuality)}</span>}
                {shown === null && askedWaiting && <span>{NAMES_COPY.aiGlyph} {NAMES_COPY.waiting}</span>}
                {(canAsk || (offerOnly && !askedWaiting)) && <AskAiButton text={text} />}
            </span>
        );
        return (
            <Tooltip text={tip} forceOpen={visible} shouldShow={visible} {...TIP_POINTER}>
                {() => (
                    <span
                        data-subline-name=""
                        onMouseEnter={() => restOnNameTip(id)}
                        onMouseLeave={() => leaveNameTip(id)}
                        onClick={() => closeNameTip()}
                    >
                        {original as any}
                    </span>
                )}
            </Tooltip>
        );
    } catch {
        return (original ?? null) as any;
    }
}

/**
 * The fallback of a name's boundary: Discord's own child, exactly as it was.
 * Vencord's ErrorBoundary hands the fallback `wrappedProps` (checked in the
 * pinned Vencord, src/components/ErrorBoundary.tsx). Not `noop`: that would
 * render nothing in a release build, and the name would vanish.
 */
function OriginalName({ wrappedProps }: { wrappedProps?: { original?: unknown; }; }) {
    return (wrappedProps?.original ?? null) as any;
}

const BOUNDARY_MESSAGE = "Subline: a name's translation did not render. Discord's own is shown.";

/** A boundary's onError: the catch is noted under the handler that placed it. */
function noted(handler: HandlerId | undefined) {
    return handler === undefined ? undefined : ({ error }: { error: unknown; }) => noteGuardCatch(handler, error);
}

/** NameHover inside a boundary: any error below it (Discord's Tooltip, the ✦) renders Discord's own name. */
export function SafeNameHover({ handler, ...props }: { original: unknown; name: unknown; handler?: HandlerId; }) {
    return (
        <ErrorBoundary fallback={OriginalName as any} wrappedProps={props} message={BOUNDARY_MESSAGE} onError={noted(handler)}>
            <NameHover {...props} />
        </ErrorBoundary>
    );
}

/* ------------------------------------------------------- profile card -- */

export interface ProfileNameTexts {
    /** The card's names as Discord has them (display name or nickname, and the username when it is another name). */
    names: unknown[];
    /** The pronouns as Discord has them. */
    pronouns: unknown;
}

const PROFILE_LINE_STYLE = { fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px", overflowWrap: "anywhere" } as const;

/**
 * The profile card's line: under the name, after the pronouns, small and
 * grey. ONE mark for the whole line, at its start: "≈ Wang Xiaoming · he/him",
 * with the ✦ button at the end for an AI plan; "✦ Li Xiaolong · he/him" once
 * the AI checked every part of it (owner rule 2026-10-16: keep it simple,
 * never two ✦ on one line).
 * Only names and pronouns in a script the reader does not read, checked
 * for the reading language of this render. Null (Discord's own card,
 * untouched) when nothing in it says something new: never a lone ✦.
 */
export function ProfileNameLine({ texts }: { texts: ProfileNameTexts; }) {
    useNameUpdates();
    try {
        const service = currentSurfaceService();
        if (service === null || texts == null) return null;
        const target = service.readingLanguage();
        const parts: string[] = [];
        const seen = new Set<string>();
        let pending = false;
        /** Every part shown has a ✦ answer: the line's mark is ✦. */
        let allChecked = true;
        /** Everything on the line with no ✦ yet, names and pronouns: ONE ✦ asks for all of it. */
        const unasked: string[] = [];
        const names = new Map<string, unknown>();
        /** Names Google cannot read (runes): never sent to Google, ✦ only. */
        const aiOnly = new Set<string>();
        /** A name still waiting for Google: no ✦ offer on an empty line yet. */
        let googleWaiting = false;
        for (const raw of Array.isArray(texts.names) ? texts.names : []) {
            let text = nameToTranslate(raw, target);
            if (text === null) {
                text = aiOnlyName(raw);
                if (text !== null) aiOnly.add(text);
            }
            if (text !== null && !names.has(text)) names.set(text, raw);
        }
        for (const [name, raw] of names) {
            const entry = service.want(name, { name: true, noGoogle: aiOnly.has(name) });
            if (!aiOnly.has(name) && service.waiting(name, "fast")) googleWaiting = true;
            const shown = nameDisplay(entry, name, raw, ...names.keys());
            if (shown !== null && !seen.has(shown.text)) {
                seen.add(shown.text);
                parts.push(shown.text);
            }
            if (shown !== null && shown.glyph !== "✦") allChecked = false;
            if (service.waiting(name, "quality")) pending = true;
            else if (!entry?.quality) unasked.push(name);
        }
        const pronouns = pronounsToTranslate(texts.pronouns, target);
        if (pronouns !== null) {
            const entry = service.want(pronouns, { name: true });
            const shown = nameDisplay(entry, pronouns, texts.pronouns);
            if (shown !== null) parts.push(shown.text);
            if (shown !== null && shown.glyph !== "✦") allChecked = false;
            if (service.waiting(pronouns, "quality")) pending = true;
            else if (shown !== null && !entry?.quality) unasked.push(pronouns);
        }
        const canAsk = !pending && unasked.length > 0 && service.canAskQuality();
        if (parts.length === 0) {
            // Nothing to show yet, but the AI may read it (runes, or Google
            // had nothing): "Translation: ✦" on an AI plan, as in a name's
            // tooltip (owner decision 2026-10-16). Never while Google is on
            // its way, never on Automatic.
            if (!pending && !(canAsk && !googleWaiting)) return null;
            return (
                <div style={PROFILE_LINE_STYLE} data-subline-surface="profile-names">
                    {NAMES_COPY.label}
                    {pending ? <span> {NAMES_COPY.aiGlyph} {NAMES_COPY.waiting}</span> : <ProfileAskAi names={unasked} />}
                </div>
            );
        }
        // ✦ at the start only when nothing is left to ask: never a ✦ mark and a ✦ button on one line.
        const mark = allChecked && !pending && unasked.length === 0 ? NAMES_COPY.aiGlyph : "≈";
        return (
            <div style={PROFILE_LINE_STYLE} data-subline-surface="profile-names">
                <span dir={translationDir()}>{`${mark} ${parts.join(" · ")}`}</span>
                {pending && <span> {NAMES_COPY.aiGlyph} {NAMES_COPY.waiting}</span>}
                {canAsk && <ProfileAskAi names={unasked} />}
            </div>
        );
    } catch {
        return null;
    }
}

/** The profile line's fallback: nothing, so Discord's card is as it was. */
function NoLine() {
    return null;
}

/** ProfileNameLine inside a boundary: any error below it renders nothing. */
export function SafeProfileNameLine({ handler, ...props }: { texts: ProfileNameTexts; handler?: HandlerId; }) {
    return (
        <ErrorBoundary fallback={NoLine as any} message={BOUNDARY_MESSAGE} onError={noted(handler)}>
            <ProfileNameLine {...props} />
        </ErrorBoundary>
    );
}

/** The profile line's one ✦: asks the relay for each name and the pronouns on the card that have no ✦ yet. */
function ProfileAskAi({ names }: { names: string[]; }) {
    return (
        <span
            role="button"
            tabIndex={-1}
            data-subline-ask-ai=""
            aria-label={NAMES_COPY.askAi}
            title={NAMES_COPY.askAi}
            style={ASK_STYLE}
            onMouseDown={stopHere}
            onPointerDown={stopHere}
            onKeyDown={stopHere}
            onClick={(e: any) => {
                stopHere(e);
                const service = currentSurfaceService();
                for (const n of names) {
                    try { service?.askQuality(n); } catch { /* the next one still goes */ }
                }
            }}
        >
            {NAMES_COPY.aiGlyph}
        </span>
    );
}
