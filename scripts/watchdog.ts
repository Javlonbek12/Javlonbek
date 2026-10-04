// Watchdog process (a separate container in production): every 5 minutes checks the
// site, the scheduler and the bot, and messages the OWNER in Telegram about problems.
// `npm run watchdog` — loop; `npm run watchdog -- --once` — one check.
import "dotenv/config";

import { Api } from "grammy";

import { getEnv } from "@/lib/env";
import { runWatchdog } from "@/modules/ops/watchdog";

const INTERVAL_MS = 5 * 60_000;
const env = getEnv();
const healthUrl = process.env.APP_HEALTH_URL ?? `${env.APP_URL}/api/health`;

async function appHealthy() {
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
  return response.ok && (await response.json()).status === "ok";
}

async function webhookInfo() {
  if (!env.TELEGRAM_BOT_TOKEN) return undefined;
  try {
    return await new Api(env.TELEGRAM_BOT_TOKEN).getWebhookInfo();
  } catch {
    return null;
  }
}

async function round() {
  try {
    const problems = await runWatchdog({ now: new Date(), appHealthy, webhookInfo });
    console.log(
      new Date().toISOString(),
      problems.size ? [...problems.values()].join("; ") : "all ok",
    );
  } catch (error) {
    console.error("Watchdog round failed", error);
  }
}

async function main() {
  if (process.argv.includes("--once")) {
    await round();
    process.exit(0);
  }
  // The first check waits a few minutes so a fresh deploy (app and worker still
  // starting) doesn't raise a false alarm.
  setTimeout(() => {
    void round();
    setInterval(() => void round(), INTERVAL_MS);
  }, INTERVAL_MS);
}

void main();
