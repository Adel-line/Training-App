import { expect, test } from "@playwright/test";

// These tests share one fresh database (see playwright.config.ts) and run in order.
test.describe.configure({ mode: "serial" });

test("seeded plan shows on the Week screen, with test week labelled", async ({ page }) => {
  await page.goto("/week?d=2026-11-23");
  await expect(page.getByText("Test week: find your starting weights.")).toBeVisible();
  const items = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /Mon|Tue|Wed|Thu|Fri|Sat|Sun/ }) });
  await expect(items).toHaveCount(7);
  await expect(items.nth(0)).toContainText("Strength A");
  await expect(items.nth(1)).toContainText("Easy run");
  await expect(items.nth(2)).toContainText("Strength B");
  await expect(items.nth(3)).toContainText("Quality run");
  await expect(items.nth(4)).toContainText("Bouldering");
  await expect(items.nth(5)).toContainText("Long day");
  await expect(items.nth(6)).toContainText("Rest");
});

test("day details show the phase for that date", async ({ page }) => {
  await page.goto("/week/2026-11-30");
  await expect(page.getByText("Phase 1 · baseline")).toBeVisible();
  await page.goto("/week/2026-12-07");
  await expect(page.getByText("Phase 1 · deficit")).toBeVisible();
  await page.goto("/week/2027-03-15");
  await expect(page.getByText("No phase active")).toBeVisible();
  await page.goto("/week/2026-11-20");
  await expect(page.getByText(/Plan starts Monday 23 November/)).toBeVisible();
});

test("a date override changes only that date and can be removed", async ({ page }) => {
  await page.goto("/week/2026-12-01"); // a Tuesday: Easy run
  await expect(page.getByRole("heading", { name: "Edit this day" })).toBeVisible();
  await page.getByLabel("Session").selectOption("bouldering");
  await page.getByLabel("Notes").fill("legs sore");
  await page.getByRole("button", { name: "Save for this date" }).click();
  await expect(page.getByText("Changed for this date only")).toBeVisible();
  await expect(page.getByText("legs sore").first()).toBeVisible();

  await page.goto("/week/2026-12-08"); // next Tuesday untouched
  await expect(page.getByText("From your weekly plan")).toBeVisible();
  await expect(page.getByText("Easy run").first()).toBeVisible();
});

test("weekly plan edits leave existing overrides alone", async ({ page }) => {
  await page.goto("/settings/plan");
  await page.getByLabel("Tuesday", { exact: true }).selectOption("long_day");
  await page.getByRole("button", { name: "Save weekly plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  await page.goto("/week/2026-12-08"); // recurring Tuesday now follows the weekly plan
  await expect(page.getByText("Long day").first()).toBeVisible();
  await page.goto("/week/2026-12-01"); // overridden date keeps its own session
  await expect(page.getByText("Bouldering").first()).toBeVisible();
  await expect(page.getByText("Changed for this date only")).toBeVisible();
});

test("removing the override restores the weekly plan for that date", async ({ page }) => {
  await page.goto("/week/2026-12-01");
  await page.getByRole("button", { name: "Restore weekly plan for this date" }).click();
  await expect(page.getByText("From your weekly plan")).toBeVisible();
  await expect(page.getByText("Long day").first()).toBeVisible();
});

test("invalid dates 404 and Today shows protein against the target", async ({ page }) => {
  expect((await page.goto("/week/2026-02-30"))?.status()).toBe(404);
  await page.goto("/today");
  // Before 23 Nov the target hasn't started yet; on/after it the range shows.
  await expect(page.getByText(/^0 g( \/ 110–130 g)?$/)).toBeVisible();
});
