import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { LocaleStore, React, UserStore } from "@webpack/common";


import { APP_DOWNLOAD_URL } from "./appNotice";
import { entitlementLevel, getEntitlement, type Level, linkState, mustLink, subscribeEntitlement } from "./entitlement";
import { planView, type PlanView } from "./planState";
import { type LanguageSelectOption, targetLanguageOptions } from "./languages";
import { isDesktop } from "./transport";
import {
    canFinishMoveFromSettings, canMoveFromSettings, isPaymentPending, openCodeEntryFromSettings, openFinishMoveFromSettings, openLinkFromSettings,
    noteSettingsShown, openMoveFromSettings, openUpgrade, subscribePaymentPending
} from "./upgradeBridge";
import { LINK_COPY, MOVE_COPY } from "./upgradeCopy";
import { FeedbackSection } from "./feedbackPanel";
import { notePrefChanged } from "./prefs";
import { notifySettingsChanged } from "./settingsBridge";
import { SETTINGS_COPY } from "./settingsCopy";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "./types";

/**
 * Default target language, taken from Discord's own locale rather than a
 * hardcoded "en".
 *
 * Truncated to the primary subtag: Discord reports region-qualified tags
 * ("en-US", "pt-BR"), and the reading-language dropdown (languages.ts) and
 * the local "already in the reader's language" checks (detectLang.ts) work on
 * bare codes ("en", "pt").
 *
 * LocaleStore is resolved asynchronously by Vencord's webpack search, so it can
 * legitimately still be undefined very early; "en" is the fallback.
 */
function defaultTargetLang(): string {
    const locale = LocaleStore?.locale;
    if (typeof locale !== "string" || locale === "") return "en";
    return locale.split("-")[0].toLowerCase();
}

/** The one engine (0.2.9, AI only). Same string the installer seeds (RELAY_ENGINE). */
export const RELAY_ENGINE = "relay";

/**
 * A code changed. The engine is the relay whatever the code (0.2.9, spec
 * decision 1): the code only changes the credential the relay sees (the
 * install bearer stands in when there is none). A value an older build
 * stored ("google", a bring-your-own-key engine) is moved to the relay here
 * too, so no old setting can select an engine this build does not run.
 *
 * Reads the store rather than the argument: Vencord writes the value before
 * it calls onChange, and the store is what every other reader sees.
 */
function syncEngineToCode(): void {
    if (settings.store.engine !== RELAY_ENGINE) settings.store.engine = RELAY_ENGINE;
    notifySettingsChanged();
}

/**
 * What this install has, as the ✦ button says it (planState.ts): the same
 * sentence as its hover text, so Subline → Settings shows the state where
 * there is no ✦ button (a channel without a message box, or the button
 * hidden by the reader). Never throws: a bad read is "off".
 */
export function planViewNow(level: Level = entitlementLevel()): PlanView {
    try {
        return planView({ entitlement: getEntitlement(), level, now: Date.now(), linkNeeded: false, paymentPending: isPaymentPending() });
    } catch {
        return planView({ entitlement: null, level: "none", now: Date.now(), linkNeeded: false, paymentPending: false });
    }
}

const LINK_STYLE = { cursor: "pointer", color: "var(--text-link, #00a8fc)" } as const;

function link(text: string, onClick: () => void) {
    return React.createElement("a", {
        role: "button",
        tabIndex: 0,
        style: LINK_STYLE,
        onClick: (e: any) => { e?.preventDefault?.(); onClick(); }
    }, text);
}

/** The signed-in Discord username, read locally (never sent anywhere), or "". */
function signedInName(): string {
    try {
        const name = UserStore?.getCurrentUser?.()?.username;
        return typeof name === "string" ? name : "";
    } catch {
        return "";
    }
}

/**
 * The plan card at the top of the page: which Discord account Subline is
 * linked to, what it has (the ✦ button's words), the saved code (selectable,
 * no Copy button), and the actions: Link while the account is not linked;
 * otherwise Subscribe (unless subscribed) and Enter a code. Redraws when the
 * relay's answer changes. 0.2.8: a plan from before still to link says so
 * (its plan works); the account that has the plan can move it; in the
 * browser add-on, the Discord app is offered. Never throws into Discord:
 * Vencord's settings page draws it inside its own error boundary, and this
 * reads everything defensively.
 */
