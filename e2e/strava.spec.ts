import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.describe.configure({ mode: "serial" });

const FAKE = "http://127.0.0.1:3400";
const HOOK = "http://127.0.0.1:3101/api/strava/webhook"; // the public listener
const OWNER = 4242;

const act = (id: number, type: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Activity ${id}`, sport_type: type, type, start_date: start, distance: 6500, moving_time: 2400,
  total_elevation_gain: 40, average_heartrate: 150, average_speed: 2.7, ...extra,
});
const set = (request: APIRequestContext, body: unknown) => request.post(`${FAKE}/__set`, { data: body });
const fakeState = async (request: APIRequestContext) => (await request.get(`${FAKE}/__state`)).json();
const event = (request: APIRequestContext, over: Record<string, unknown>) =>
  request.post(HOOK, { data: { object_type: "activity", object_id: 2001, aspect_type: "create", owner_id: OWNER, subscription_id: 1, event_time: 1000, ...over } });
const weekText = async (page: Page, d: string) => {
  await page.goto(`/week?d=${d}`);
  return page.locator("ul").first().innerText();
};

test("connect: OAuth with the right scopes, token refresh, then a 90-day backfill of supported types only", async ({ page, request }) => {
  await set(request, {
    activities: [
      act(1001, "Run", "2026-11-12T06:30:00Z"), // Thu, quality run day
      act(1002, "Hike", "2026-11-12T12:00:00Z"), // same day, doesn't match a run day
      act(1003, "Snowboard", "2026-11-14T09:00:00Z"), // Sat, long day
      act(1004, "TrailRun", "2026-11-14T07:00:00Z"), // Sat, long day
      act(1005, "Run", "2026-11-09T05:00:00Z"), // Mon, strength day
      act(1006, "Ride", "2026-11-13T08:00:00Z"), // skipped
      act(1007, "WeightTraining", "2026-11-13T09:00:00Z"), // skipped
      act(1008, "Run", "2026-11-10T23:30:00Z"), // 00:30 on the 11th in Copenhagen
    ],
  });

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Connect Strava" })).toBeVisible();
  await page.getByRole("link", { name: "Connect Strava" }).click();
  await expect(page).toHaveURL(/\/settings\?strava=connected/);
  await expect(page.getByText("Strava connected. Importing the last 90 days now.")).toBeVisible();

  const s0 = await fakeState(request);
  expect(s0.authorize).toMatchObject({ client_id: "123", response_type: "code", scope: "read,activity:read_all" });
  expect(s0.authorize.state.length).toBeGreaterThan(20);
  expect(s0.authorize.redirect_uri).toMatch(/\/api\/strava\/callback$/);

  await expect.poll(async () => { await page.reload(); return page.getByTestId("backfill-status").innerText(); }, { timeout: 20_000 }).toMatch(/^Done · 6 /);
  const s = await fakeState(request);
  expect(s.refreshCount).toBeGreaterThanOrEqual(1); // first token was inside the 5-minute window
  expect(s.badBearer).toBe(0); // always used the rotated token
  expect(s.listRequests[0].page).toBe(1);
  const ninetyDaysAgo = Date.now() / 1000 - 90 * 86400;
  expect(Math.abs(s.listRequests[0].after - ninetyDaysAgo)).toBeLessThan(3 * 86400);
  await expect(page.getByText("Athlete")).toBeVisible();
});

test("a callback with a bad or replayed state is refused", async ({ page }) => {
  await page.goto("/api/strava/callback?code=GOODCODE&state=forged");
  await expect(page).toHaveURL(/strava=bad_state/);
  await expect(page.getByText(/expired or came from another browser/)).toBeVisible();
});

test("the Week screen matches runs by date and type, and lists the rest separately", async ({ page }) => {
  await page.goto("/week?d=2026-11-09");
  const day = (name: RegExp) => page.locator("li").filter({ hasText: name });
  const thu = day(/Quality run/);
  await expect(thu.getByTestId("matched")).toHaveCount(1);
  await expect(thu.getByTestId("matched")).toContainText("Run 6.50 km · 40:00 · 6:09/km");
  await expect(thu.getByTestId("other-activity")).toContainText("Also: Hike");
  const sat = day(/Long day/);
  await expect(sat.getByTestId("matched")).toHaveCount(2); // Snowboard and TrailRun both match a long day
  const mon = day(/Strength A/);
  await expect(mon.getByTestId("matched")).toHaveCount(0);
  await expect(mon.getByTestId("other-activity")).toContainText("Also: Run");
  // Late-evening UTC run belongs to the next Copenhagen day (Wednesday), not Tuesday.
  await expect(day(/Strength B/).getByTestId("other-activity")).toContainText("Also: Run");
  // Ride and weight training were never imported.
  await expect(page.getByText("Ride")).toHaveCount(0);
});

test("webhook validation: right token echoes the challenge, wrong token is refused, on both entry points", async ({ request }) => {
  const q = (t: string) => `?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=${t}`;
  for (const base of [HOOK, "http://localhost:3100/api/strava/webhook"]) {
    const ok = await request.get(base + q("verify-me"));
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("application/json");
    expect(await ok.json()).toEqual({ "hub.challenge": "abc123" });
    expect((await request.get(base + q("wrong"))).status()).toBe(403);
  }
  expect((await request.get("http://127.0.0.1:3101/other")).status()).toBe(404); // the public port serves nothing else
  expect((await request.get("http://127.0.0.1:3101/today")).status()).toBe(404);
});

test("webhook: a new run appears within seconds; updates, type changes and deletes are applied", async ({ page, request }) => {
  const NEW = act(2001, "Run", "2026-11-12T16:00:00Z", { name: "Evening jog", distance: 3000, moving_time: 1200 });
  await set(request, { activities: [NEW] });
  const t0 = Date.now();
  const r = await event(request, { aspect_type: "create", event_time: 2000 });
  expect(r.status()).toBe(200);
  expect(Date.now() - t0).toBeLessThan(2000); // acknowledged well inside Strava's 2 s deadline
  await expect.poll(async () => (await weekText(page, "2026-11-09")).includes("3.00 km"), { timeout: 15_000 }).toBe(true);

  // duplicate delivery changes nothing
  await event(request, { aspect_type: "create", event_time: 2000 });
  const before = (await fakeState(request)).activityRequests;
  await page.waitForTimeout(500);
  expect((await fakeState(request)).activityRequests).toBe(before);

  // update: distance changed
  await set(request, { activities: [{ ...NEW, distance: 3500 }] });
  await event(request, { aspect_type: "update", event_time: 2100, updates: { title: "x" } });
  await expect.poll(async () => (await weekText(page, "2026-11-09")).includes("3.50 km"), { timeout: 15_000 }).toBe(true);

  // update to an unsupported type: removed from the local list
  await set(request, { activities: [{ ...NEW, sport_type: "Ride", type: "Ride" }] });
  await event(request, { aspect_type: "update", event_time: 2200, updates: { type: "Ride" } });
  await expect.poll(async () => (await weekText(page, "2026-11-09")).includes("3.50 km"), { timeout: 15_000 }).toBe(false);

  // back to a supported type, then deleted
  await set(request, { activities: [{ ...NEW, distance: 3500, sport_type: "Run", type: "Run" }] });
  await event(request, { aspect_type: "update", event_time: 2300, updates: { type: "Run" } });
  await expect.poll(async () => (await weekText(page, "2026-11-09")).includes("3.50 km"), { timeout: 15_000 }).toBe(true);
  await event(request, { aspect_type: "delete", event_time: 2400 });
  await expect.poll(async () => (await weekText(page, "2026-11-09")).includes("3.50 km"), { timeout: 15_000 }).toBe(false);

  // a stale (older) create arriving after the delete must not bring it back, even though Strava still serves it
  const reqs = (await fakeState(request)).activityRequests;
  await event(request, { aspect_type: "create", event_time: 2050 });
  await page.waitForTimeout(1200);
  expect((await weekText(page, "2026-11-09")).includes("3.50 km")).toBe(false);
  expect((await fakeState(request)).activityRequests).toBe(reqs); // not even fetched
});

test("webhook: bad payloads, other athletes and rate limits", async ({ page, request }) => {
  expect((await request.post(HOOK, { data: { hello: "world" } })).status()).toBe(400);
  expect((await request.post(HOOK, { data: "not json", headers: { "content-type": "text/plain" } })).status()).toBe(400);
  expect((await event(request, { owner_id: 999, object_id: 2002 })).status()).toBe(200); // acknowledged and ignored
  expect((await event(request, { subscription_id: 1 })).status()).toBe(200);

  // Strava answers 429 once: the job is retried later, not lost (retry time persisted; we only check it recovers)
  await set(request, { activities: [act(2003, "Hike", "2026-11-13T09:00:00Z", { name: "Rate limited hike", distance: 8000 })], rateLimitNext: 1 });
  await event(request, { object_id: 2003, event_time: 3000 });
  await page.goto("/settings");
  await expect.poll(async () => { await page.reload(); return page.getByText(/Paused for Strava's rate limit|Queued/).count(); }, { timeout: 15_000 }).toBeGreaterThan(0);
  // (it stays queued until the next 15-minute window; the unit tests cover the resume)
});

test("disconnect revokes at Strava, keeps history, and later events are ignored", async ({ page, request }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Disconnect Strava" }).click();
  await expect(page.getByText("Disconnected and access revoked at Strava. Imported activities were kept.")).toBeVisible();
  expect((await fakeState(request)).revokeCount).toBe(1);
  expect((await fakeState(request)).revokedWith).toMatch(/^refresh-/);
  await expect(page.getByRole("link", { name: "Connect Strava" })).toBeVisible();

  // history is retained
  expect(await weekText(page, "2026-11-09")).toContain("6.50 km");
  // events for the disconnected athlete are acknowledged but ignored
  await set(request, { activities: [act(2004, "Run", "2026-11-12T20:00:00Z", { distance: 9900 })] });
  expect((await event(request, { object_id: 2004, event_time: 4000 })).status()).toBe(200);
  await page.waitForTimeout(1200);
  expect(await weekText(page, "2026-11-09")).not.toContain("9.90 km");
});

test("the subscription script creates, shows and deletes the subscription, and the app then checks the subscription id", async ({ request }) => {
  const env = { ...process.env, DB_PATH: "./data/e2e.db", STRAVA_BASE_URL: FAKE, STRAVA_CLIENT_ID: "123", STRAVA_CLIENT_SECRET: "secret", STRAVA_VERIFY_TOKEN: "verify-me" };
  const run = (...args: string[]) => execFileSync("node", ["scripts/strava-subscribe.ts", ...args], { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

  expect(run("view")).toContain("No subscription");
  expect(run("create", HOOK)).toContain("Subscription created: id 7"); // Strava validated the callback through the listener
  expect(run("view")).toContain(`Subscription 7 -> ${HOOK}`);
  expect(() => run("create", HOOK)).toThrow(/already exists/); // only one per app

  // Events must now carry our subscription id.
  expect((await event(request, { subscription_id: 99 })).status()).toBe(403);
  expect((await event(request, { subscription_id: 7 })).status()).toBe(200);

  expect(run("delete")).toContain("Deleted subscription 7");
  expect(run("view")).toContain("No subscription");
  expect((await event(request, { subscription_id: 99 })).status()).toBe(200); // no id on file any more
});
