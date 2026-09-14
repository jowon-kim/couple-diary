# Setting it up without writing code

This guide is for someone who has never used a terminal. Everything happens in a
web browser, on a computer. It takes about 5 minutes, and nothing costs money.

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
- **About 5 minutes**

You do not need a credit card. Both services are free at this size, and if a
limit is ever reached they stop rather than bill you.

---

## 1. Pick a password

This is the one password the two of you will type to get in. **Anyone who finds
the address sees the sign-in screen**, so make it long — 12 characters or more.
A short sentence works well: `pancakes on sunday morning`.

That is the only thing you have to come up with. The app makes its own keys and
its own tables the first time it runs.

## 2. Deploy

Click this button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjowon-kim%2Fcouple-diary&project-name=couple-diary&repository-name=couple-diary&env=DIARY_PASSWORD&envDescription=The%20one%20password%20the%20two%20of%20you%20will%20type%20to%20get%20in.%20Make%20it%2012%20characters%20or%20more.&envLink=https%3A%2F%2Fgithub.com%2Fjowon-kim%2Fcouple-diary%2Fblob%2Fmain%2Fdocs%2FGUIDE.md%231-pick-a-password&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Vercel walks you through a few screens. The labels change now and then, but the
order is:

1. **Your copy on GitHub.** Vercel makes a private copy of the app in your GitHub
   account. Keep the suggested name, or pick your own — it becomes part of your
   address
2. **A database.** Vercel offers to create a **Neon** database. Accept it, pick
   the **free** plan, and choose the region closest to you. This is where your
   events are stored
3. **One box, `DIARY_PASSWORD`.** Type your password from step 1
4. Press **Deploy** and wait a minute for the confetti

When it's done, Vercel shows your address.

> **If Vercel didn't offer a database,** open your project on vercel.com, go to
> the **Storage** tab, choose **Neon** (under Marketplace), create a free
> database and connect it to this project. Then go to **Deployments**, open the
> **⋯** menu on the newest one and choose **Redeploy**. The sign-in screen tells
> you if this is what's missing.

## 3. Open it

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

## 4. Turn on notifications — both of you, on each phone

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

## 5. Optional: reminders on the morning of the day

Change notifications work without this. This step adds reminders on the day of
an event: **30 minutes before** anything starting before 8am, and **one summary
at 8am** for everything else. Both of you get these.

The app can't wake itself up on the free plan, so a free outside service knocks
on its door every few minutes in the early morning.

1. Sign up at [cron-job.org](https://cron-job.org) (free)
2. Create a new **cron job**
3. **URL** — in the app, open **Settings** → **Reminders on the day** and copy the
   address shown there. It ends in `/api/cron?key=` and a long key the app made
   for itself. Keep it between the two of you
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

**"No database is connected yet"** — the Neon step was skipped. See the box at
the end of [step 2](#2-deploy).

**The first load of the day is slow** — normal. The free database naps after five
quiet minutes and takes a second or two to wake.

**The notification button does nothing on iPhone** — you're in a Safari tab.
Open the app from the home-screen icon instead.

**Notifications worked, then stopped** — iPhones sometimes drop them quietly.
Open the app; it usually fixes itself. If not, Settings → turn notifications off
and on again.

**Change notifications arrive, but the morning reminder doesn't** — look at the
job's history on cron-job.org. If it shows an error, copy the address from the
app's settings again and check that the time zone matches the app's.

## Changing a setting later

To change the password — on vercel.com: your project → **Settings** →
**Environment Variables** → edit `DIARY_PASSWORD`, then go to **Deployments** →
**⋯** on the newest one → **Redeploy**. **Changes only take effect after a
redeploy**, and both of you sign in again with the new one.

## Never do these

- **Don't touch the `app_meta` table** in Neon. It holds the keys the app made
  for itself. Delete them and every phone's notifications die, both of you get
  signed out, and the reminder address changes
- **Don't delete tables or run other SQL** in Neon. There is no undo, and the free
  plan can only restore the last six hours
- **Don't raise the database size** in Neon above the smallest setting (0.25). It
  burns through the free allowance faster
- **Don't run the cron job all day** (see step 5)

## Backing up

Now and then, open the Neon **SQL Editor**, run `select * from events`, and
download the result. The free plan does not keep long-term backups for you.

## Photos, names and other personal touches

Names, greeting, app name, theme, the day you met and calendar photos are all in
**Settings** — no code needed. Changing the pictures (the login image, the icon)
means replacing files in your GitHub copy; the [README](../README.md#making-it-yours)
lists which ones.
