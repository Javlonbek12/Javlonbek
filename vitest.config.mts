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
    // Live AI tests run only via `npm run test:ai` (they need an API key and cost money).
    exclude: [
      "node_modules/**",
      ".next/**",
      "e2e/**",
      ...(process.env.RUN_AI_EVAL ? [] : ["tests/ai-live/**"]),
    ],
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
      UPLOAD_DIR: "./.test-uploads",
      // Only the live suite uses the real key from .env.
      ANTHROPIC_API_KEY: process.env.RUN_AI_EVAL ? (process.env.ANTHROPIC_API_KEY ?? "") : "",
      STT_PROVIDER: "mock",
    },
  },
});