export function PlanCard() {
    const [, redraw] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribeEntitlement(redraw), []);
    React.useEffect(() => subscribePaymentPending(redraw), []);
    // On screen: what its links start says its outcome in a window (a toast is drawn under this page).
    React.useEffect(() => noteSettingsShown(), []);
    const level = entitlementLevel();
    const linked = linkState();
    const raw = settings.store.sublineCode;
    const code = typeof raw === "string" ? raw.trim() : "";
    const muted = { color: "var(--text-muted)", fontSize: "0.9rem" };
    const normal = { color: "var(--text-default, var(--text-normal))" };
    // A move started on another account here waits for this one: finish it (Move my plan).
    const finishMove = () => canFinishMoveFromSettings()
        ? React.createElement("div", { key: "finishMove", style: { ...muted, marginTop: 4 }, "data-subline-finish-move": "" }, link(MOVE_COPY.finishLink, openFinishMoveFromSettings))
        : null;
    // Not linked (and so nothing owned): one line and Link. Nothing else helps yet.
    if (linked === "unlinked" && level === "none") {
        return React.createElement("div", { style: { marginBottom: 8 } },
            React.createElement("div", { key: "plan", style: normal }, SETTINGS_COPY.plan.notLinked),
            React.createElement("div", { key: "actions", style: { ...muted, marginTop: 4 } }, link(SETTINGS_COPY.plan.link, openLinkFromSettings)),
            finishMove()
        );
    }
    const rows: any[] = [];
    const name = signedInName();
    if (linked === "linked" && name !== "") {
        rows.push(React.createElement("div", { key: "account", style: normal, "data-subline-linked": "" }, SETTINGS_COPY.plan.linkedTo.replace("{name}", name)));
    }
    // A plan from before, not linked yet: it works; linking keeps it everywhere.
    if (mustLink()) {
        rows.push(React.createElement("div", { key: "mustLink", style: { ...muted, marginBottom: 4 }, "data-subline-must-link": "" },
            LINK_COPY.mustLinkNotice, ". ", link(SETTINGS_COPY.plan.link, openLinkFromSettings)));
    }
    const view = planViewNow(level);
    rows.push(React.createElement("div", { key: "plan", style: normal, "data-subline-plan": view.state, ...(view.state === "pending" ? { "data-subline-payment-pending": "" } : {}) }, view.hover));
    if (code !== "") {
        rows.push(React.createElement("div", { key: "code", style: { ...muted, display: "flex", gap: 8, alignItems: "center", marginTop: 4 } },
            SETTINGS_COPY.plan.codeLabel, " ",
            // No Copy button (owner, 2026-10-13): its "Copied" toast is drawn
            // under Settings, so a press looked like nothing happened.
            React.createElement("code", { style: { userSelect: "all" } }, code)
        ));
    }
    // Subscribe (the plan panel) unless the plan is already the paid one;
    // "Enter a code" at every level (0.2.9 spec, decision 15). P4: no
    // Subscribe while a payment is on its way (the plan line says so).
    const actions: any[] = [];
    if (view.state !== "subscribed" && view.state !== "pending") actions.push(link(SETTINGS_COPY.plan.subscribe, openUpgrade), " · ");
    // Not for a paid plan: a code adds nothing there (the relay refuses it).
    if (view.state !== "subscribed") actions.push(link(SETTINGS_COPY.plan.enterCode, openCodeEntryFromSettings));
    if (actions.length > 0) rows.push(React.createElement("div", { key: "actions", style: { ...muted, marginTop: 4 } }, ...actions));
    const finishing = finishMove();
    if (finishing !== null) rows.push(finishing);
    // Move my plan: only on a linked computer of the account that has it.
    if (canMoveFromSettings()) {
        rows.push(React.createElement("div", { key: "move", style: { ...muted, marginTop: 4 }, "data-subline-move": "" }, link(MOVE_COPY.settingsLink, openMoveFromSettings)));
    }
    // The browser add-on, with a plan: the Discord app too (the installer never sells).
    if (level !== "none" && !desktop()) {
        rows.push(React.createElement("div", { key: "app", style: { ...muted, marginTop: 4 }, "data-subline-get-app": "" },
            SETTINGS_COPY.plan.appPrompt, " ", link(SETTINGS_COPY.plan.appLink, openAppDownload)));
    }
    return React.createElement("div", { style: { marginBottom: 8 } }, ...rows);
}

