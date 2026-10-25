# Subline: the code inside Discord (`vcTranslate`)

This folder is the part of [Subline](https://subline.page) that runs inside
Discord. It reads the messages in the channel you have open. It shows an AI
translation as a dimmed, italic line under each message in another language.

This file describes Subline 0.2.9. Version 0.2.9 translates only with AI (✦),
through Subline's relay at `relay.subline.page`.

> **History.** Versions 0.2.8 and older also used Google Translate. They
> showed a fast `≈` line from Google first, then a `✦` line from AI. Version
> 0.2.9 has no Google code path and shows no `≈` lines. A `≈` line that an
> older version saved on this computer is dropped when Subline loads
> (`store.ts`, `surfaces/cache.ts`).

The code identifiers keep the old name: the folder `vcTranslate`, the
Vencord name `VcTranslate`, the logger tag `VcTranslate` and the storage keys
`VcTranslate_*`. People never see this name. In Discord, Subline shows as
**Subline → Settings** in the settings sidebar.

## Where it runs

- **The Discord app.** The Subline app builds Vencord with this folder in it
  and installs that build into Discord. Network calls run in Discord's main
  process (`native.ts`). Discord's page never sees the credential.
- **The browser add-on.** The same code runs in Discord in a browser. The
  add-on's background part makes the network calls (`transport.ts`).

`transport.ts` picks the route on every call. All translation requests go to
the relay, on both routes.

## Build it yourself

You need a Vencord checkout built from source.

```bash
# from the Vencord repo root
mkdir -p src/userplugins
cp -r /path/to/vcTranslate src/userplugins/
pnpm build
```

If you use a symlink instead of a copy, esbuild looks for `tsconfig.json`
from the real path of each file. The real path is then outside the Vencord
tree. Add a `tsconfig.json` with Vencord's `paths` map (for `@api/*`,
`@utils/*`, `@webpack/common` and the others) above the folder, or esbuild
cannot resolve those imports. A copy needs nothing extra.

To load your build into Discord, run:

```bash
pnpm inject
```

**Warning:** `pnpm inject` changes your real Discord install. `pnpm uninject`
undoes it.

Then restart Discord. Turn on the entry `VcTranslate` in Vencord's own
settings. The Subline app does this step for you: it writes the setting into
Vencord's `settings.json`.

Subline's own builds come from `installer/scripts/buildMod.mjs` (the app) and
`installer/scripts/buildWeb.mjs` (the add-on), at the Vencord commit in
`installer/vencord.pin.json`.

## Plans and access

The relay decides what each Discord account has. Subline asks it with
`GET /v1/status`. The answer carries an `access` object (`planAccess.ts`).
Subline keeps the last answer on this computer (`entitlement.ts`). It asks
again when Discord starts, about every 24 hours, and at other times listed on
the privacy page.

Every relay request says that this client is AI only. It sends the header
`x-subline-ai-only: 1`, with `x-subline-api: 3` and the client version
(`engines/relay.ts`). The relay keeps the old behaviour for 0.2.8 and older
clients.

