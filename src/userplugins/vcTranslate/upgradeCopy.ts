/**
 * Every user-facing string for activating and upgrading Subline from inside
 * Discord: the activation notice, the plan panel, the code entry, their
 * toasts, and the ⚡ popover labels. One place, so the copy can be rewritten
 * without reading any code. Short plain sentences, no em dashes. Never
 * "free", "trial", "VcTranslate", "Plugins" or "plugin" (0.2.9 spec, copy
 * rules; tests/planCopy.test.ts).
 */
/** AI prices in cents, as on the Dodo products. The yearly saving below is derived from them. */
export const AI_MONTHLY_CENTS = 199;
export const AI_ANNUAL_CENTS = 1999;

/**
 * What a year saves against 12 months, in whole percent, rounded DOWN so the
 * claim is never bigger than the real saving ($23.88 vs $19.99 is 16.3%).
 */
export function annualSavingPercent(monthlyCents: number, annualCents: number): number {
    return Math.floor((12 * monthlyCents - annualCents) * 100 / (12 * monthlyCents));
}

const ANNUAL_NOTE = `Save ${annualSavingPercent(AI_MONTHLY_CENTS, AI_ANNUAL_CENTS)}%`;

/**
 * A price in cents as the reader sees it: "$1.99", "$19.99", and "$2.00",
 * never "$2" (always two decimals, as Dodo shows it). A sentence built from
 * the cents above cannot drift from the products.
 */
