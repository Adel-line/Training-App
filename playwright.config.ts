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
  webServer: {
    // Production build: the service worker is disabled in `next dev`.
    command: `rm -f data/e2e.db* && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/today`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { DB_PATH: "./data/e2e.db" },
  },
});
