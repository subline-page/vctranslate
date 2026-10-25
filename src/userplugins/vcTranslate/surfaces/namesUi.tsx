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
 * on its way by itself: a tooltip that says nothing is never shown. Only a ✦
 * the reader clicked for shows "✦ …" while it is out.
 *
 * LAZY, AND ONLY ON A REST. A name's tooltip opens after the pointer rests
 * on it for NAME_TIP_DWELL_MS, as Discord's own tooltips do. Passing over
 * names shows nothing and sends nothing; the translation is asked for only
 * once the tooltip is open. The profile card is the exception: it is opened
 * on purpose, and shows its line at once.
 *
 * ✦ BY ITSELF (0.2.9, spec decision 14). A name in a script the reader
 * cannot read is asked of ✦ when its tooltip opens (or its profile card
 * shows), cached and reused. There is no Google line any more.
 *
 * ✦ ON A CLICK, ONLY FOR RUNES. A name only in letters of a script no reading
 * language uses (runes: names.ts aiOnlyName) is never sent by itself: its
 * tooltip offers "Translation: ✦" with only the button, which asks the relay
 * for it (SurfaceService.askQuality, owner decision 2026-10-16). The tooltip
 * stays open while the pointer moves onto it, so the button can be reached;
 * a click never reaches Discord's own handlers around the name (the popout,
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
import { currentSurfaceService, translationDir } from "./ui";

export interface NameDisplay {
    glyph: "✦";
    text: string;
}

/**
 * What to show for a name's cached entry: its ✦ answer, never one that says
 * nothing new about `originals` (the name as Discord shows it and as it was
 * sent). A ✦ that says nothing new means the AI kept the name as it is:
 * nothing is shown (owner 2026-10-19). Null otherwise.
 */
export function nameDisplay(entry: SurfaceEntry | null | undefined, source: string, ...originals: unknown[]): NameDisplay | null {
    if (!entry?.quality) return null;
    const q = entry.quality.text.trim();
    return sayNothingNew(q, source, ...originals) ? null : { glyph: "✦", text: q };
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

/** What the tooltip says after "Translation:": "✦ …". */
function tipBody(shown: NameDisplay): string {
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
 * is a translation that says something new; it asks ✦ only while open. A
 * runes-only name offers ✦ alone, and shows "✦ …" once it is clicked.
 */
export function NameHover({ original, name }: { original: unknown; name: unknown; }) {
    useNameUpdates();
    const [id] = React.useState(() => ++nextTipId);
    try {
        const service = currentSurfaceService();
        if (service === null) return (original ?? null) as any;
        const readable = nameToTranslate(name, service.readingLanguage());
        const text = readable ?? aiOnlyName(name);
        if (text === null) return (original ?? null) as any;
        const open = isNameTipOpen(id);
        // Asked for only while open: a rest on the name, never a render. A
        // runes-only name waits for the reader's ✦ click.
        const entry = open ? service.want(text, { name: true, askOnly: readable === null }) : service.peek(text);
        const shown = nameDisplay(entry, text, name);
        // Only a click shows the dots: an automatic answer on its way shows nothing.
        const waiting = shown === null && readable === null && service.waiting(text);
        // A runes-only name ✦ has not answered: an AI plan is offered ✦ alone.
        const offerOnly = shown === null && !waiting && readable === null && !entry?.quality && service.canAskQuality();
        const visible = open && (shown !== null || offerOnly || waiting);
        const tip = (
            <span
                data-subline-name-tip=""
                onMouseEnter={() => openNameTip(id)}
                onMouseLeave={() => leaveNameTip(id)}
            >
                {NAMES_COPY.label}{" "}
                {shown !== null && <span dir={translationDir()}>{tipBody(shown)}</span>}
                {waiting && <span>{NAMES_COPY.aiGlyph} {NAMES_COPY.waiting}</span>}
                {offerOnly && <AskAiButton text={text} />}
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
 * grey. ONE ✦ for the whole line, at its start: "✦ Wang Xiaoming · he/him"
 * (owner rule 2026-10-16: keep it simple, never two ✦ on one line). Every
 * part asks ✦ by itself (0.2.9), except a runes-only name, which the line's
 * ✦ button asks for (on an AI plan). Only names and pronouns in a script the
 * reader does not read, checked for the reading language of this render.
 * Null (Discord's own card, untouched) when nothing in it says something new:
 * never a lone ✦.
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
        /** Runes-only names ✦ has not answered: ONE ✦ asks for all of them. */
        const unasked: string[] = [];
        const names = new Map<string, unknown>();
        /** Names only the AI might read (runes): never sent by themselves. */
        const aiOnly = new Set<string>();
        for (const raw of Array.isArray(texts.names) ? texts.names : []) {
            let text = nameToTranslate(raw, target);
            if (text === null) {
                text = aiOnlyName(raw);
                if (text !== null) aiOnly.add(text);
            }
            if (text !== null && !names.has(text)) names.set(text, raw);
        }
        for (const [name, raw] of names) {
            const entry = service.want(name, { name: true, askOnly: aiOnly.has(name) });
            const shown = nameDisplay(entry, name, raw, ...names.keys());
            if (shown !== null && !seen.has(shown.text)) {
                seen.add(shown.text);
                parts.push(shown.text);
            }
            // Only a click shows the dots: an automatic answer on its way shows nothing.
            if (aiOnly.has(name) && service.waiting(name)) pending = true;
            else if (aiOnly.has(name) && !entry?.quality) unasked.push(name);
        }
        const pronouns = pronounsToTranslate(texts.pronouns, target);
        if (pronouns !== null) {
            const entry = service.want(pronouns, { name: true });
            const shown = nameDisplay(entry, pronouns, texts.pronouns);
            if (shown !== null) parts.push(shown.text);
        }
        const canAsk = !pending && unasked.length > 0 && service.canAskQuality();
        if (parts.length === 0) {
            // Nothing to show yet: "Translation: ✦" with the button for runes
            // on an AI plan, or "Translation: ✦ …" once it is clicked, as in a
            // name's tooltip (owner decision 2026-10-16).
            if (!pending && !canAsk) return null;
            return (
                <div style={PROFILE_LINE_STYLE} data-subline-surface="profile-names">
                    {NAMES_COPY.label}
                    {pending ? <span> {NAMES_COPY.aiGlyph} {NAMES_COPY.waiting}</span> : <ProfileAskAi names={unasked} />}
                </div>
            );
        }
        return (
            <div style={PROFILE_LINE_STYLE} data-subline-surface="profile-names">
                <span dir={translationDir()}>{`${NAMES_COPY.aiGlyph} ${parts.join(" · ")}`}</span>
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

/** The profile line's one ✦: asks the relay for each runes-only name on the card that has no ✦ yet. */
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