export function formatUsd(cents: number): string {
    const whole = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
    return `$${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

export const UPGRADE_COPY = {
    /* ---- not activated ---- */
    /** A notice that stays until dismissed, shown once per session while not activated. */
    activateNotice: "Subline isn't active on this Discord account yet.",
    activateButton: "Activate",
    enterCodeButton: "Enter a code",

    /* ---- entering a code (promo codes and license keys) ---- */
    codeTitle: "Enter a code",
    codeSubtitle: "A server code, or the code from your purchase email.",
    codePlaceholder: "Your code",
    codeSubmit: "Activate",
    codeEmpty: "Type or paste a code first.",
    codeClaimed: "This code has been fully claimed.",
    codeNotFound: "That code doesn't exist. Check it against your receipt email. If it still does not work, write to support@subline.page.",
    codeAlready: "Already yours.",
    codeUnreachable: "Can't reach Subline right now. Try again in a minute.",
    codeRateLimited: "Too many codes tried from this network today. Try again after midnight UTC.",
    /** A promo code allows only a few claims from one network. */
    codeNetLimited: "This code has reached its limit on your network.",
    deviceLimit: "This code is on 3 computers already. It frees up after 30 days unused, or email support@subline.page for a reset.",
    /** The button next to the device-limit sentence: copies SUPPORT_EMAIL (Vencord opens no mailto: links). */
    deviceLimitButton: "Copy email",
    /** 409 code_on_other_account: a typed code (or a promo's code) is linked to another Discord account. */
    codeOnOtherAccount: "This code belongs to another Discord account. Write to support.",
    /** 409 code_in_use: the code's plan is held by another computer that has not linked yet (a key shared on 0.2.5). */
    codeInUse: "This code is in use on another computer. Link Subline on that computer first.",
    /** 403 account_too_new: a promo code needs a Discord account at least 30 days old. */
    accountTooNew: "This code needs a Discord account older than 30 days.",
    /** 403 not_linked: anything that needs the Discord account linked first. */
    notLinked: "Link your Discord account first.",
    /** The toast after deviceLimitButton copied the address. */
    emailCopied: "Email copied.",

    /* ---- a saved code the relay could not check yet ---- */
    /** A notice while a saved code is unconfirmed because the relay can't be reached. No Activate button. */
    checkingNotice: "Can't reach Subline to check your code. Retrying.",
    checkingNoticeButton: "OK",

    /* ---- an early user's first 0.2.0 start, before the relay has answered ---- */
    /** Instead of the activation notice while the early-user check is still out (at most a day). */
    earlyCheckingNotice: "Checking your early-user access. This can take a minute.",
    earlyCheckingNoticeButton: "OK",

    /* ---- the plan panel (0.2.9): monthly, yearly, Enter a code ---- */
    /**
     * The only line under the prices in the plan panel (P3): a Dodo coupon
     * goes on the checkout page, not in Subline. Coupons are made for the
     * monthly plan only (relay createCoupon: restricted_to [monthly]), so the
     * yearly page refuses them: the line says which button to press.
     */
    couponHint: "Coupon? Pick $1.99 a month, then enter it on the payment page.",
    monthlyButton: "$1.99 a month",
    annualButton: `$19.99 a year · ${ANNUAL_NOTE}`,
    /** Monthly or Yearly on an account that already has AI (relay 409 already_owned). */
    alreadyAi: "You have this plan.",
    /** Subscribe while a payment from this install is still being confirmed. */
    purchasePending: "Your payment is still being confirmed. It switches on by itself.",
    /**
     * In place of Subscribe on the plan card, the ⚡ popover and as the plan
     * panel's text, while a payment is on its way (P4): a checkout was
     * opened, or the relay said so. The ✦ button's hover text too (decision 11).
     */
    paymentPending: "Payment on its way",
    /** The relay answered that it cannot sell this right now (no product set up, or the shop is down). */
    checkoutUnavailable: "Buying isn't available yet. Use a code, or try again later.",
    /** In a browser: the popup blocker stopped the checkout tab (checkout.ts ReservedTab). */
    checkoutBlocked: "Your browser blocked the checkout window. Allow pop-ups for discord.com, then try again.",

    /* ---- shared ---- */
    checkoutOpenedToast: "Finish checkout in your browser.",
    /** A notice that stays until dismissed: the buyer is often still in the browser when it lands. */
    purchasedNotice: "You're on. Every message translates by itself now.",
    purchasedNoticeButton: "OK",
    /**
     * Instead of "You're on." when the relay grants the early-user plan
     * (0.2.9: treated as a new account, so the 7 days, spec decision 4).
     */
    earlyNotice: "Thanks for being early. Your 7 days of AI ✦ start with your first translation.",

    /* ---- ⚡ while ✦ is off: five AI translations a day (spec decision 6) ---- */
    /** The ⚡ popover while ✦ is off. {n} is how many are left today. */
    popoverPreview: "Translate with AI ({n} left today)",
    /** The ⚡ popover once today's five are used. A press opens the plan panel. */
    popoverUpgrade: "No AI translations left today · Subscribe",
    // A ⚡ press on a message ✦ says is already in the reader's language: no
    // duplicate line, just this.
    nothingToTranslate: "✦ nothing to translate here",

    /* ---- the ✦ pipeline (0.2.9) ---- */
    /** A message whose ✦ request got no answer yet (it is asked again by itself). */
    waitingLine: "⏳ translating…",
    waitingTitle: "No answer yet. Subline asks again by itself.",
    /** A message the AI left out twice. ⚡ asks again. */
    failedLine: "⚠ not translated",
    failedTitle: "The AI did not return this message. Press ⚡ to try again.",
    /**
     * The hidden daily ceiling (spec decision 5): one plain notice, never a
     * number. "Tomorrow" is the next UTC day, when the relay resets it.
     */
    aiPaused: "Translation is paused until tomorrow.",
    aiPausedButton: "OK"
} as const;

/**
 * THE PLAN STATE (0.2.9 spec, decisions 11 to 13): the ✦ chat-bar button's
 * hover text, the plan panel, the last-day notice, the ended panel and the
 * update panel. planState.ts picks the sentence. {n}: a whole number of days.
 * The hidden daily ceiling is never a number here (decision 5).
 */
export const PLAN_COPY = {
    /** ✦ on: a subscription, or a buyer (AI for good). */
    on: "AI translation on",
    /** ✦ on: a running period. */
    daysLeft: "AI translation on · {n} days left",
    oneDayLeft: "AI translation on · 1 day left",
    /** ✦ on: the period starts with the first translation. */
    notStarted: "AI translation on · {n} days from your first translation",
    /** ✦ off. */
    off: "Translation is off · Subscribe to turn it on",
    /** ✦ off, an AI payment on its way. */
    pending: "Payment on its way",
    /** Not linked to a Discord account (the click links). */
    link: "Link your Discord account to use Subline",
    /** The plan panel's text for a subscription or a buyer: nothing to buy or enter (owner, 2026-10-25). */
    onPanel: "AI translation is on for every message.",
    /** The plan panel's title. */
    panelTitle: "AI translation",
    /** The plan panel's close button when there is nothing to buy (subscribed, a buyer, a payment on its way). */
    ok: "OK",
    /**
     * The last-day notice, once per period (decision 12). Its button, and the
     * inline "Later". The prices ride in the same notice: no second message.
     */
    lastDay: `Your AI translation ends tomorrow. Keep it for ${formatUsd(AI_MONTHLY_CENTS)} a month or ${formatUsd(AI_ANNUAL_CENTS)} a year.`,
    subscribe: "Subscribe",
    later: "Later",
    /** The ended panel, once per period. {n}: 7, or 30 for a promo. */
    endedTitle: "Your {n} days of AI translation have ended.",
    endedBody: "Subscribe to keep reading every message in your language.",
    notNow: "Not now",
    /** The update panel, once, on the first start of 0.2.9 (decision 13). */
    updateTitle: "Subline",
    whatsNew: "What's new",
    /** Owner, 2026-10-25. A subscription gets no update panel. */
    update: {
        /** Bought Automatic on 0.2.8. */
        buyer: "Your plan now includes AI ✦ on everything, at no extra cost.",
        /** A server code redeemed on 0.2.8: AI for good. */
        promoKept: "Every translation is AI ✦ now.",
        /** A server code redeemed on 0.2.9, its 30 days not started yet. */
        promo: "Your server code gives you 30 days of AI from your first translation.",
        /** A new install, or no plan yet: a welcome, not an update. {n}: 7. */
        noPlan: "Your {n} days of AI translation start with the next message it translates."
    },
    /** The title over update.noPlan (it has no What's new: there is no change to read about). */
    welcomeTitle: "Welcome to Subline"
} as const;

/** The update panel's "What's new": Subline's public release notes (it exists today). */
export const WHATS_NEW_URL = "https://github.com/subline-page/subline/releases";

/** Where the device-limit sentence sends the reader to ask for a reset. */
export const SUPPORT_EMAIL = "support@subline.page";

/**
 * The small toggle at the end of a status or bio that is shown translated in
 * place. Its glyph says what is showing: the translation's own glyph (✦), or
 * ↩ for the original. The label is its tooltip and its
 * screen-reader name, and says what a click does.
 */
export const IN_PLACE_COPY = {
    originalGlyph: "↩",
    showOriginal: "Show the original",
    showTranslation: "Show the translation"
} as const;

/**
 * A LONG MESSAGE TRANSLATED IN PLACE (0.2.11, index.tsx InPlaceAccessory):
 * over 280 characters or 4 lines, the translation takes the original's place
 * in normal message text, and a small muted marker follows it, like
 * Discord's own "(edited)": "✦ Turkish · Show original". A click shows
 * Discord's original again, with "✦ Show translation" under it.
 */
export const MESSAGE_SWAP_COPY = {
    /** The marker's start; {lang} is the source language's English name. */
    from: "✦ {lang}",
    /** The marker's start when the source language is not known. */
    fromUnknown: "✦",
    showOriginal: "Show original",
    /** Under Discord's original after "Show original". */
    showTranslation: "✦ Show translation",
    /** Discord's own "(edited)" sits in the original, which is hidden: said again after the translation. */
    edited: "(edited)",
    /** The hover on "✦ Turkish". */
    title: "Translated by Subline · {lang}",
    titleUnknown: "Translated by Subline"
} as const;

/**
 * Names and pronouns (0.2.8, surfaces/namesUi.tsx): the hover tooltip's
 * label, what it says while the translation is on its way, and the ✦ button
 * (while ✦ is on).
 */
export const NAMES_COPY = {
    label: "Translation:",
    waiting: "…",
    aiGlyph: "✦",
    askAi: "Translate with AI"
} as const;

/**
 * "Send in [language]" (0.2.11, sendIn.ts): the ✦ menu while AI is on, and
 * the short notes when a message could not be translated before sending.
 * Every note says the message was not sent, so nobody wonders.
 */
export const SEND_IN_COPY = {
    /** The ✦ panel's name (for screen readers; no heading is drawn). */
    heading: "Send my messages in",
    /** The panel's search box: it also says what the panel is for. */
    search: "Send my messages in…",
    /** The panel's section labels. */
    sectionChannel: "In this channel",
    sectionRecent: "Recent",
    sectionCommon: "Common",
    /** The search found nothing. */
    noMatch: "No language found",
    /** Turns Send in off in this channel. */
    off: "Off",
    /** The label next to ✦ while Send in is on; {lang} is the language's English name. */
    label: "→ {lang}",
    /** The label's hover. */
    labelHover: "Your messages here are sent in {lang}. Click to change.",
    /** The label's ✕. */
    labelOff: "Turn off Send in",
    /** The grey label: the day's Send in messages are used up. */
    labelLimit: "limit reached for today",
    /** The grey label: AI translation is not on. */
    labelNoAi: "needs AI translation",
    /** The grey label: the relay paused AI translation until tomorrow. */
    labelPaused: "paused until tomorrow",
    /** The grey label: Vencord's send hook is missing after a Discord update. */
    labelUnavailable: "not working with this Discord version",
    /** The status line while a message is translated. */
    sending: "Sending in {lang}…",
    tryAgain: "Try again",
    sendAsWritten: "Send as written",
    /** After the first note, when more than one message was kept. */
    more: "({n} messages)",
    /** After "Try again" on a message with files, when Subline could not press Enter for the reader. */
    pressEnter: "Press Enter to try again.",
    /** After "Send as written" on a message with files. */
    pressEnterAsWritten: "Press Enter to send as written.",
    /** After the reader's own message Send in sent, like Discord's "(edited)"; only they see it. {lang}: the language's English name. */
    sentIn: "(sent in {lang})",
    /** The same, for a message whose language was not kept (the first 0.2.11 builds). */
    sentTranslated: "(sent translated)",
    /** The marker's hover: what the reader typed. */
    youWrote: "You wrote: {text}",
    failed: "Not sent. Couldn't translate.",
    timeout: "Not sent. Translation took too long.",
    paused: "Not sent. AI translation is paused until tomorrow. Next messages go as written.",
    tokensLost: "Not sent. Couldn't keep the mentions and links.",
    tooLong: "Not sent. Too long to translate.",
    tooLongOut: "Not sent. The translation is longer than Discord allows.",
    tooMany: "Not sent. Too many messages at once.",
    heldBehind: "Not sent. Kept after the message before it.",
    sendFailed: "Not sent. Discord didn't take the message.",
    boxNotCleared: "Couldn't empty the message box. Your text is still there, not sent.",
    limit: "Not sent. Send in limit reached for today. Next messages go as written.",
    noAi: "Not sent. Send in needs AI translation. Next messages go as written.",
    unavailable: "Send in doesn't work with this Discord version yet.",
    /** Subline stopped with messages out of the box and not sent; {n} is how many. */
    lostOnStop: "Subline stopped. {n} unsent message(s) put back in the message box.",
    lostOnStopElsewhere: "Subline stopped. {n} unsent message(s) were not sent."
} as const;

/**
 * Linking the Discord account (0.2.8, link.ts). Every plan belongs to one
 * Discord account, and nothing translates until it is linked.
 */
export const LINK_COPY = {
    /** The bar (a notice that stays) while the account is not linked, and its button. */
    notice: "Link your Discord account to use Subline",
    button: "Link",
    /** The small line under the newest message Subline would translate, while not linked (linkHint.ts). Its action is `button`. */
    hint: "Link your Discord account to translate",
    /** After Authorize, in a toast. {name} is the Discord username, read locally. */
    linked: "Linked to @{name}.",
    /** 400 bad_code / 401 discord_refused, or Discord answered with no code. */
    refused: "Discord could not confirm your account. Try again.",
    /** No answer, 502 discord_unreachable, 503 unavailable. */
    unreachable: "Subline could not reach its server. Try again.",
    /** 429: the relay allows a few links an hour. */
    rateLimited: "Too many tries. Try again in an hour.",
    /** Discord's Authorize window could not be opened at all. */
    windowFailed: "Discord's Authorize window didn't open. Try again.",
    /** One of Subline's own windows (the account confirm, Move my plan, the QR code) could not be opened. */
    ownWindowFailed: "Subline's window didn't open. Try again.",
    /**
     * The Link bar for a prior payer (0.2.8, mustLink): the plan keeps
     * working, nothing is blocked; linking keeps it on every computer.
     */
    mustLinkNotice: "Link your Discord account to keep Subline on every computer",
    /** 409 plan_held: another computer holds this plan (a key shared on 0.2.5). This one keeps translating. */
    planHeld: "Subline keeps working here. Link it on the computer that bought this plan first, then try again.",
    /** Discord has not said who is signed in yet (just after start): nothing can be named, so nothing binds. */
    noAccount: "Subline does not know your Discord account yet. Try again in a moment.",
    /** The title of the window that says an outcome while Subline's Settings is open (a toast is hidden there). */
    resultTitle: "Subline"
} as const;

/**
 * EVERY BIND NAMES THE ACCOUNT (0.2.8 spec, decision 2): the confirm shown
 * before Subscribe, a code, and a Link that would bind this
 * computer's earlier plan. {name} is the Discord username, read locally
 * (UserStore), never sent.
 */
export const ACCOUNT_COPY = {
    confirmTitle: "This plan will belong to @{name}",
    confirmBody: "Only this Discord account can use it. You can move it later from this account.",
    yes: "Yes, use @{name}",
    other: "Use another account",
    /** After "Use another account". Nothing is stored. */
    otherTitle: "Use another account",
    otherBody: "Switch to that account in Discord (click your avatar, bottom left), then open Subline's Settings.",
    ok: "OK",
    /** 409 wrong_account: Discord authorized another account than the signed-in one. */
    wrongAccount: "Discord authorized another account, not @{name}. Nothing was changed.",
    /** An account without a plan, where another local account linked the plan here. Local names only. */
    planElsewhere: "Your Subline plan is on @{name} on this computer. Switch to that account to use it.",
    /**
     * The same, to an account that is not linked: it may own a plan of its
     * own that only its Link can find (owner Windows test, 2026-10-16). The
     * button is LINK_COPY.button.
     */
    planElsewhereLink: "Your Subline plan is on @{name} on this computer. Switch to that account, or link this one if it has its own plan."
} as const;

/**
 * THE AUTHORIZE FALLBACK (0.2.8, linkFallback.ts): Discord's Authorize page
 * in the browser, when the window inside Discord is missing or broke.
 */
export const FALLBACK_COPY = {
    /** A toast when the browser opens. */
    opened: "Finish in your browser. Subline waits for 5 minutes.",
    /** The relay could not match the browser to this computer: the page shows a code to type here. */
    pairTitle: "Type the code from your browser",
    pairBody: "Your browser shows a 6-digit code. Type it here to finish.",
    pairPlaceholder: "123 456",
    pairButton: "Link",
    /** {n}: tries left. */
    pairWrong: "That code is not right. {n} tries left.",
    expired: "That sign-in expired. Press Link to try again.",
    timeout: "Nothing came back from your browser. Press Link to try again.",
    blocked: "Your browser blocked the sign-in window. Allow pop-ups for discord.com, then try again."
} as const;

/** MOVE MY PLAN (0.2.8 spec, decision 5). {name}, {from}, {to}: Discord usernames, read locally. */
export const MOVE_COPY = {
    /** In Subline's Settings, under the plan, on the account that has it. */
    settingsLink: "Move my plan to another Discord account",
    startTitle: "Move your plan",
    startBody: "Your plan moves from @{name} to the Discord account you switch to next. @{name} can no longer use it after. A plan can move once every 30 days.",
    startButton: "Start",
    cancel: "Cancel",
    switchTitle: "Now switch accounts",
    switchBody: "In Discord, click your avatar (bottom left) and switch to the other account. Subline finishes the move there. This works for 10 minutes.",
    /** On the new account, naming both accounts: the confirm before anything moves. */
    hereTitle: "Move your plan here?",
    hereBody: "Your Subline plan moves from @{from} to @{to}. Only @{to} can use it after.",
    hereButton: "Move to @{to}",
    later: "Not now",
    /** In Subline's Settings on the new account, while a move waits for it: opens the window above again. */
    finishLink: "Finish moving your plan here",
    done: "Your plan is on @{name} now.",
    /** 409 move_too_soon. {date}: the day it may move again. */
    tooSoon: "Your plan moved recently. It can move again on {date}.",
    expired: "The move took longer than 10 minutes. Start it again from the account that has the plan.",
    sameAccount: "This is the account that has the plan. Switch to the other account first.",
    noPlan: "There is no plan to move.",
    tooNew: "This plan can't move to a Discord account younger than 30 days.",
    busy: "A move is already running. Try again in a minute."
} as const;

/** "Pay on another device" (0.2.8 spec, decision 6): the checkout link and its QR code. */
export const ELSEWHERE_COPY = {
    link: "Pay on another device",
    title: "Pay on another device",
    body: "Scan this code with your phone, or open the link on any device. Subline switches on here by itself.",
    done: "Done",
    /** There are two plans: which one to pay for elsewhere. */
    choose: "Pick a plan."
} as const;

/**
 * In a browser: the store updated the add-on while this Discord tab stayed
 * open, so this tab can no longer reach it. Only a reload brings it back.
 */
export const ADDON_RELOAD_COPY = {
    notice: "Subline was updated. Reload this tab to keep translating.",
    button: "Reload"
} as const;

/**
 * The add-on's Chrome Web Store page. Kept equal to scripts/storeLinks.mjs
 * STORE_URLS.chrome by a test: change both.
 */
export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/subline/eenbmffpbhjoadmigpnhidcoafmcncaa";
/** Where the add-on's review request sends the reader: the store page's reviews. */
export const CHROME_REVIEWS_URL = `${CHROME_STORE_URL}/reviews`;

/**
 * "SHARE TRANSLATION" (shareCard.ts, sharePanel.tsx): an image of one
 * message and its translation, made on this computer and sent nowhere. The
 * brand rides on the image, never on the lines in Discord.
 */
export const SHARE_COPY = {
    /** The message right-click item, next to "Report translation". */
    menu: "Share translation",
    title: "Share translation",
    subtitle: "The author, mentions, links and server details are left out. Check for other names before you share.",
    copy: "Copy image",
    cancel: "Cancel",
    /** In place of Copy image once copying failed. */
    save: "Save image",
    copied: "Image copied.",
    copyFailed: "Couldn't copy the image. Save it instead.",
    saved: "Image saved.",
    saveFailed: "Couldn't make the image. Try again.",
    /** On the image. */
    someone: "Someone",
    mention: "@someone",
    channel: "#channel",
    link: "[link]",
    /** In place of a spoiler's hidden text. */
    spoiler: "▇▇▇",
    footer: "✦ Translated by Subline · subline.page"
} as const;

/**
 * THE REVIEW REQUEST (usageDays.ts): once per computer, ever. In the browser
 * it opens the store's reviews; the desktop app has no store page, so it
 * opens the feedback box instead. No incentive, no stars.
 */
export const REVIEW_COPY = {
    storeNotice: "Is Subline useful to you? A short review helps other people find it.",
    storeButton: "Write a review",
    desktopNotice: "Is Subline useful to you? Tell us what you think.",
    desktopButton: "Tell us",
    /** The inline link that closes it. */
    noThanks: "No thanks",
    /** The feedback box's title when the desktop request opens it. */
    feedbackTitle: "Tell us what you think"
} as const;

/** "Where did you hear about Subline?" (heardFrom.ts): once per computer, ever. */
export const HEARD_COPY = {
    title: "Where did you hear about Subline?",
    subtitle: "One tap. Only your answer is counted.",
    server: "A Discord server",
    friend: "A friend",
    reddit: "Reddit",
    video: "YouTube or TikTok",
    search: "A web search",
    store: "Chrome Web Store",
    other: "Somewhere else",
    skip: "Skip"
} as const;
