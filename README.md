# Training

Private, phone-first training app for one person (snowboarding, splitboarding, general fitness).
Next.js (App Router) + Supabase + Tailwind, installable as a PWA, deployed on Vercel.

Status: **milestone 1 of 8** (scaffold, auth, PWA). See the build prompt for the full roadmap.

## Environment variables

Copy `.env.example` to `.env.local` for development; set the same names in Vercel
(Project → Settings → Environment Variables) for production. Never commit real values.

| Name | Where it comes from | Needed from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | M1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / publishable key | M1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key. **Server-only.** | M2 |
| `ALLOWED_EMAIL` | The one email address allowed to sign in | M1 |
| `APP_URL` | Public origin, e.g. `https://your-app.vercel.app` (or your tunnel URL in dev). No trailing slash | M1 |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava → Settings → My API Application. Secret is **server-only** | M4 |
| `STRAVA_VERIFY_TOKEN` | Any random string you choose; used for webhook verification | M4 |
| `ANTHROPIC_API_KEY` | console.anthropic.com. Optional, server-only, milestone 8 only | M8 |

## Supabase setup (milestone 1)

1. Create a project at supabase.com.
2. **Authentication → Sign In / Providers → Email**: enable email, keep "Confirm email" on.
   **Disable new user sign-ups** (Authentication → Sign In / Providers → "Allow new users to sign up" off), then
   create your own user once (Authentication → Users → Add user → *Send invitation* or *Create new user* with your
   `ALLOWED_EMAIL`). Without this, anyone could call Supabase's API directly with the public anon key and create
   accounts; the app's allowlist checks are a second layer, not a substitute.
3. **Authentication → URL Configuration**: set *Site URL* to your `APP_URL`, and add `APP_URL/**`
   (plus `http://localhost:3000/**` for development) to *Redirect URLs*.
4. **Authentication → Email Templates → Magic Link**: replace the link with the token-hash form so the link works
   even if it opens in a different browser than the installed app (common on iPhone):

   ```html
   <h2>Sign in</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to Training</a></p>
   ```
5. Supabase's built-in email sender is rate-limited; that's fine for one user.

### How the allowlist is enforced

- Requesting a link: the server action refuses any address other than `ALLOWED_EMAIL` before Supabase is called.
- Establishing a session: `/auth/confirm` verifies the token, then signs out and refuses if the user's email isn't allowed.
- Using a session: `src/proxy.ts` redirects anyone else to `/login`, and every protected page/action calls
  `requireOwner()`, which re-verifies the user with the Auth server (`getUser()`).
- Data access is additionally restricted by RLS from milestone 2.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values above
npm run dev                  # http://localhost:3000 (service worker is disabled in dev)
```

Checks:

```bash
npm run lint
npm run typecheck
npm test            # Vitest unit tests
CHROMIUM_PATH=/path/to/chrome npm run e2e   # Playwright (builds and serves a production build on :3100)
```

`CHROMIUM_PATH` is only needed when Playwright's own browser download isn't installed
(otherwise run `npx playwright install chromium`). The e2e tests use dummy Supabase values and cover everything
that doesn't need a live Supabase project: auth gating, allowlist refusal, the manifest, and the offline shell.

For webhook development (milestone 4) expose localhost with `cloudflared tunnel --url http://localhost:3000` or ngrok.

### Regenerating icons

`CHROMIUM_PATH=... npm run icons` re-renders `public/icons/*.png` from the SVG in `scripts/generate-icons.mjs`.

## PWA and offline

- `src/app/manifest.ts` is the web app manifest; icons live in `public/icons`.
- The service worker (`src/app/sw.ts`, built by `@serwist/turbopack` and served from `/serwist/sw.js`) precaches the
  app's static assets and a generic `/~offline` page. Page HTML and RSC data are **never cached** since they are
  private; if a page can't load offline you get the generic shell. Offline workout data will live in an
  owner-scoped IndexedDB store (milestone 3) and is cleared on sign-out.
- Test PWA behaviour on a production build (`npm run build && npm start`); the service worker is off in `next dev`.
- Install on a phone: open the deployed URL over HTTPS → Share/⋮ menu → *Add to Home Screen*.

## Deploying to Vercel

1. Push the repo to GitHub and import it at vercel.com/new (framework preset: Next.js, defaults are fine).
2. Add the environment variables above (Production, and Preview if you want preview deploys).
3. Deploy, then set Supabase *Site URL* / *Redirect URLs* to the Vercel URL and `APP_URL` to the same origin.
4. Request a sign-in link from the deployed site, open it on your phone, and add the app to the home screen.

## Training dates

Plan dates, meals, weigh-ins and activity matching use `Europe/Copenhagen` (`src/lib/dates.ts`).
