# Subline plugin source (vcTranslate)

This is the complete corresponding source for the translation plugin inside [Subline](https://subline.page), released under the GPL-3.0-or-later (see `LICENSE`).

Each tag matches one Subline release. The tag `v0.2.8` is the source of Subline 0.2.8, build id `5ac0b15b45ddf81a`.

## What is here

| Path | What it is |
|---|---|
| `src/userplugins/vcTranslate/` | The plugin, a Vencord userplugin. |
| `installer/vencord.pin.json` | The exact Vencord commit the plugin is built with. |
| `installer/scripts/buildMod.mjs` | The desktop build: it fetches that Vencord commit, adds the plugin, applies the changes below, and builds. |
| `installer/scripts/buildWeb.mjs` | The browser add-on build: the same Vencord commit and plugin, built for the browser and packed for each store. |
| `installer/scripts/vencordSource.mjs` | The steps both builds share: fetching Vencord, adding the plugin, the Subline settings tab and branding. |
| `installer/scripts/vencordRewrites.mjs` | Changes the builds make to Vencord's own files. |
| `installer/scripts/webManifest.mjs` | The add-on's manifests and permissions. |
| `installer/packaging/browser/` | The add-on's own files: its background, the page bridge, the content script, the header rule and the icons. |
| `installer/packaging/branding/sublineTab.tsx` | The Subline settings tab the build adds to Vencord. |
| `installer/src/bundle/spec.ts` | The bundle manifest and its checks. |
| `scripts/stampBuild.mjs` | Computes the build id. |

## Check the build id

```sh
node -e 'import("./scripts/stampBuild.mjs").then(m => console.log(m.computeStamp()))'
```

It prints the version and build id. They match the `pluginVersion` and `buildId` in `subline-mod.json` inside the Subline you installed, and the `SOURCE.txt` next to it.

## Vencord

Vencord is GPL-3.0-or-later, by Vendicated and contributors: https://github.com/Vendicated/Vencord. The corresponding Vencord source is that repository at the commit in `installer/vencord.pin.json`, with the changes made by the build scripts above.

Subline is not made by Discord. Contact: support@subline.page
