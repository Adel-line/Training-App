# Training

Private, phone-first training app for one person (snowboarding, splitboarding, general fitness).
Next.js + SQLite + Tailwind, installed on the phone's home screen as a PWA. It runs on your own computer;
there is no login, no Supabase and no Vercel. Access is limited by the private network (Tailscale).

Status: **milestone 2 of 8** done: local database, default plan, Today and Week screens. (Milestone 1: PWA shell.)

## Requirements

- Node.js **22.18 or newer** (uses the built-in `node:sqlite`; it prints an "experimental" notice, which is harmless).
- A free [Tailscale](https://tailscale.com) account with the app on both your computer and your phone.

## Run it

```bash
npm install
cp .env.example .env.local     # all values are optional for now
npm run build
npm start                      # http://localhost:3000
```

The first start creates the database and loads the default plan once (`seed/seed.sql`). `npm run seed` re-adds any
missing default rows later; it never overwrites your edits. Data lives in `data/training.db` (override with `DB_PATH`). Schema changes are SQL files in `migrations/`, applied
automatically on start. **Back up by copying that one file** while the app is idle.

## Open it on your phone (Tailscale)

A home-screen app needs an https address, and Tailscale provides one privately, only for your own devices:

1. Install Tailscale on the computer and the phone, signed in to the same account.
2. In the Tailscale admin console, enable **MagicDNS** and **HTTPS Certificates** (DNS page).
3. On the computer, with the app running: `tailscale serve --bg 3000`.
   It prints an address like `https://your-computer.your-tailnet.ts.net`.
4. On the phone (Tailscale on), open that address, then Share / ⋮ → **Add to Home Screen**.

Because only your devices are on your tailnet, no login is needed. **Don't use a public tunnel or Tailscale Funnel
for the app itself**, since it has no password. (Strava's webhook in milestone 4 will get a narrowly scoped public
route; we'll cover that then.)

The computer must be on to open pages or sync. Workout logging (milestone 3) keeps data on the phone and syncs later.

## Develop

```bash
npm run dev          # service worker is off in dev
npm run lint && npm run typecheck && npm test
CHROMIUM_PATH=/path/to/chrome npm run e2e   # Playwright; needs `npx playwright install chromium` if CHROMIUM_PATH is unset
```

`CHROMIUM_PATH=... npm run icons` regenerates `public/icons`.

## PWA and offline

The service worker (`src/app/sw.ts`, served at `/serwist/sw.js`) precaches static assets and a generic `/~offline`
page. Page HTML and data are never cached; offline workout data will be stored in IndexedDB (milestone 3).
Test PWA behaviour on a production build.

## Environment variables (`.env.example`)

| Name | Purpose | Needed from |
|---|---|---|
| `DB_PATH` | SQLite file location (default `data/training.db`) | optional |
| `APP_URL` | Public/Tailscale origin, used for Strava OAuth callbacks | M4 |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN` | Strava app registration (secret is server-only) | M4 |
| `ANTHROPIC_API_KEY` | Optional meal-photo analysis, server-only | M8 |

Dates for plans, meals, weigh-ins and activity matching use `Europe/Copenhagen` (`src/lib/dates.ts`).
