import { expect, test } from "@playwright/test";

test("home redirects to Today and the tab bar is shown", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  for (const name of ["Today", "Week", "Food", "Progress", "Settings"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("settings reads the local database", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText(/migration\(s\) applied/)).toBeVisible();
});

test("manifest and icons are installable", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/today");
  const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("service worker controls the app and shows the offline shell", async ({ page, context }) => {
  await page.goto("/today");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto("/week", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: /you're offline/i })).toBeVisible();
  await context.setOffline(false);
});

test("page HTML is never stored by the service worker", async ({ page }) => {
  await page.goto("/today");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    return out;
  });
  for (const p of ["/today", "/week", "/food", "/progress", "/settings"]) expect(cached).not.toContain(p);
});
