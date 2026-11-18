# Training

Private, phone-first training app for one person (snowboarding, splitboarding, general fitness).
Next.js + SQLite + Tailwind, installed on the phone's home screen as a PWA. It runs on your own computer;
there is no login, no Supabase and no Vercel. Access is limited by the private network (Tailscale).

Status: **milestone 4 of 8** done: Strava import. (M1: PWA shell, M2: database, plan, Today/Week, M3: workout logger.)

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

## Logging workouts (offline-first)

Open a strength day from Today or Week and tap **Start workout**. Every tap is written to the phone's own database
(IndexedDB) first, then sent to the server in order:

- The sync badge shows **Saved on device** (waiting to send), **Synced**, or **Needs attention** (the server refused a
  change: tap it to Retry or Discard; the entry stays on your phone until you decide).
- Sets have fixed IDs built from their position (exercise slot, set number, side), and every edit carries an increasing
  sequence number. Retries can't duplicate a set, and an older queued edit can never overwrite a newer one (the server
  keeps the last sequence it applied per set, including deletions).
- A workout opened once while online reopens offline with its exercises, last time's sets and your unlogged inputs. If
  the app opens offline it shows **Resume workout** on the offline page.
- Sync retries when the app opens, comes to the foreground, or connectivity returns, and with backoff after server errors.
- Swapping an exercise only changes that workout; the template is edited in Settings (milestone 7).
- RIR is never carried from one set to the next; weight and reps are (starting from last time's sets).

The sync endpoints have no login, so they require a JSON content type, which other websites can't send cross-origin.

## Strava

Strava is the only activity source (your Garmin already syncs to it). The app imports Run, TrailRun, Hike and
Snowboard activities, keeps them in the local database, and matches them to the plan on the Week screen by **date
and type only** (it doesn't judge intervals or intensity). Only Run and TrailRun feed the running charts.

### Setup

1. Register an app at <https://www.strava.com/settings/api>. **Authorization Callback Domain**: the host of your
   `APP_URL`, without `https://` (for example `your-computer.your-tailnet.ts.net`). A new app starts in "Single
   Player Mode" (one athlete: you), which is all this needs. Default limits: 200 requests per 15 min / 2,000 per day
   overall, 100 / 1,000 for reads; the app respects both.
2. In `.env.local` set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN` (any random string you make
   up) and `APP_URL` (the same https address you open the app at). Restart the app.
3. Settings → **Connect Strava**. You're sent to Strava and back; the last 90 days are imported once per
   connection (progress shows in Settings). Backfill resumes where it stopped if the app is closed or Strava's
   rate limit is hit.
4. **Live updates** (new runs within minutes): Strava has to reach your computer from the internet, but the app itself
   must stay private. So the app runs a second, tiny listener on `127.0.0.1:3101` (`WEBHOOK_PORT`) that serves only
   `/api/strava/webhook`. Expose that port, not the app:
   - Tailscale Funnel: `tailscale funnel --bg --https=8443 3101` (the exact flags and the one-time admin-console
     switch for Funnel are from memory: I couldn't read Tailscale's docs here, so check `tailscale funnel --help`);
     the callback URL is then `https://<computer>.<tailnet>.ts.net:8443/api/strava/webhook`.
   - or a Cloudflare quick tunnel: `cloudflared tunnel --url http://localhost:3101` (the address changes each
     time, so you'd re-create the subscription).
5. With the app running and the address reachable, create the subscription (Strava calls your address to validate it
   first; only one subscription per Strava app is allowed):

   ```bash
   npm run strava:subscribe -- create https://<your-public-host>/api/strava/webhook
   npm run strava:subscribe -- view      # show the current subscription
   npm run strava:subscribe -- delete    # remove it (needed before creating a different one)
   ```

### How it behaves

- Tokens: access tokens last six hours; they are refreshed when within five minutes of expiring. Strava replaces the
  refresh token on every refresh, so a database lease makes sure only one refresh happens at a time and both tokens are
  saved together. Tokens never reach the browser or the logs. They are stored in the SQLite file, so **treat
  `data/training.db` and its backups as private**.
- Webhook: events are only validated and written to a job queue (so the reply is far inside Strava's 2-second limit);
  a worker in the same process fetches the activity right away. Duplicates are ignored. Events for another athlete,
  or after you disconnect, are acknowledged and ignored. A deleted activity leaves a marker so an older event can't
  bring it back; an activity changed to an unsupported type is removed from the list.
- Retries: failures retry with growing delays; a 429 waits for the next 15-minute boundary (or midnight UTC when the
  daily limit is used) and that time is saved, so it survives restarts. Nothing polls Strava.
- Disconnect (Settings): revokes access using Strava's `/oauth/revoke` endpoint, removes the tokens, and cancels
  pending imports. Imported activities stay. If Strava deauthorizes the app, the same cleanup happens automatically.
- Scope: `read,activity:read_all` (needed for activities set to "Only You"). Strava's API terms ask apps to respect
  activity privacy; this app is single-user and only shows your own data to you.

## PWA and offline

The service worker (`src/app/sw.ts`, served at `/serwist/sw.js`) precaches static assets and a generic `/~offline`
page. Page HTML and data are never cached. The one exception is `/workout`, a static page with no data in it, which
is precached so a workout can reopen offline; its data comes from IndexedDB.
Test PWA behaviour on a production build.

## Environment variables (`.env.example`)

| Name | Purpose | Needed from |
|---|---|---|
| `DB_PATH` | SQLite file location (default `data/training.db`) | optional |
| `APP_URL` | Public/Tailscale origin, used for Strava OAuth callbacks | M4 |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN` | Strava app registration (secret is server-only) | M4 |
| `ANTHROPIC_API_KEY` | Optional meal-photo analysis, server-only | M8 |

Dates for plans, meals, weigh-ins and activity matching use `Europe/Copenhagen` (`src/lib/dates.ts`).
