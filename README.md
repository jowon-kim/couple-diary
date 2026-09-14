# Couple Diary

**English** · [한국어](README.ko.md)

A shared calendar for two people. When one of you adds something, it shows up on
the other's lock screen, and on the morning of the day it speaks up again. No
KakaoTalk, no Slack, no third party — this app sends the push itself.

<!-- Put a screenshot here: ![](docs/screenshot.png) -->

- **No build step.** No bundler, no framework. `public/` is served as-is
- **Two runtime dependencies** — `@neondatabase/serverless`, `web-push`
- **Fits entirely in free tiers** — Vercel Hobby + Neon Free. No credit card
- **iOS web push actually works**, including silent re-subscription when Safari
  drops it
- **Reminders on the day** — 30 minutes before an early start, or one summary at
  8am. In your own time zone
- **English and Korean**, with i18n that needs no library — a language pack is a
  plain object in one file
- Add to home screen and it opens like an app (PWA)

Roughly 5,400 lines across `api/`, `lib/` and `public/`, with 145 integration
tests that run against an in-memory Postgres.

## Install

### Never used a terminal?

Follow [**the step-by-step guide**](docs/GUIDE.md). It's all in the browser —
one Deploy button, a few copy-and-pastes, about 20 minutes.

### Let an agent do it (easiest)

Clone the repo, open a CLI coding agent in that folder — Claude Code, Codex,
whatever you use — and ask:

```
how do I use this?
```

[`AGENTS.md`](AGENTS.md) spells out the setup in a form agents can execute. You
pick a password; it handles the rest. The only thing you do by hand is one
browser login (`vercel login`).

### By hand

Five minutes if you already have the accounts. You don't need to sign up for
Neon separately — the Vercel integration creates the account for you.

```bash
npm install
npx vercel login
npx vercel link --yes
npx vercel integration add neon        # this sets DATABASE_URL

node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set four environment variables (`npx vercel env add <NAME> production`):

| Name | Value |
|---|---|
| `DIARY_PASSWORD` | the password the two of you share. **Make it long** |
| `DIARY_SECRET` | any long random string |
| `VAPID_PUBLIC_KEY` | the public key printed above |
| `VAPID_PRIVATE_KEY` | the private key printed above |

```bash
npx vercel env pull .env.local
npm run schema                         # creates the tables
npm run verify                         # every line should be a ✓
npx vercel deploy --prod
```

When `npm run verify` prints a ✗ it also prints the command that fixes it.

## Turning on notifications

**Settings → the two of you → pick your own card → phone notifications → allow.**
Once per device.

**On iPhone this only works from a home-screen app.** The button does nothing in
a Safari tab. Share → "Add to Home Screen" → open it from that icon, then allow.
(iOS 16.4+)

Android and desktop Chrome just work.

### Reminders on the day

Events also announce themselves on the day itself: **30 minutes before** anything
starting before 8am, and **one summary at 8am** for the rest. Both of you get
these. They need one more piece of setup — something outside has to knock on
`/api/cron` on a schedule, because Vercel's free cron only runs once a day with
an hour of slack. [`AGENTS.md`](AGENTS.md#reminders-on-the-day) walks through it,
and an agent can do the whole thing for you.

The time zone that decides "today" and "8am" lives in settings. The app fills it
in from your browser the first time you open it.

## Making it yours

**From the settings screen** — app name, greeting, both names, the day you met,
theme, calendar photos. No code involved. **There is no save button;** typing or
picking commits it.

**Files you can swap**

| File | Where it shows up |
|---|---|
| `public/mascot.png` | the big image on the login screen |
| `public/favicon.png` | browser tab · notification icon |
| `public/badge.png` | the status-bar icon on Android |

`badge.png` has one rule. **Android uses only the alpha channel** — it paints the
shape with its own color. A color photo turns into a smudge. Export it at 96px,
white on transparent.

**Things that need a code change**

- **A new theme** — copy a `[data-theme="..."]` block in `style.css`, change the
  values, add the id to the `THEMES` array in `app.js`, and add a `theme.<id>`
  key to the language packs. The swatch in the picker builds itself
- **The label under the home-screen icon** — `public/manifest.json`. It does not
  follow the setting

## Language

The app ships in English and Korean; **Language** in settings switches both
screens, since it is a shared setting. Dates, times and weekday names come from
`Intl`, so they follow the language without anyone writing them down.

A language pack is one file of plain key–value pairs — no library, no build:

```
public/i18n/en.js     the reference pack
public/i18n/ko.js
```

To add one, copy `en.js`, translate the values, add a `<script>` for it in
`index.html`, and add the tag to `LOCALE_NAMES` in `i18n/index.js`. Anything you
leave out falls back to English rather than showing blank. `npm run i18n` prints
how complete each pack is.

The server uses the same files, so push notifications arrive in the language the
calendar is set to.

## Holidays

**Holidays** in settings picks a country. Each one is a file that maps dates to
name keys:

```
public/holidays/none.js   the default
public/holidays/kr.js     South Korea, incl. lunar dates and substitute days
```

Only South Korea ships today. **Adding your own country is the most useful thing
you can contribute** — copy `kr.js`, keep the shape, register it under a short
code, load it in `index.html`, and add `region.<code>` plus the holiday names to
the language packs.

## Things worth knowing

- **The first request takes a second or two.** Neon sleeps after five idle
  minutes and wakes on the next query. That's the price of the free tier, and
  the reason it stays free
- **One password is the only wall.** Anyone with the URL reaches the login screen
- **You don't get notified about your own edits.** Only the other person does
- **iOS web push dies quietly sometimes.** The app re-subscribes on open when it
  notices the subscription is gone; if notifications still don't arrive, toggle
  them off and on in settings

Longer-term operational notes — free-tier limits, environment variables you must
not touch, things that rot over time — are in [`docs/RUNNING.md`](docs/RUNNING.md).

## Layout

```
api/                serverless functions (thin handlers)
lib/                store.js holds every SQL statement · push.js sends notifications
public/             the UI. served as-is, no build
public/i18n/        language packs
public/holidays/    holiday sets, one file per country
schema.sql          five tables
test.mjs            145 integration tests against the real handlers
```

```bash
npm test      # runs the real handlers against in-memory Postgres. No Neon account needed
npm run verify
```

## Contributing

Holiday sets and language packs are the most useful things you can send — both
are a single self-contained file. See the two sections above.

```bash
npm test        # 145 handler tests, no accounts needed
npm run i18n    # how complete each language pack is
```

## License

MIT. See [LICENSE](LICENSE).
