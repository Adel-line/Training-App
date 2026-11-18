import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
let firstWorkoutId = "";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const idOf = (page: Page) => new URL(page.url()).searchParams.get("id")!;
const synced = (page: Page) => expect(page.getByTestId("sync-state")).toHaveText(/Synced/, { timeout: 15_000 });

async function startFromDay(page: Page, date: string) {
  await page.goto(`/week/${date}`);
  await page.getByRole("link", { name: "Start workout" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Strength A");
  await expect(page.getByRole("region", { name: "Goblet box squat" })).toBeVisible();
}

async function logAll(ex: Locator, count: number) {
  for (let i = 0; i < count; i++) await ex.getByRole("button", { name: "Log set" }).click();
}

async function serverBundle(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/workouts/${id}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

test("log a complete strength session, with per-side and timed sets, and finish it", async ({ page, request }) => {
  await startFromDay(page, "2026-11-23");
  await expect(page.getByText(/Test week/)).toBeVisible();

  // Goblet box squat: add weight (+2 kg x2) then log 3 sets; later sets carry the weight forward.
  const squat = region(page, "Goblet box squat");
  await squat.getByRole("button", { name: "Increase weight" }).click();
  await squat.getByRole("button", { name: "Increase weight" }).click();
  await squat.getByRole("button", { name: "RIR 2" }).or(squat.getByRole("button", { name: "2", exact: true })).click();
  await logAll(squat, 3);
  await expect(squat.getByText(/✓ Set 3/)).toBeVisible();

  await logAll(region(page, "Romanian deadlift (RDL)"), 3);
  await logAll(region(page, "Hip thrust"), 3);
  await logAll(region(page, "Step-up"), 6); // 3 sets x left/right
  await expect(region(page, "Step-up").getByText("Set 1 · Left")).toBeVisible();
  await expect(region(page, "Step-up").getByText("Set 3 · Right")).toBeVisible();
  await logAll(region(page, "Calf raise"), 2);

  // Timed, per-side hold: duration stepper in 5 s steps; no weight or RIR controls.
  const plank = region(page, "Side plank");
  await expect(plank.getByRole("button", { name: "Increase weight" })).toHaveCount(0);
  await plank.getByRole("button", { name: "Increase time" }).click();
  await expect(plank.getByRole("status", { name: "Time" })).toHaveText("35 s");
  await logAll(plank, 4);

  await synced(page);
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByText("Workout finished ✓")).toBeVisible();
  await synced(page);

  firstWorkoutId = idOf(page);
  const b = await serverBundle(request, firstWorkoutId);
  expect(b.workout.finished_at).toBeTruthy();
  expect(b.sets).toHaveLength(3 + 3 + 3 + 6 + 2 + 4);
  const squatSets = b.sets.filter((s: { exercise_id: string }) => s.exercise_id === b.exercises[0].exercise_id);
  expect(squatSets.map((s: { weight_kg: number; rir: number }) => [s.weight_kg, s.rir])).toEqual([[4, 2], [4, null], [4, null]]); // weight carries forward; RIR is a per-set judgement so it never does
  const plankSets = b.sets.filter((s: { exercise_id: string }) => s.exercise_id === b.exercises[5].exercise_id);
  expect(plankSets.every((s: { duration_seconds: number; reps: null; weight_kg: null }) => s.duration_seconds === 35 && s.reps === null && s.weight_kg === null)).toBe(true);
  expect(new Set(plankSets.map((s: { side: string }) => s.side))).toEqual(new Set(["left", "right"]));
});

test("the next workout shows last time's sets and starts from them", async ({ page }) => {
  await startFromDay(page, "2026-11-30");
  const squat = region(page, "Goblet box squat");
  await expect(squat.getByText(/last Monday 23 November/)).toBeVisible();
  await expect(squat.getByText("Last time: 8 reps × 4 kg · RIR 2")).toBeVisible();
  await expect(squat.getByRole("status", { name: "Weight" })).toHaveText("4 kg"); // prefilled from history
  const step = region(page, "Step-up");
  await expect(step.getByText("no history", { exact: false })).toHaveCount(0);
});

test("swapping an exercise changes only this workout", async ({ page, request }) => {
  await startFromDay(page, "2026-12-14");
  await region(page, "Calf raise").getByRole("button", { name: "Swap" }).click();
  await page.getByRole("dialog", { name: "Swap exercise" }).getByRole("button", { name: /Incline push-up/ }).click();
  const swapped = region(page, "Incline push-up");
  await expect(swapped.getByText("Swapped in for Calf raise")).toBeVisible();
  await expect(swapped.getByText(/no history yet/)).toBeVisible();
  await logAll(swapped, 2);
  await synced(page);
  const b = await serverBundle(request, idOf(page));
  expect(b.exercises[4]).toMatchObject({ name: "Incline push-up", measurement_type: "reps" });
  // The earlier workout and the template are untouched.
  const earlier = await serverBundle(request, firstWorkoutId);
  expect(earlier.exercises[4].name).toBe("Calf raise");
  expect(earlier.sets.some((x: { exercise_id: string }) => x.exercise_id === b.exercises[4].exercise_id)).toBe(false);
  await page.goto("/week/2027-01-11");
  await page.getByRole("link", { name: "Start workout" }).click();
  await expect(region(page, "Calf raise")).toBeVisible();
});

test("works offline: logged sets and unlogged drafts survive a reload, then sync once without duplicates", async ({ page, context, request }) => {
  await startFromDay(page, "2026-12-07");
  const id = idOf(page);

  // Wait until the service worker controls the page and has precached the workout screen.
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (new URL(r.url).pathname === "/workout") return true;
        return false;
      }),
    )
    .toBe(true);
  await synced(page);

  await context.setOffline(true);
  const squat = region(page, "Goblet box squat");
  await squat.getByRole("button", { name: "Increase weight" }).click();
  await squat.getByRole("button", { name: "Increase weight" }).click();
  await squat.getByRole("button", { name: "Log set" }).click(); // set 1 logged: 4 kg
  await expect(page.getByTestId("sync-state")).toHaveText(/Saved on device/);
  await squat.getByRole("button", { name: "Increase reps" }).click(); // set 2 draft only: 9 reps, not logged
  await squat.getByRole("button", { name: "Increase reps" }).click(); // 10 reps

  // Reopen offline: full page reload served from the precached shell.
  await page.reload();
  const squat2 = region(page, "Goblet box squat");
  await expect(squat2.getByText(/✓ Set 1/)).toBeVisible();
  await expect(squat2.getByRole("status", { name: "Reps" })).toHaveText("10"); // the draft is intact
  await expect(squat2.getByText("Last time: 8 reps × 4 kg")).toBeVisible(); // previous sets are available offline too
  await expect(page.getByTestId("sync-state")).toHaveText(/Saved on device.*offline/);
  await squat2.getByRole("button", { name: "Log set" }).click(); // set 2: 10 reps

  await context.setOffline(false);
  await synced(page);
  const b = await serverBundle(request, id);
  expect(b.sets).toHaveLength(2);
  expect(b.sets.map((s: { set_number: number; reps: number; weight_kg: number }) => [s.set_number, s.reps, s.weight_kg])).toEqual([[1, 8, 8], [2, 10, 8]]); // started at last time's 4 kg, +2 +2

  // Retrying delivery (reload while online) must not duplicate anything.
  await page.reload();
  await synced(page);
  expect((await serverBundle(request, id)).sets).toHaveLength(2);
});

