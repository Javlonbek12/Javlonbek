import "dotenv/config";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests use a separate database: it is wiped before each integration test.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://assistant:assistant@localhost:5432/assistant_test";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    // Integration tests share one database, so test files run one after another.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-test-session-secret",
      TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN",
      TELEGRAM_BOT_USERNAME: "test_assistant_bot",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      ALLOW_DEV_LOGIN: "true",
      DEFAULT_TIMEZONE: "Asia/Tashkent",
    },
  },
});
