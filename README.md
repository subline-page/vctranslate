# Subline plugin source (vcTranslate)

This is the complete corresponding source for the translation plugin inside [Subline](https://subline.page), released under the GPL-3.0-or-later (see `LICENSE`).

Each tag matches one Subline release. The tag `v0.2.6` is the source of Subline 0.2.6, build id `f4a393c764289a59`.

## What is here

| Path | What it is |
|---|---|
| `src/userplugins/vcTranslate/` | The plugin, a Vencord userplugin. |
| `installer/vencord.pin.json` | The exact Vencord commit the plugin is built with. |
| `installer/scripts/buildMod.mjs` | The build: it fetches that Vencord commit, adds the plugin, applies the changes below, and builds. |
| `installer/scripts/vencordRewrites.mjs` | Changes the build makes to Vencord's own files. |
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
