import { execSync } from "node:child_process";

import { request } from "@playwright/test";

import {
  ACCOUNTS,
  assertTestDatabase,
  authFile,
  BASE_URL,
  DATABASE_URL,
  type AccountName,
} from "./env";

function run(command: string, input?: string) {
  try {
    execSync(command, { env: { ...process.env, DATABASE_URL }, input, stdio: "pipe" });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`${command} failed:\n${stdout ?? ""}${stderr ?? ""}`);
  }
}

// Runs once, after the app has started (Playwright starts the web server first): a fresh database
// (every migration, the e2e accounts, the usual seed with demo planograms), then each account
// signs in through the dev login and its session cookie is saved for the tests.
export default async function globalSetup() {
  assertTestDatabase(DATABASE_URL);
  run(
    "npx prisma db execute --stdin",
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  run("npx prisma migrate deploy");
  run("npx tsx e2e/seed.ts");
  run("npx prisma db seed");

  for (const [name, account] of Object.entries(ACCOUNTS)) {
    const api = await request.newContext({ baseURL: BASE_URL });
    const response = await api.post("/api/auth/dev-login", { form: account, maxRedirects: 0 });
    const location = response.headers().location ?? "";
    if (response.status() !== 303 || location.includes("error=")) {
      throw new Error(`Dev login of ${name} failed: ${response.status()} ${location}`);
    }
    await api.storageState({ path: authFile(name as AccountName) });
    await api.dispose();
  }
}
