import { defineConfig, devices } from "@playwright/test";

import { ACCOUNTS, authFile, BASE_URL, DATABASE_URL, PORT, type Account } from "./e2e/env";

// Browser tests (`npm run test:e2e`) of the built app: run `npm run build` first. Playwright
// starts the app on port 3400 against its own database, which the global setup wipes and seeds.
export default defineConfig<{ account: Account }>({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // The two projects sign in as different accounts, so they never share a running timer.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Room for a slow CI machine (a passing check never waits for it).
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: "ru-RU",
    timezoneId: "Asia/Tashkent",
    // The app registers a service worker in production builds; tests always go to the network.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        account: ACCOUNTS.desktop,
        storageState: authFile("desktop"),
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        account: ACCOUNTS.phone,
        storageState: authFile("phone"),
      },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // Answers once the server is up and reaches the database (no tables needed yet).
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Not "production": the dev login is never available there.
      NODE_ENV: "test",
      ALLOW_DEV_LOGIN: "true",
      DATABASE_URL,
      APP_URL: BASE_URL,
      SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
      DEFAULT_TIMEZONE: "Asia/Tashkent",
      UPLOAD_DIR: "./.e2e-uploads",
      // Empty values win over .env: no Telegram, AI or speech services from tests.
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_BOT_USERNAME: "",
      TELEGRAM_WEBHOOK_SECRET: "",
      ANTHROPIC_API_KEY: "",
      STT_PROVIDER: "mock",
    },
  },
});