test("the offline page offers to resume a workout saved on the phone", async ({ page, context }) => {
  await startFromDay(page, "2026-12-21");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto("/today", { waitUntil: "commit" }); // "load" never settles for an offline navigation in Playwright
  await expect(page.getByRole("heading", { name: /you're offline/i })).toBeVisible();
  await page.getByRole("link", { name: /Resume Strength A/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Strength A");
  await expect(region(page, "Goblet box squat")).toBeVisible();
  await context.setOffline(false);
});

test("a rejected write is surfaced and can be retried", async ({ page, request }) => {
  await startFromDay(page, "2027-01-04");
  const id = idOf(page);
  await synced(page);
  let reject = true;
  await page.route("**/api/sync", async (route) => {
    if (!reject) return route.continue();
    const ops = JSON.parse(route.request().postData()!).ops as { opId: string }[];
    await route.fulfill({ json: { results: ops.map((o) => ({ opId: o.opId, status: "rejected", error: "Test rejection" })) } });
  });
  await region(page, "Goblet box squat").getByRole("button", { name: "Log set" }).click();
  await expect(page.getByTestId("sync-state")).toHaveText(/Needs attention \(1\)/);
  await page.getByTestId("sync-state").click();
  await expect(page.getByText("Test rejection")).toBeVisible();
  expect((await serverBundle(request, id)).sets).toHaveLength(0);

  reject = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await synced(page);
  expect((await serverBundle(request, id)).sets).toHaveLength(1);
});
