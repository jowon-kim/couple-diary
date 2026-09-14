# Setting it up without writing code

This guide is for someone who has never used a terminal. Everything happens in a
web browser, on a computer. It takes about 20 minutes, and nothing costs money.

If you already use a coding agent like Claude Code, the
[README](../README.md#install) has a faster way.

## What you end up with

A private calendar at an address like `https://couple-diary-abc.vercel.app`.
You both open it on your phones, sign in with one shared password, and when one
of you adds something, the other's phone buzzes.

## What you need

- **A computer with Chrome, Edge or Firefox.** Phones are fine for *using* the
  calendar, but set it up on a computer
- **A GitHub account** — [github.com/signup](https://github.com/signup). This is
  where your copy of the app is kept
- **A Vercel account** — [vercel.com/signup](https://vercel.com/signup). Choose
  **Hobby** and **Continue with GitHub**. This is what runs the app
- **About 20 minutes**

You do not need a credit card. Both services are free at this size, and if a
limit is ever reached they stop rather than bill you.

---

## 1. Pick a password

This is the one password the two of you will type to get in. **Anyone who finds
the address sees the sign-in screen**, so make it long — 12 characters or more.
A short sentence works well: `pancakes on sunday morning`.

Write it down somewhere. You will paste it in step 3.

## 2. Make your keys

The app needs four random keys: two that keep you signed in and let the morning
reminder in, and two that sign the notifications sent to your phones. You make
them once, in your browser.

1. Open a new, empty tab
2. Open the **console**:
   - Windows: press `Ctrl` + `Shift` + `J` (Chrome/Edge) or `Ctrl` + `Shift` + `K` (Firefox)
   - Mac: press `Cmd` + `Option` + `J` (Chrome) or `Cmd` + `Option` + `K` (Firefox)
3. Copy the whole box below, paste it into the console, and press `Enter`

```js
(async () => {
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = () => [...crypto.getRandomValues(new Uint8Array(24))]
    .map((n) => n.toString(16).padStart(2, '0')).join('');
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
  console.log([
    'DIARY_SECRET       ' + random(),
    'CRON_SECRET        ' + random(),
    'VAPID_PUBLIC_KEY   ' + pub,
    'VAPID_PRIVATE_KEY  ' + priv,
  ].join('\n'));
})();
```

> **The browser may refuse to paste** and ask you to type something like
> `allow pasting` first. That is a normal safety warning — type what it asks,
> press `Enter`, then paste again.

You get four lines like this (yours will be different):

```
DIARY_SECRET       56043c76d496c3d1c972cc817c6aedb75f199962104ee2d2
CRON_SECRET        a01a28e8bee7b8263d69f48973062f935cdedbd10a4b5bb0
VAPID_PUBLIC_KEY   BLpAtGPB89rVjhZ9F_bltcnElKtjXLr84rjXXGlUMVX9oKpobknffO912eY_I1vbt6_yzWBLDoOw9ti1zSryE_A
VAPID_PRIVATE_KEY  7tWOJkMI3yPmlxzwsAAp6Eo1M5Hv7EGAFpsTfLleMpY
```

**Copy all four lines into a note and keep it private.** The code runs only in
your own tab; nothing is sent anywhere. Do not make new keys later — see
[Never do these](#never-do-these).

## 3. Deploy

Click this button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjowon-kim%2Fcouple-diary&project-name=couple-diary&repository-name=couple-diary&env=DIARY_PASSWORD%2CDIARY_SECRET%2CCRON_SECRET%2CVAPID_PUBLIC_KEY%2CVAPID_PRIVATE_KEY&envDescription=A%20password%20for%20the%20two%20of%20you%2C%20plus%20four%20keys%20you%20make%20in%20your%20browser%20%28step%202%20of%20the%20guide%29.&envLink=https%3A%2F%2Fgithub.com%2Fjowon-kim%2Fcouple-diary%2Fblob%2Fmain%2Fdocs%2FGUIDE.md%232-make-your-keys&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Vercel walks you through a few screens. The labels change now and then, but the
order is:

1. **Your copy on GitHub.** Vercel makes a private copy of the app in your GitHub
   account. Keep the suggested name, or pick your own — it becomes part of your
   address
2. **A database.** Vercel offers to create a **Neon** database. Accept it, pick
   the **free** plan, and choose the region closest to you. This is where your
   events are stored
3. **Environment variables.** Five boxes. Fill them in:

   | Box | What to put in |
   |---|---|
   | `DIARY_PASSWORD` | your password from step 1 |
   | `DIARY_SECRET` | the `DIARY_SECRET` line from step 2 (just the value) |
   | `CRON_SECRET` | the `CRON_SECRET` value |
   | `VAPID_PUBLIC_KEY` | the `VAPID_PUBLIC_KEY` value |
   | `VAPID_PRIVATE_KEY` | the `VAPID_PRIVATE_KEY` value |

   Paste only the long value, not the name in front of it, and no spaces
4. Press **Deploy** and wait a minute for the confetti

When it's done, Vercel shows your address. **Don't open the calendar yet** — it
needs one more thing.

> **If Vercel didn't offer a database,** open your project on vercel.com, go to
> the **Storage** tab, choose **Neon** (under Marketplace), create a free
> database and connect it to this project. Then go to **Deployments**, open the
> **⋯** menu on the newest one and choose **Redeploy**.

## 4. Create the tables

The database starts empty. You give it its shape by running one file.

1. Open [schema.sql](../schema.sql) on GitHub and copy everything in it. There is
   a **copy** button at the top right of the file
2. On vercel.com, open your project → **Storage** → your Neon database →
   **Open in Neon**
3. In Neon, find the **SQL Editor** in the left menu
4. Paste, then press **Run**

It should finish without a red error. **Running it twice is harmless**, so if
you're not sure it worked, run it again.

## 5. Open it

Open your address. Sign in with your password.

Then open **Settings**:

- **The two of you** — put in both names. Under **Which one am I**, pick
  yourself. This choice lives on this device only, so your partner picks
  themselves on their own phone
- **Time zone** — filled in from your browser. Check that it's right; it decides
  when the morning reminder goes out
- **Language**, **Holidays**, **Theme**, **The day you met** — whatever you like.
  There is no save button; it saves as you type

Send your partner **the address and the password**.

## 6. Turn on notifications — both of you, on each phone

**iPhone:** open the address in **Safari** → tap **Share** → **Add to Home
Screen** → open the app **from that new icon** → Settings → **Phone
notifications** → **Turn on notifications**. (iOS 16.4 or later.) In an ordinary
Safari tab the button does nothing — that's Apple's rule, not a bug.

**Android:** open the address in Chrome → Settings → **Phone notifications** →
**Turn on notifications**. Adding it to the home screen is nice but optional.

To test it: one of you adds an event, the other one's phone should buzz. **You
never get notified about your own changes**, so test it with two phones.

**You're done.** The steps below are optional.

---

## 7. Optional: reminders on the morning of the day

Change notifications work without this. This step adds reminders on the day of
an event: **30 minutes before** anything starting before 8am, and **one summary
at 8am** for everything else. Both of you get these.

The app can't wake itself up on the free plan, so a free outside service knocks
on its door every few minutes in the early morning.

1. Sign up at [cron-job.org](https://cron-job.org) (free)
2. Create a new **cron job**
3. **URL** — your address, then `/api/cron?key=`, then your `CRON_SECRET` value:

   ```
   https://couple-diary-abc.vercel.app/api/cron?key=a01a28e8bee7b8263d69f48973062f935cdedbd10a4b5bb0
   ```

4. **Schedule** — choose the custom/advanced option and set:
   - **Minutes:** every 5 minutes
   - **Hours:** 4, 5, 6, 7, 8 only
   - **Every day, every month**
5. **Time zone** — the same one shown in the app's settings
6. Save. After the next morning, the job's history should show successful runs
   (status 200)

**Keep the hours to 4–8am.** Knocking all day keeps the free database awake and
uses up its monthly allowance. The 8am summary already covers the rest of the
day.

---

## When something is off

**"That password doesn't match"** — the password is exactly what you typed into
`DIARY_PASSWORD`, including spaces and capital letters. To change it, see
[Changing a setting later](#changing-a-setting-later).

**The calendar shows an error or won't load events** — step 4 was probably
skipped. Run `schema.sql` in the Neon SQL Editor (it is safe to run again).

**The first load of the day is slow** — normal. The free database naps after five
quiet minutes and takes a second or two to wake.

**The notification button does nothing on iPhone** — you're in a Safari tab.
Open the app from the home-screen icon instead.

**Notifications worked, then stopped** — iPhones sometimes drop them quietly.
Open the app; it usually fixes itself. If not, Settings → turn notifications off
and on again.

**Change notifications arrive, but the morning reminder doesn't** — look at the
job's history on cron-job.org. If it shows an error, check that the URL contains
your exact `CRON_SECRET` and that the time zone matches the app's.

## Changing a setting later

On vercel.com: your project → **Settings** → **Environment Variables**. Edit the
value, then go to **Deployments** → **⋯** on the newest one → **Redeploy**.
**Changes only take effect after a redeploy.**

## Never do these

- **Don't make new `VAPID_` keys** once it is running. Every phone's
  notifications die and both of you have to turn them on again
- **Don't change `DIARY_SECRET`.** Both of you get signed out
- **Don't delete tables or run other SQL** in Neon. There is no undo, and the free
  plan can only restore the last six hours
- **Don't raise the database size** in Neon above the smallest setting (0.25). It
  burns through the free allowance faster
- **Don't run the cron job all day** (see step 7)

## Backing up

Now and then, open the Neon **SQL Editor**, run `select * from events`, and
download the result. The free plan does not keep long-term backups for you.

## Photos, names and other personal touches

Names, greeting, app name, theme, the day you met and calendar photos are all in
**Settings** — no code needed. Changing the pictures (the login image, the icon)
means replacing files in your GitHub copy; the [README](../README.md#making-it-yours)
lists which ones.
