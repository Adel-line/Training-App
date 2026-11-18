import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /sign-in link/i })).toBeVisible();
});

test("an address that is not allowlisted is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone-else@example.com");
  await page.getByRole("button", { name: /sign-in link/i }).click();
  await expect(page.getByRole("status")).toHaveText(/isn't allowed/i);
});

test("invalid magic-link params bounce to login", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=&type=email");
  await expect(page).toHaveURL(/\/login\?error=invalid_link/);
  await expect(page.getByRole("status")).toContainText(/invalid or has expired/i);
});

test("open-redirect style next values are not honoured", async ({ request }) => {
  const res = await request.get("/auth/confirm?token_hash=x&type=email&next=//evil.example", {
    maxRedirects: 0,
  });
  // Bad token -> login; never a redirect to another host.
  expect(res.headers()["location"] ?? "").not.toContain("evil.example");
});

test("manifest and icons are installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/today");
  const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of m.icons) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

test("service worker controls the app and shows the offline shell", async ({ page, context }) => {
  await page.goto("/login");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // clientsClaim: after activation the page gets controlled (reload to be safe).
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toMatch(/\/$/);

  await context.setOffline(true);
  await page.goto("/login").catch(() => {});
  await expect(page.getByRole("heading", { name: /you're offline/i })).toBeVisible();
  await context.setOffline(false);
});

test("private pages are never stored by the service worker", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  for (const p of ["/today", "/week", "/food", "/progress", "/settings"]) {
    expect(cached).not.toContain(p);
  }
});
