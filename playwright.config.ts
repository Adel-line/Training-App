import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      // Set CHROMIUM_PATH when the Playwright-managed browser isn't installed.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      // Stand-in for Strava (OAuth, API, revoke) so the whole integration can be exercised.
      command: "node e2e/fake-strava.mjs",
      url: "http://127.0.0.1:3400/__state",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Production build: the service worker is disabled in `next dev`.
      command: `rm -f data/e2e.db* && npm run build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/today`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        DB_PATH: "./data/e2e.db",
        APP_URL: `http://localhost:${PORT}`,
        STRAVA_BASE_URL: "http://127.0.0.1:3400",
        STRAVA_CLIENT_ID: "123",
        STRAVA_CLIENT_SECRET: "secret",
        STRAVA_VERIFY_TOKEN: "verify-me",
        WEBHOOK_PORT: "3101",
      },
    },
  ],
});
