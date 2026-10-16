/** Types for webManifest.mjs, so the tests that read it are type-checked. */
export interface WebManifest {
    manifest_version: number;
    name: string;
    version: string;
    description: string;
    homepage_url: string;
    icons: Record<string, string>;
    permissions: string[];
    host_permissions?: string[];
    background: { service_worker?: string; scripts?: string[] };
    content_scripts: { run_at: string; matches: string[]; js: string[]; all_frames: boolean; world: string }[];
    web_accessible_resources: unknown[];
    declarative_net_request?: { rule_resources: { id: string; enabled: boolean; path: string }[] };
    browser_specific_settings?: { gecko: { id: string; strict_min_version: string; data_collection_permissions: { required: string[]; optional: string[] } } };
    [key: string]: unknown;
}
export declare const ADDON_VERSION: string;
export declare const ADDON_NAME: string;
export declare const ADDON_DESCRIPTION: string;
export declare const ADDON_HOMEPAGE: string;
export declare const FIREFOX_ADDON_ID: string;
export declare const DISCORD_MATCH: string;
export declare const NETWORK_HOSTS: string[];
export declare const ICONS: Record<string, string>;
export declare const PACKAGED_FILES: { chromium: string[]; firefox: string[] };
export declare function chromiumManifest(version?: string): WebManifest;
export declare function firefoxManifest(version?: string): WebManifest;
