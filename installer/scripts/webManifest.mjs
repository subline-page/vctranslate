/**
 * The browser add-on's two manifests: Chromium (MV3) and Firefox (MV2).
 *
 * Derived from upstream Vencord's browser/manifest.json and manifestv2.json at
 * the pinned commit, with everything Subline does not ship taken out:
 *
 *  - no keyboard commands and no service-worker shortcuts page (Vencord's web
 *    keybinds plugin is not in the build);
 *  - no raw.githubusercontent.com (that was for online themes; no themes pane);
 *  - no Monaco editor files (the QuickCSS editor is not reachable);
 *  - only the stylesheet is web-accessible (Vencord fetches it from the page).
 *
 * And with what the plugin needs added: the background, with host permissions
 * for the relay and Google's translate host only (router.ts ALLOWED_ORIGINS),
 * so neither has to open CORS, and the page-world transport loaded before
 * Vencord. Discord's own host stays: Chromium's rule that removes Discord's
 * Content-Security-Policy (rules.json) needs host access to discord.com, and
 * Firefox's webRequest needs the same.
 *
 * Pure, so a test checks the permissions without a build.
 */

/**
 * The add-on's version. The release this add-on ships with (0.2.8 spec
 * decision 1; linking spec decision 11).
 * Set by hand with the release, like package.json's version.
 */
export const ADDON_VERSION = "0.2.8";

export const ADDON_NAME = "Subline";
export const ADDON_DESCRIPTION = "Translate Discord messages into your language, right in the chat.";
export const ADDON_HOMEPAGE = "https://subline.page";
export const FIREFOX_ADDON_ID = "addon@subline.page";

export const DISCORD_MATCH = "https://*.discord.com/*";
export const NETWORK_HOSTS = ["https://relay.subline.page/*", "https://translate-pa.googleapis.com/*"];

export const ICONS = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };

/** The files each zip holds besides dist/ (Vencord) and the licence notices. */
export const PACKAGED_FILES = {
    chromium: ["pageBridge.js", "content.js", "background.js", "rules.json", ...Object.values(ICONS)],
    firefox: ["pageBridge.js", "content.js", "background.js", ...Object.values(ICONS)]
};

/**
 * Vencord in the page's world, after the transport, in every Discord frame as
 * upstream does; the content script in the add-on's world.
 */
function contentScripts() {
    return [
        {
            run_at: "document_start",
            matches: [DISCORD_MATCH],
            js: ["content.js"],
            all_frames: true,
            world: "ISOLATED"
        },
        {
            run_at: "document_start",
            matches: [DISCORD_MATCH],
            js: ["pageBridge.js", "dist/Vencord.js"],
            all_frames: true,
            world: "MAIN"
        }
    ];
}

export function chromiumManifest(version = ADDON_VERSION) {
    return {
        manifest_version: 3,
        minimum_chrome_version: "111",
        name: ADDON_NAME,
        version,
        description: ADDON_DESCRIPTION,
        homepage_url: ADDON_HOMEPAGE,
        icons: ICONS,
        host_permissions: [DISCORD_MATCH, ...NETWORK_HOSTS],
        permissions: ["declarativeNetRequestWithHostAccess"],
        background: { service_worker: "background.js" },
        content_scripts: contentScripts(),
        web_accessible_resources: [{ resources: ["dist/Vencord.css"], matches: [DISCORD_MATCH] }],
        declarative_net_request: {
            rule_resources: [{ id: "discordCsp", enabled: true, path: "rules.json" }]
        }
    };
}

export function firefoxManifest(version = ADDON_VERSION) {
    return {
        manifest_version: 2,
        name: ADDON_NAME,
        version,
        description: ADDON_DESCRIPTION,
        homepage_url: ADDON_HOMEPAGE,
        icons: ICONS,
        permissions: ["webRequest", "webRequestBlocking", DISCORD_MATCH, ...NETWORK_HOSTS],
        background: { scripts: ["background.js"] },
        content_scripts: contentScripts(),
        web_accessible_resources: ["dist/Vencord.css"],
        browser_specific_settings: {
            gecko: {
                id: FIREFOX_ADDON_ID,
                // world: "MAIN" content scripts need Firefox 128 (upstream's floor too).
                strict_min_version: "128.0",
                // Firefox Add-ons asks every new add-on to declare what leaves
                // the device (extensionworkshop.com, firefox-builtin-data-consent):
                //  - websiteContent: message text goes to the translators
                //    (Google, the relay);
                //  - authenticationInfo: linking sends Discord's sign-in code
                //    to the relay, which ties the plan to the Discord account;
                //  - personallyIdentifyingInfo: the feedback box can send an
                //    email address;
                //  - technicalAndInteraction (optional only, by Firefox's
                //    rules): the patch health report (versions, build, failed
                //    patches), sent only when the user allowed it (router.ts).
                data_collection_permissions: {
                    required: ["websiteContent", "authenticationInfo", "personallyIdentifyingInfo"],
                    optional: ["technicalAndInteraction"]
                }
            }
        }
    };
}
