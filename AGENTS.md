# AGENTS.md

Instructions for an agent meeting this repository for the first time. When the
user says **"how do I use this?"**, follow [First install](#first-install).

## What this is

A calendar two people share. Add an event and it lands on the other person's
lock screen.

- **No build step.** No bundler, no framework. `public/` is served as-is
- **Two runtime dependencies** — `@neondatabase/serverless`, `web-push`
- Vercel serverless functions + Neon Postgres, entirely within the free tiers
- Ships in English and Korean. Code comments are Korean in the app internals and
  English wherever a contributor arrives (`public/i18n/`, `public/holidays/`,
  setup scripts)

## Ask the user two things

Only two. Decide everything else yourself.

1. **The password they will share** — recommend 12 characters or more. Anyone
   with the URL reaches the login screen
2. **A project name** — it becomes the Vercel address

## What the user has to do themselves

These two are the only things you cannot do.

- **`vercel login`** — opens a browser. Ask them to sign in
- **Add to Home Screen on iPhone** — required before notifications can be turned
  on (see below)

Everything else happens in the terminal.

## First install

```bash
npm install
npx vercel login                      # the user, in a browser
npx vercel link --yes
npx vercel integration add neon       # puts DATABASE_URL on the project
```

If a command name doesn't match, check `npx vercel integration --help`. The
Vercel CLI changes.

Make a VAPID key pair. These sign the phone notifications.

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set four environment variables (`npx vercel env add <NAME> production`).

| Name | Value |
|---|---|
| `DIARY_PASSWORD` | the password the user chose |
| `DIARY_SECRET` | any long random string. You can generate it |
| `VAPID_PUBLIC_KEY` | the public key from above (87 characters) |
| `VAPID_PRIVATE_KEY` | the private key from above (43 characters) |

Do **not** set `DATABASE_URL`. The Neon integration provides it.

```bash
npx vercel env pull .env.local        # brings those values down locally
npm run schema                        # creates the tables. Safe to re-run
npm run verify                        # fix things until every line is a ✓
npx vercel deploy --prod
```

Finish by giving the user **the URL and the password**, and tell them that on
iPhone they must add it to the home screen before notifications will turn on.

## Never do these

- **Never regenerate the VAPID keys on an install that is already running.**
  Every device that had notifications on goes dead, and both people have to turn
  them back on in settings
- **Never change `DIARY_SECRET`.** Login tokens derive from it. Both people get
  signed out
- **Never run `drop table` or `drop column`.** There is no undo. The Neon free
  plan gives only a six-hour restore window
- **Never raise the Neon compute above 0.25 CU.** It burns the free allowance
  that much faster

## How to check your work

| Command | What | If it fails |
|---|---|---|
| `npm test` | 109 handler tests against an in-memory Postgres, using the real handlers | If you changed code, it has to pass |
| `npm run verify` | environment variables, database, tables | Each ✗ prints the fix. Exits 1 |
| `npm run i18n` | how complete each language pack is | A missing key falls back to English rather than breaking |

**Notifications cannot be checked automatically.** Ask the user to try it on
their phone.

## When notifications don't arrive

It is nearly always one of these three.

1. **iPhone, tried from a Safari tab** — only works from an app added to the
   home screen (iOS 16.4+). The button appears to do nothing
2. **Your own change doesn't notify you** — that's the design. Only the other
   person hears about it
3. **It worked and then went quiet** — a known trait of iOS web push. The app
   re-subscribes on open when it notices the subscription is gone; if that isn't
   enough, toggle notifications off and on in settings

## Changing the code

- **Screen** — `public/app.js` · `index.html` · `style.css`. Served as-is
- **Server** — `api/` holds thin handlers; every SQL statement lives in
  `lib/store.js`
- **Wording** — never write a user-visible string inline. Add a key to
  `public/i18n/en.js` and `ko.js`, then use `t('key')` on the screen or
  `t(locale, 'key')` on the server. `npm run i18n` catches a pack that fell behind
- Run `npm test` after any change

## Customizations users ask for

**No code needed** — app name, greeting, both names, the day they met, language,
holidays, theme, calendar photos. All of it is in the app's **settings** screen.
Point them there first.

**Swap a file**

| File | Where it shows up |
|---|---|
| `public/mascot.png` | the big image on the login screen |
| `public/favicon.png` | browser tab and notification icon |
| `public/badge.png` | the status-bar icon on Android |

`badge.png`: **Android uses only the alpha channel.** The system paints the
color — grey on a light status bar, white on a dark one. A color photo turns
into a smudge. Export at 96px, white on transparent.

**Needs a code change**

- **A new theme** — copy a `[data-theme="..."]` block in `style.css`, change the
  values, add the id to `THEMES` in `app.js`, and add a `theme.<id>` key to the
  language packs. **Three places**
- **A new language** — copy `public/i18n/en.js`, translate the values, add a
  `<script>` in `index.html`, add the tag to `LOCALE_NAMES` in `i18n/index.js`,
  and add an import in `lib/i18n.js` so notifications get it too
- **Holidays for another country** — copy `public/holidays/kr.js`, keep the
  shape, register it under a short code, load it in `index.html`, and add
  `region.<code>` plus the holiday names to the language packs
- **The label under the home-screen icon** — `public/manifest.json`. It does not
  follow the setting