/** Running in the Discord app (the desktop helpers are there), not the browser add-on. */
function desktop(): boolean {
    try {
        return isDesktop();
    } catch {
        return true;
    }
}

/** subline.page's downloads, in a new tab (the add-on) or the default browser. */
function openAppDownload(): void {
    try {
        (globalThis as any).VencordNative?.native?.openExternal?.(APP_DOWNLOAD_URL);
    } catch { /* nothing opened; the link is plain text on the site too */ }
}

export const settings = definePluginSettings({
    engine: {
        type: OptionType.SELECT,
        // Hidden (below), and only one value since 0.2.9: AI only, no Google
        // (spec decision 1). Bring-your-own-key engines are deliberately NOT
        // offered: they would let anyone self-serve ✦ AI with a provider key.
        // The claude/gemini/groq engine code still exists, unreachable
        // (native.ts refuses them). See tests/settings.test.ts.
        description: "Translation engine",
        options: [
            { label: "Subline", value: RELAY_ENGINE, default: true }
        ],
        // engine is captured by value when the batcher is built, so a change
        // here must rebuild it (see settingsBridge.ts / index.tsx).
        onChange: notifySettingsChanged
    },
    // The installer's install id (32 lowercase hex, no prefix): the install a
    // purchase or promo was tied to before Discord ever ran. taste.ts prefers
    // it. CUSTOM, never shown.
    installId: {
        type: OptionType.CUSTOM,
        default: ""
    },
    // Which Discord account (a local key, account.ts) a confirmed link bound
    // installId to, and that id: { account, id }, or "" while none has. Kept
    // here next to it: clearing Discord's data empties the accounts book but
    // not this file. CUSTOM, never shown.
    installBinding: {
        type: OptionType.CUSTOM,
        default: "" as unknown
    },
    // The local account keys that sent a link on installId while it was
    // unbound, whose answer was not taken in yet: { id, accounts }, or "".
    // A later status answer that says linked binds it from this (account.ts
    // rule 3). CUSTOM, never shown.
    installPendingBind: {
        type: OptionType.CUSTOM,
        default: "" as unknown
    },
    // First on the page: the plan and the code.
    plan: {
        type: OptionType.COMPONENT,
        component: () => React.createElement(PlanCard)
    },
    sublineCode: {
        type: OptionType.STRING,
        // Says where the code CAME FROM, not what it looks like: a bought code is
        // the store's license key and does not start with slp_.
        displayName: SETTINGS_COPY.sublineCode.title,
        description: SETTINGS_COPY.sublineCode.description,
        default: "",
        placeholder: "Paste your code",
        // Same immediacy requirement as the API keys: effectiveEngine() must
        // see a pasted/cleared code right away, not on next reload.
        onChange: syncEngineToCode
    },
    // Whose the code fields (sublineCode, clearedPurchaseCode, deadCodeSeen)
    // are: "" for the install id from before (every account until a confirmed
    // link binds it), a local account key for an account's own id
    // (account.ts), or "switching" while a switch swaps them. CUSTOM, never shown.
    codeAccount: {
        type: OptionType.CUSTOM,
        default: ""
    },
    // The code fields of the slots not in use right now ("" or a local
    // account key, account.ts). CUSTOM, never shown.
    accountCodes: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, unknown>
    },
    // The Subline code the reader last cleared by hand, "" for none. A
    // purchase the relay still links to this install is not saved again when
    // it is this code: clearing it was a choice. CUSTOM, never shown.
    clearedPurchaseCode: {
        type: OptionType.CUSTOM,
        default: ""
    },
    // When a 0.1.x build started this install's free trial (epoch ms), 0 for
    // never. 0.2.0 starts no trials; this is only read, as evidence of earlier
    // use for the early-user check (taste.ts priorUseHint). CUSTOM, never shown.
    freeTrialStartedAt: {
        type: OptionType.CUSTOM,
        default: 0
    },
    // The saved code the relay first called dead, and when (epoch ms). A code
    // is dropped only when a second dead answer comes at least an hour later,
    // so a relay storage lag cannot throw away a good code. CUSTOM, never shown.
    deadCodeSeen: {
        type: OptionType.CUSTOM,
        default: { code: "", at: 0 } as { code: string; at: number; }
    },
    // The owner's off switch (surfaces/guard.tsx isFeatureOff): the features the
    // last status answer that stated it switched off. Kept when the relay is
    // down or says nothing. [] = everything on. CUSTOM, never shown.
    remoteOff: {
        type: OptionType.CUSTOM,
        default: [] as string[]
    },
    anthropicApiKey: {
        type: OptionType.STRING,
        description: "Anthropic API key (only used when the Claude engine is selected)",
        default: "",
        placeholder: "sk-ant-...",
        // Pasting a key (or clearing one) must be picked up by effectiveEngine()
        // immediately, not on next reload.
        onChange: notifySettingsChanged
    },
    geminiApiKey: {
        type: OptionType.STRING,
        description: "Gemini API key (only used when the Gemini engine is selected)",
        default: "",
        placeholder: "AIza...",
        // Same immediacy requirement as anthropicApiKey — effectiveEngine()
        // must see a pasted/cleared key right away, not on next reload.
        onChange: notifySettingsChanged
    },
    geminiModel: {
        type: OptionType.STRING,
        // The description is the whole point of this setting existing. Which
        // Gemini models a free-tier key may call changes without notice, and a
        // key with NO allowance for a model gets a 429 on its very first
        // request — indistinguishable from being throttled unless the user is
        // told what to try. The previous hardcoded default did exactly that
        // for days: no ✦ line ever arrived and nothing said why.
        description:
            `Gemini model (default ${DEFAULT_GEMINI_MODEL}). If ✦ upgrades stop appearing and you ` +
            "keep seeing a rate-limit toast, this model may no longer be available on your key. " +
            `Try another (e.g. ${DEFAULT_GEMINI_MODEL}). Blank uses the default.`,
        default: DEFAULT_GEMINI_MODEL,
        placeholder: DEFAULT_GEMINI_MODEL,
        // Same immediacy requirement as the keys above: switching model to
        // escape a dead one must take effect on the next batch, not on next
        // reload — a user doing this is already stuck.
        onChange: notifySettingsChanged
    },
    groqApiKey: {
        type: OptionType.STRING,
        description: "Groq API key (only used when the Groq engine is selected)",
        default: "",
        placeholder: "gsk_...",
        // Same immediacy requirement as the two keys above.
        onChange: notifySettingsChanged
    },
    groqModel: {
        type: OptionType.STRING,
        // Written BEFORE this engine's first ever request, not after a week of
        // misdiagnosis — which is the only difference between this field and
        // geminiModel above. A model with no free-tier availability returns 429
        // to every request forever, which is the same status code as ordinary
        // throttling, and without a settings field the only cure is a rebuild.
        description:
            `Groq model (default ${DEFAULT_GROQ_MODEL}). If ✦ upgrades stop appearing, especially `
            + "if they never appear at all, this model may no longer be available on your key. "
            + "Try another from console.groq.com's model list; the change applies to "
            + "the next batch, with no restart. Blank uses the default.",
        default: DEFAULT_GROQ_MODEL,
        placeholder: DEFAULT_GROQ_MODEL,
        onChange: notifySettingsChanged
    },
    targetLang: {
        // A dropdown of language names (languages.ts, the same list the
        // installer's language screen offers). The value stays a bare code.
        type: OptionType.SELECT,
        displayName: SETTINGS_COPY.targetLang.title,
        description: SETTINGS_COPY.targetLang.description,
        // A getter, so the list always includes the value actually set: a
        // Discord locale we do not list, or an old free-text value that could
        // not be normalised (see index.tsx's normaliseTargetLangSetting). Vencord
        // reads `options` when it renders the dropdown (SelectSetting.tsx at the
        // pinned commit), never at definition time.
        get options(): LanguageSelectOption[] { return targetLanguageOptions(settings.store.targetLang); },
        // A getter, not a literal. Vencord resolves a setting's `default`
        // LAZILY — getDefaultValue() in src/api/Settings.ts reads
        // `setting.default` the first time the value is actually needed, and
        // `definePluginSettings` stores this object by reference without
        // copying it. Evaluating LocaleStore at module scope instead would run
        // while the plugin index is being constructed, before
        // waitForStore("LocaleStore") has resolved, and would freeze the "en"
        // fallback in for everyone.
        get default() { return defaultTargetLang(); },
        // targetLang is captured by value when the batcher is built, so a
        // change here must rebuild it too. It also follows the Discord
        // account (prefs.ts), like every setting below up to debugLogging.
        onChange: () => {
            notePrefChanged("targetLang");
            notifySettingsChanged();
        }
    },
    catchUpCount: {
        type: OptionType.SLIDER,
        displayName: SETTINGS_COPY.catchUpCount.title,
        description: SETTINGS_COPY.catchUpCount.description,
        markers: [0, 10, 20, 30, 50],
        default: 20,
        stickToMarkers: true,
        onChange: () => notePrefChanged("catchUpCount")
    },
    globalAuto: {
        type: OptionType.BOOLEAN,
        // On by default so a fresh install works the moment it's enabled — no
        // channel to find, no button to discover. Only ever covers channels
        // with a guild_id; DMs and group DMs stay opt-in via the per-channel
        // globe button regardless of this setting (see channelActive).
        displayName: SETTINGS_COPY.globalAuto.title,
        description: SETTINGS_COPY.globalAuto.description,
        default: true,
        onChange: () => notePrefChanged("globalAuto")
    },
    translateSurfaces: {
        type: OptionType.BOOLEAN,
        // Paid only (hidden without a code, and the plugin checks the plan
        // itself too). Statuses, bios, embeds, polls, reply and forward
        // previews, and the open channel's topic, title, tags and live event.
        displayName: SETTINGS_COPY.translateSurfaces.title,
        description: SETTINGS_COPY.translateSurfaces.description,
        default: true,
        onChange: () => notePrefChanged("translateSurfaces")
    },
    translateNames: {
        type: OptionType.BOOLEAN,
        // 0.2.8, right after "Profiles, embeds and more". Any plan (hidden
        // without one, and the plugin checks the plan itself too). Display
        // names, nicknames, usernames and pronouns: a hover everywhere, a
        // small line on the profile card. Never a server, channel or role name.
        displayName: SETTINGS_COPY.translateNames.title,
        description: SETTINGS_COPY.translateNames.description,
        default: true,
        onChange: () => notePrefChanged("translateNames")
    },
    debugLogging: {
        type: OptionType.BOOLEAN,
        // Says plainly what this does and where it goes: message TEXT is
        // included (it is the whole point — a decision log that hides the
        // message it decided about is not diagnosable), and it never leaves
        // this machine — it is printed through Vencord's own Logger, to the
        // same DevTools console every other plugin already logs to. Off by
        // default because most sessions do not need it and it is a
        // deliberate, informed opt-in when one does.
        displayName: SETTINGS_COPY.debugLogging.title,
        description: SETTINGS_COPY.debugLogging.description,
        default: false
    },
    // Last on the page: the feedback box (feedbackPanel.tsx). Sends nothing
    // until the reader reviews it and presses Send.
    feedback: {
        type: OptionType.COMPONENT,
        component: () => React.createElement(FeedbackSection)
    }
}, {
    engine: {
        // Hidden: the relay is the one engine (syncEngineToCode, and
        // index.tsx normaliseEngineSetting at start). There is nothing for
        // the reader to choose. The value stays for the plugin.
        hidden: () => true
    },
    sublineCode: {
        // Shown in the plan card instead (selectable text). A code is entered
        // through "Enter a code", which checks it with the relay first.
        hidden: () => true
    },
    translateSurfaces: {
        hidden: () => entitlementLevel() === "none"
    },
    translateNames: {
        hidden: () => entitlementLevel() === "none"
    },
    anthropicApiKey: {
        // Permanently hidden: bring-your-own-key is not an offered path (see the
        // engine options above and tests/settings.test.ts). The field stays in
        // the schema so the engine machinery and its tests keep compiling.
        hidden: () => true
    },
    geminiApiKey: {
        hidden: () => true
    },
    geminiModel: {
        hidden: () => true
    },
    groqApiKey: {
        hidden: () => true
    },
    groqModel: {
        hidden: () => true
    }
});

export default settings;
