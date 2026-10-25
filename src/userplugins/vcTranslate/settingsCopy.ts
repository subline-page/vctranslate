/**
 * Every title and description on Subline's settings page, in one place, so the
 * copy can be rewritten without reading any code. Titles are sentence case and
 * go to Vencord's `displayName` (without one, Vencord builds a title from the
 * setting's key, e.g. "Target Lang"). Keys stay as they are: the installer
 * writes some of them into Vencord's settings.json, and renaming them would
 * strand stored values. Short plain sentences, no em dashes.
 */
export const SETTINGS_COPY = {
    /** The line at the top of the Subline settings tab (installer/packaging/branding/sublineTab.tsx mirrors it). */
    top: "Subline translates messages in other languages and shows the translation underneath.",
    sublineCode: {
        title: "Subline code",
        description: "From your purchase email. Keeps everything automatic."
    },
    /**
     * The plan card at the top of the page: its code and links. The plan line
     * itself is the ✦ button's hover text (upgradeCopy.ts PLAN_COPY, picked by
     * planState.ts), so the two never disagree.
     */
    plan: {
        codeLabel: "Your code:",
        copy: "Copy",
        copied: "Code copied.",
        /** Opens the plan panel (the prices first). */
        subscribe: "Subscribe",
        /** The account line, once linked. {name} is the Discord username, read locally (UserStore). */
        linkedTo: "Linked to @{name}",
        /** In place of the plan while the Discord account is not linked, and its link. */
        notLinked: "Link your Discord account to use Subline.",
        link: "Link",
        enterCode: "Enter a code",
        /** The browser add-on only, with a plan (0.2.8): the line, then its link to subline.page. */
        appPrompt: "Also want it in the Discord app?",
        appLink: "Download Subline"
    },
    targetLang: {
        title: "Reading language",
        description: "Messages are translated into this language."
    },
    catchUpCount: {
        title: "Earlier messages",
        description: "How many recent messages to translate when you open a channel."
    },
    globalAuto: {
        title: "All servers",
        description: "Off: only channels you turn on with the globe button. DMs stay off unless you turn one on."
    },
    translateSurfaces: {
        title: "Profiles, embeds and more",
        description: "Also translate statuses, bios, embeds, polls, topics and titles."
    },
    translateNames: {
        title: "Names and pronouns",
        description: "Hover a name to see it in your language. Profiles show it under the name."
    },
    debugLogging: {
        title: "Debug log",
        description: "Writes details to Discord's console for troubleshooting. Stays on your computer."
    }
} as const;
