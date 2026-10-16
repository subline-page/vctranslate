/*
 * Subline browser add-on: the background (Chromium service worker, Firefox
 * background page). Bundled by installer/scripts/buildWeb.mjs.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two jobs:
 *  1. Run the plugin's network calls (router.ts), with fetch limited to the
 *     relay and Google's translate host.
 *  2. Firefox only: remove Discord's Content-Security-Policy from its page, as
 *     upstream Vencord's Firefox background does. Vencord's page code fetches
 *     its own stylesheet from the add-on and recompiles Discord's modules,
 *     and Discord's policy would block both. Chromium does the same with a
 *     declarativeNetRequest rule (rules.json) and needs no code for it.
 *
 * No remote code: everything this runs is in the package.
 */

// The plugin's own desktop functions: same relay headers, retries and shapes.
import { setRelayAppSource } from "../../../src/userplugins/vcTranslate/engines/relay";
import * as native from "../../../src/userplugins/vcTranslate/native";
import { addonAppHeader, CALL_TAG, type Consent, guardFetch, type NativeFunctions, route, technicalDataAllowed } from "./router";

declare const browser: any;
declare const chrome: any;

const api = typeof browser !== "undefined" ? browser : chrome;

globalThis.fetch = guardFetch(globalThis.fetch.bind(globalThis));

// Every relay request names the add-on (x-subline-app: addon/<version>), as
// the desktop names its app. Read once: the version is fixed for the life of
// this background. A manifest without a usable version sends no header.
let appHeader: string | null = null;
try {
    appHeader = addonAppHeader(api.runtime.getManifest()?.version);
} catch {
    appHeader = null;
}
setRelayAppSource(() => appHeader);

// Firefox: the manifest declares data collection, and a patch health report
// (technical data) is optional there, so it goes only when the user allowed
// it. Chromium declares data in the store listing instead, not here.
const consent: Consent | undefined = api.runtime.getManifest().browser_specific_settings?.gecko?.data_collection_permissions
    ? { technical: () => technicalDataAllowed(api.permissions) }
    : undefined;

api.runtime.onMessage.addListener((message: unknown, sender: { id?: string; url?: string; }, sendResponse: (reply: unknown) => void) => {
    if (message === null || typeof message !== "object" || (message as { tag?: unknown; }).tag !== CALL_TAG) return false;
    route(native as unknown as NativeFunctions, message, sender, api.runtime.id, consent).then(reply => {
        if (!reply.ok) console.warn(`[Subline] Refused a call from ${sender.url ?? "an unknown page"}: ${reply.refused}`);
        sendResponse(reply);
    });
    // The answer is sent later (Chromium needs `true` to keep the channel open).
    return true;
});

if (api.runtime.getManifest().manifest_version === 2 && api.webRequest?.onHeadersReceived) {
    api.webRequest.onHeadersReceived.addListener(
        ({ responseHeaders }: { responseHeaders?: { name: string; value?: string; }[]; }) => {
            if (!responseHeaders) return;
            return {
                responseHeaders: responseHeaders.filter(h => {
                    const name = h.name.toLowerCase();
                    return name !== "content-security-policy" && name !== "content-security-policy-report-only";
                })
            };
        },
        { urls: ["https://discord.com/*", "https://*.discord.com/*"], types: ["main_frame", "sub_frame"] },
        ["blocking", "responseHeaders"]
    );
}