A plan belongs to one Discord account. Subline links the computer to your
Discord account first (Discord's own Authorize window, see `link.ts`). Until
the account is linked, nothing is translated. There is one exception. A
computer that had a bought plan or a server code before 0.2.8 keeps it until
it links. A Link bar asks it to link (`mustLink` in `entitlement.ts`).

The code works with three levels (`entitlementLevel` in `entitlement.ts`):

| Level | When | What Subline does |
|---|---|---|
| ✦ on (`ai`) | A running period, a period that has not started yet, a subscription, a plan bought before 0.2.9, a server code redeemed before 0.2.9, or AI paid for before the price change | Translates every message in channels that are on, plus profiles, embeds, names and the other texts below |
| ✦ off, ⚡ left (`automatic`) | The relay gives ⚡ but no ✦. For example, a period ended, or the Discord account is too new for the 7 days | Translates nothing by itself. ⚡ gives up to 5 AI translations a day |
| Nothing (`none`) | No answer from the relay yet, the relay's pass expired, not linked, or nothing on the account | Translates nothing. One notice offers to link or to activate |

The relay sets these rules. In short (see also the privacy page):

- A linked Discord account that is at least 30 days old gets **7 days** of
  AI, once. They start with the first ✦ translation, not at install or link.
- A server code redeemed on 0.2.9 gives **30 days** of AI. They start with
  the first ✦ translation after the code is on the account. A code redeemed
  during the 7 days starts its 30 days when the 7 days end.
- A server code redeemed on 0.2.8 or before keeps AI with no end, like a
  bought plan (`isKeptPromo` in the relay's `access.ts`).
- A plan bought before 0.2.9 (Automatic) includes AI with no end.
- An account that paid for AI before the price change keeps AI with no end
  (`acct.grandfather` in the relay).
- A subscription is $1.99 a month or $19.99 a year (`upgradeCopy.ts`).
- After a period, ⚡ gives up to 5 AI translations a day.

**The daily ceiling.** Every kind of AI access has a daily ceiling. The
number is never shown. When the relay answers `ai_paused`, Subline stops
sending until the relay's wait is over (the next UTC day). It shows one
notice, once a day: "Translation is paused until tomorrow." (`showPausedNotice`
in `index.tsx`).

**The relay cannot be reached.** Subline keeps the last state it knew until
the relay's pass expires (the relay sets it 7 days out). A network problem
never ends a period (`planState.ts`).

### The ✦ button

The ✦ button in the message box shows the plan state, in every state
(`SparkButton` in `index.tsx`).

- On: a moving colour gradient with a glow. With "reduce motion", the colours
  stay and the glow is still.
- Off: the same ✦, grey. The size is always the same. There is no text and no
  number on it.
- A click opens the plan panel. If the account is not linked, it starts the
  link instead.

Its hover text comes from `PLAN_COPY` in `upgradeCopy.ts`, picked by
`planState.ts`:

| State | Hover text |
|---|---|
| Subscribed, bought before 0.2.9, or a server code from before 0.2.9 | AI translation on |
| A running period | AI translation on · 2 days left (1 day left on the last day) |
| Not started yet | AI translation on · 7 days from your first translation (30 for a server code) |
| Off | Translation is off · Subscribe to turn it on |
| A payment on its way | Payment on its way |
| Not linked | Link your Discord account to use Subline |

A period that ends while Discord is open turns the button grey at its end
time. No relay answer is needed for that.

Some channels have no message box, because you cannot type there. You can
also hide the button. In both cases, the ⚡ label and Subline → Settings show
the same state.

### The plan panel and the one-time messages

The plan panel shows the state, the two prices ($1.99 a month, $19.99 a year)
and **Enter a code**. "Enter a code" is there at every plan level. Every
purchase names the Discord account first. The checkout opens in your browser.

For each period there are only two messages, and each shows once per
computer and per Discord account (`planState.ts`, `checkPlanMessages`):

- The last day: a notice, "Your AI translation ends tomorrow.", with
  Subscribe and Later.
- The end: a panel, "Your 7 days of AI translation have ended. Subscribe to
  keep reading every message in your language.", with the two prices and
  Not now. It shows at the next channel switch or the next start. It never
  shows while you type.

On the first start of 0.2.9, one panel shows once, with a text that fits
the plan (`updateTextFor` in `planState.ts`, `PLAN_COPY.update` in
`upgradeCopy.ts`):

| Plan | Title | Text | What's new |
|---|---|---|---|
| Bought before 0.2.9, or paid for AI before the price change | Subline | Your plan now includes AI ✦ on everything, at no extra cost. | Yes |
| A server code redeemed on 0.2.8 or before | Subline | Every translation is AI ✦ now. | Yes |
| A server code redeemed on 0.2.9, not started yet | Subline | Your server code gives you 30 days of AI from your first translation. | Yes |
| A subscription | No panel | | |
| A new install, or no plan | Welcome to Subline | Your 7 days of AI translation start with the next message it translates. | No (OK only) |

"What's new" opens the public release notes.

There is never sales text under a message.

## How messages are translated

### Which channels

- Server channels are on by default. This is the **All servers** setting
  (`globalAuto`).
- DMs and group DMs are off until you turn one on.
- The 🌐 button in a message's hover toolbar turns translation on or off for
  that one channel. The globe is dimmed when the channel is off.
- For a linked account, the 🌐 choices and Subline's settings follow the
  Discord account to its other computers (`channelSync.ts`, `prefSync.ts`).

### When a message is sent

- **Only the channel you have open** translates live. A message in another
  channel waits until you open that channel. Popped-out windows do not count
  as open.
- **When you open a channel**, Subline translates up to 20 recent messages.
  This is the **Earlier messages** setting (`catchUpCount`). 0 turns it off.
  The count is of messages that need a request, so locally skipped messages
  do not use it up.
- **When you scroll up** and Discord loads older messages, they are
  translated the same way. They are not used as context for later messages.
- **When a message is edited**, the old line goes and the new text is
  translated. An update that does not change the text (a link preview, for
  example) sends nothing.

Live messages wait up to **3 seconds** and go out together, up to **25** in
one request (`QUALITY_DEBOUNCE_MS`, `QUALITY_MAX_BATCH` in `types.ts`).
Messages from opening a channel go out at once.

### What one request carries

See `BatchRequest` in `types.ts`.

- For each message: its text, its Discord message id and the author's
  username.
- For a reply: the id of the message it replies to. If that message is not in
  the same request, its author's username and its first 200 characters also
  go.
- Up to 8 earlier messages of the channel as context (username and text, no
  ids). ⚡ sends up to 6. Subline keeps the last 64 messages of the open
  channel in memory to pick these from.
- Your reading language.

Before sending, mentions become names (nickname, display name or username),
channel and role mentions become their names, and custom emoji are removed
(`discordMarkup.ts`, `customEmoji.ts`). Context lines are cut to 600
characters. The one exception is a ⚡ request while ✦ is off, for a message
up to 4,000 characters: there the relay cuts them. A message over 4,000 characters goes in
parts, and its line shows only when every part came back (`fitRequest.ts`).

A line of 6 or more words that is not a reply, and that ✦ already translated
in this session, is reused. Shorter lines are always read in context.

### What stays on your computer

`enqueue` in `index.tsx` checks two local rules first. A message that matches
is never sent by itself:

- Your own messages.
- Messages with nothing to translate: only emoji, mentions, links, digits or
  punctuation, or laughter (`hahaha`, `jajaja`, `kkkk`, `xd` and others). See
  `skip.ts`. A real word repeated many times is still sent.
- If your reading language is English: whole messages of English chat
  shorthand (`brb`, `idk`, `tbh` and others). Also messages that
  `detectLang.ts` is sure are English. This check is biased hard toward sending. Any doubt
  means the message goes to the relay. For other reading languages there is
  no local language check. The AI then answers that a message needs no
  translation.

Locally skipped messages still go as context for other messages.

### What you see under a message

| Line | Meaning |
|---|---|
| `✦ es · …` | The AI translation. Hover the prefix: "Translated by Subline · Spanish" |
| nothing | The message needs no translation, or the channel is off |
| `⏳ translating…` | No answer yet (no answer, a server error, a rate limit). Subline asks again by itself: after 15 seconds, then each wait doubles up to 2 minutes, and at once when the relay answers again |
| `⚠ not translated` | The AI left this message out twice. ⚡ asks again. An edit or a restart also asks again |

A line with no language label means the AI named no real language
(`langLabel.ts`). Line breaks in the translation show as line breaks.

### The ⚡ button

⚡ sits in the message's hover toolbar, next to 🌐. It asks for one message
now, and the request is forced: the AI must translate it, never skip it.

- **With ✦ on**, ⚡ is on every message, also one that already has a ✦ line.
  Its label says whether a press would send now. It also says the plan
  state. Example: "Translate with AI now (ready to send now) · AI translation
  on".
- **With ✦ off**, ⚡ uses one of the day's 5. The label is "Translate with AI
  (4 left today)". At 0 it is "No AI translations left today · Subscribe",
  and a press opens the plan panel. Each message text gets one ⚡ translation.
  An edit is new text. The line looks like any ✦ line. Subline keeps the
  newest 200 of these on this computer (`freePlan.ts`).
- **With nothing**, there is no ⚡.

While the request is out, the line shows `⚡ translating…`. If a message is
already in your reading language, the line says "✦ nothing to translate here".
If nothing came back, a short hint shows for 5 seconds and then goes: "⚡
cooling down", "⚡ rate limited" or "⚡ translation failed". A failed ⚡
translation with ✦ off says "The AI translation didn't load. Press ⚡ to try
again." An existing ✦ line stays on screen through all of this.

### Rate limits

The relay states a per-minute ceiling (`rpmLimit`) on every answer. A small
token bucket in front of every request (`rateGate.ts`) tunes itself to it.

- On a per-minute 429, Subline waits as long as the relay asked. It shows no
  message for this. The messages show `⏳` and are asked again after the wait.
- On "daily limit reached" or "monthly limit reached", one note per session
  says when ✦ is back.
- The daily ceiling (`ai_paused`) has its own notice. See "Plans and access".

Profiles, embeds and names get a request slot only when no message request
is out or waiting. Messages always come first.

## Codes and fancy text, decoded locally

Some messages are written fully in a code: Morse, 8-bit binary, grade 1
Braille, Base64, ROT13 or spaced letter emoji (🇭 🇪 🇾). Such a message gets
a line like `decoded · morse · HAPPY BIRTHDAY` (`decode.ts`). This runs on your computer
with no network. If the decoded text is in another language, the decoded
text (not the code) is translated, and that line shows under the decoded one.

The rules are strict. "...", "ok.", links, code blocks, hashes, tokens and
country flags (🇯🇵) never decode. Morse and binary can also be found inside a
message, as runs of at least three codes. A reply bar that quotes such a
message shows it decoded in place, with the original on hover.

Decoded lines show only in channels that are on, and only while the account
has ✦ or ⚡ (any level except "Nothing").

Fancy fonts (𝓱𝓸𝓵𝓪, ｈｏｌａ, ⓗⓞⓛⓐ, ʜᴏʟᴀ), upside-down text and Zalgo marks
become plain letters before the local checks and before sending
(`normalize.ts`). Real accents and other scripts' marks are kept. Code, links
and Discord markup stay as written.

## Profiles, embeds and more

While ✦ is on, Subline also translates text around messages
(`surfaces/`). The setting is **Profiles, embeds and more**
(`translateSurfaces`), on by default.

- Bios and custom statuses of other people, wherever Discord shows them.
  Your own bio is never sent.
- Embeds, polls and forwarded messages, in channels that are on.
- Channel topics, thread and forum titles, forum tags, stage topics, voice
  channel descriptions and statuses, events and guidelines.
- Server rules and onboarding questions.
- Reply quotes reuse an existing translation where there is one.

A request for these carries only the texts and your reading language. It has
no username, no ids and no context. Each text is translated once and kept for
up to 30 days, at most 2,000 texts (`surfaces/cache.ts`). These texts have
their own daily allowance of 500 units, counted on this computer
(`surfaces/budget.ts`). Nothing in this section is sent while ✦ is off.

## Names and pronouns

While ✦ is on, Subline also translates display names, nicknames, usernames
and pronouns (`surfaces/names.ts`). The setting is **Names and pronouns**
(`translateNames`), on by default.

- A name is sent only when you rest the pointer on it, or open that person's
  profile card.
- Only a name in a script your reading language does not use is sent. A name
  in your own script is never sent by itself.
- A name in a script that no reading language uses (runes, for example) is
  sent only when you press ✦ on it.
- Pronouns follow the profile text rule.

These use the same cache and allowance as profiles and embeds.

## Settings

The page is **Subline → Settings** in Discord's settings sidebar. Its text is
in `settingsCopy.ts`.

| Setting | Key | Default |
|---|---|---|
| Reading language | `targetLang` | Your Discord language (`pt-BR` becomes `pt`) |
| Earlier messages | `catchUpCount` | 20 |
| All servers | `globalAuto` | On |
| Profiles, embeds and more | `translateSurfaces` | On |
| Names and pronouns | `translateNames` | On |
| Debug log | `debugLogging` | Off |

A change to the reading language takes effect at once. The channel on screen
is translated again.

Hidden settings hold the install id, the saved code and other state.
`engine` has one value, the relay. The old key fields (`anthropicApiKey`,
`geminiApiKey`, `groqApiKey`) and model fields stay hidden. Nothing reads
them to send a request: `native.ts` refuses every engine except the relay.

At the bottom of the page is the feedback box. Right-click a translated
message for **Report translation**. Both send only when you press Send, after
you see everything that goes (`feedback.ts`).

## Privacy

The full statement is the privacy page: https://subline.page/privacy/. This
summary describes what this code sends. If the two ever disagree, the code
and the privacy page must be fixed so they agree.

**Message text leaves this computer only for the relay.** The relay is
`relay.subline.page`, a compiled constant (`RELAY_URL` in `engines/relay.ts`),
not a setting. The relay checks the plan, then asks an AI service. The
privacy page names that service and what it receives.

- With ✦ on: the data in "What one request carries", for channels that are
  on. Also the profile, embed and name texts described above.
- With ✦ off: only the one message you press ⚡ on, with its context.
- With nothing: no message text.
- Version 0.2.9 never sends message text to Google or to any AI service
  directly.

**What every relay request carries** (`relayHeaders` in `engines/relay.ts`):

- your Subline code as the bearer, or your install id when there is no code;
- your install id;
- the Subline version;
- the app it runs in (the app's version, or the add-on and its version);
- the request format version (`3`) and the AI-only marker.

A translation request has no server id and no channel id. It has no Discord
user ids, except in one rare raw-text case (see the privacy page).

**Other relay calls**, none with message text:

| Call | When |
|---|---|
| `/v1/status` | At start, about every 24 hours, and at the other times on the privacy page |
| `/v1/link`, `/v1/link/poll` | When you link your Discord account |
| `/v1/move/start`, `/v1/move/finish` | When you move your plan to another Discord account |
| `/v1/redeem` | When you enter a server code |
| `/v1/checkout` | When you start a purchase. The payment page opens in your browser (Dodo Payments) |
| `/v1/channels` | For a linked account: your 🌐 choices, as salted hashes of channel ids |
| `/v1/prefs` | For a linked account: the settings in the table above |
| `/v1/patch-health` | Once per Discord session, only when a part of Subline did not attach to Discord |
| `/v1/event` | At most once per session each: a step of the link or price flow, by name only |
| `/v1/feedback` | Only when you press Send in the feedback box |

**In the Discord app only**, Subline also downloads the public release file
from GitHub (`helperKick.ts`). The address is
`https://github.com/subline-page/subline/releases/latest/download/subline-release.json`.
It does this one minute after start, then every 5 minutes while Discord is
open. It sends no install id and no code. If a newer build is
out, it tells the background helper to update now.

**On this computer**, in Discord's storage (IndexedDB, through Vencord's
`DataStore`):

- Translations: the newest 2,000, with message id, language and translated
  text (`store.ts`). They stay after a restart and can outlive a deleted
  message. "Translating" and "not translated" markers are not saved.
- The profile and embed cache, with the original texts (`surfaces/cache.ts`).
- ⚡ translations made while ✦ was off: the newest 200.
- The plan record, the 🌐 choices, settings, small markers (which one-time
  messages showed, cooldowns, the rate gate's learned limit).

None of this is encrypted. Anything that can read Discord's storage can read
it.

**The debug log** (off by default) prints message text to Discord's own
developer console. It sends nothing anywhere.

## Troubleshooting

**Nothing translates.**
1. Check that Subline is in Discord at all: Subline → Settings must be in the
   settings sidebar. A Discord update can remove the Vencord build; the
   Subline app repairs it.
2. Hover the ✦ button in the message box. It says the plan state. Grey means
   ✦ is off. "Link your Discord account to use Subline" means the link comes
   first.
3. Check that the channel is on. Server channels are on by default, unless
   **All servers** is off. DMs need the 🌐 button.
4. Live translation is only for the channel on screen. Other channels
   translate when you open them.
5. Check the local rules in "What stays on your computer".

**A line says `⏳ translating…` for a long time.** The relay did not answer.
Subline asks again by itself, more slowly each time, up to every 2 minutes.
Opening the channel again also asks again.

**A line says `⚠ not translated`.** The AI left the message out twice. Press
⚡ to ask again.

**A notice says "Translation is paused until tomorrow."** The daily ceiling is
reached. Translation starts again on the next UTC day.

**An old channel's backlog does not translate when you open it.** Subline
reads the channel id from Discord's `LOAD_MESSAGES_SUCCESS` event, as
`channelId` or `channel_id`. If neither is there, the console shows a warning
tagged `VcTranslate` that lists the payload's keys. Please report it.

**Find out why one message has no line.** Turn on **Debug log**. Open
Discord's developer console (Ctrl+Shift+I, or Cmd+Option+I on a Mac). Filter
for `VcTranslate`. The log includes message text and stays on your
computer. For each message id:

- `[enqueue]`: queued, reused, or skipped by which local rule (`shouldSkip`
  or `isConfidentlyTargetLanguage`).
- `[catchUp]`: how many messages a channel open or scroll queued.
- `[flush]`: held, cooling down, waited for the rate gate, split, or sent.
- `[response]`: a translation, a skip or a failure for each id.
- `[write]`: whether the result was stored.
- `[force-quality]`: whether a ⚡ press was taken, and what stopped it.

With the setting off, none of these strings is built.

## For developers

### The stored state of a message

`store.ts` keeps one entry per message id and reading language
(`StoredTranslation`):

| State | Meaning | Shown as | Asked again? |
|---|---|---|---|
| `{ lang, text, via }` | A translation. `via` is `relay` | `✦` line | No. ⚡ or an edit asks again |
| `{ lang, text, via, same: true }` | ⚡ found the message already in your language | "✦ nothing to translate here" | No |
| `{ skipped: true, via }` | The AI said it needs no translation | Nothing | No |
| `{ deferred: true }` | No answer yet | `⏳ translating…` | Yes, by itself |
| `{ failed: true }` | The AI left it out twice | `⚠ not translated` | On ⚡, an edit or a restart |

`deferred` and `failed` are never saved to disk. A saved entry from an engine
this build does not know (`google`, the old short-message judge) is dropped on
load. A marker never replaces a real translation (`mayReplace` in
`upgrade.ts`).

Each message gets one automatic request per verdict in a session
(`qualityAttempted` in `index.tsx`). A request that got no verdict gives its
charge back, so the message is asked again.

### Tests

```bash
cd src/userplugins/vcTranslate && npx vitest run
```

Run it from this folder. `vitest.config.ts` is here and maps Vencord's
imports (`@api/*`, `@utils/*`, `@webpack/common`) to the stand-ins in
`tests/stubs/`. From the repo root, vitest does not find the config. Some
files then fail to import. The summary counts fewer tests, but it still
looks like a pass. `vitest` is not saved as a dependency here. In a fresh clone,
install it first (`npm i -D vitest`).

The `tests/` folder is in the development repository. The public source
export leaves it out (`scripts/sourceExport.mjs`).

The tests cover the code against stand-ins for Discord. They cannot show that
Discord's real events have the shapes the code expects, or that the real
network calls work. The checklist below is for that.

### Manual checklist (0.2.9)

Nothing in this table is a record of results. Work through it in a real
Discord with a build of this folder, on a Mac and on Windows where it
applies.

| # | Do this | Expected | Pass |
|---|---|---|---|
| 1 | With ✦ on, post a message in another language in a channel that is on | A `✦` line shows within a few seconds. No `≈` line ever shows | ☐ |
| 2 | Post a message already in your reading language, then reopen the channel | No line either time. Reopening sends nothing for it | ☐ |
| 3 | Post an emoji-only message, a link-only message, and one of your own | No line, no request | ☐ |
| 4 | Post 3 or 4 messages quickly | They go out as one request within about 3 seconds | ☐ |
| 5 | Edit a translated message | The line changes to match the new text | ☐ |
| 6 | Post a message with a link and let the preview load | No second request for that message | ☐ |
| 7 | Sit in channel A while someone posts in channel B | Nothing is sent for B until you open it. Then B's recent messages translate | ☐ |
| 8 | Open a channel not visited this session | Its backlog translates without a second click | ☐ |
| 9 | Scroll far up | Older messages translate. A live message after that still gets correct context | ☐ |
| 10 | Turn a channel off with 🌐 | Its lines go. The globe is dimmed | ☐ |
| 11 | Restart Discord and reopen a translated channel | Lines show at once, with no new requests | ☐ |
| 12 | Hover ✦ in each state: subscribed, running period, not started, off, payment on its way, not linked | Each hover text matches the table in "The ✦ button". Colour when on, grey when off. Same size | ☐ |
| 13 | Let a period end while Discord is open | ✦ turns grey at the end. The ended panel shows once at the next channel switch, never while typing | ☐ |
| 14 | Let a period end while Discord is closed | The ended panel shows once at the next start | ☐ |
| 15 | On the last day of a period | "Your AI translation ends tomorrow." shows once, with Subscribe and Later | ☐ |
| 16 | First start after updating to 0.2.9 | The update panel shows once, with the text for your plan | ☐ |
| 17 | With ✦ off, press ⚡ on 5 messages | Each gives a ✦ line with no sales link. The label counts down. At 0 it says "No AI translations left today · Subscribe" | ☐ |
| 18 | With ✦ on, press ⚡ on a message that already has a ✦ line | A new forced request goes out. The old line stays until the answer lands | ☐ |
| 19 | Disconnect the network, then post a message | `⏳ translating…` shows. No red error. The plan state stays as it was | ☐ |
| 20 | Reconnect | The `⏳` lines turn into `✦` lines by themselves | ☐ |
| 21 | Reach the daily ceiling (on a test account) | One notice: "Translation is paused until tomorrow." No number anywhere | ☐ |
| 22 | Open a channel where you cannot type | No ✦ button. The ⚡ label and Subline → Settings show the state | ☐ |
| 23 | Hide the ✦ button (Vencord's right-click hide) | ⚡, Settings and the one-time panels still work | ☐ |
| 24 | Two Discord accounts on one computer | Each has its own state, panels and periods | ☐ |
| 25 | Subscribe from the ended panel | ✦ turns colour when the payment lands, with no restart | ☐ |
| 26 | Hover a name in another script, and open a profile card with a bio | The name's translation shows on hover. The bio shows translated in place, with a toggle | ☐ |
| 27 | Post `.... . .-.. .-.. ---` | A `decoded · morse · HELLO` line shows | ☐ |
| 28 | Repeat 1, 12, 17 and 26 in the browser add-on | The same results | ☐ |
