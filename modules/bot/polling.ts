// Dev mode: long polling. Run with `npm run bot:dev` while `npm run dev` is running.
import "dotenv/config";

import { getEnv } from "@/lib/env";

import { createBot } from "./bot";

const token = getEnv().TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env");
  process.exit(1);
}

async function main(botToken: string) {
  const bot = createBot(botToken);
  // Polling and webhook cannot work at the same time.
  await bot.api.deleteWebhook();
  console.log("Starting the bot in long polling mode. Press Ctrl+C to stop.");
  await bot.start({ onStart: (info) => console.log(`Bot @${info.username} is running`) });
}

void main(token);
