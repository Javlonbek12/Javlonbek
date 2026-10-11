// Prod mode: tells Telegram to send updates to APP_URL/api/telegram/webhook.
// Run once after deploy: `npm run bot:set-webhook`.
import "dotenv/config";

import { Api } from "grammy";

import { getEnv } from "@/lib/env";

const env = getEnv();
if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env");
  process.exit(1);
}

async function main(token: string, secret: string) {
  const url = `${env.APP_URL}/api/telegram/webhook`;
  const api = new Api(token);
  await api.setWebhook(url, { secret_token: secret });
  // The menu of commands next to the message field.
  await api.setMyCommands([
    { command: "today", description: "Задачи на сегодня и просроченные" },
    { command: "week", description: "Задачи на 7 дней" },
    { command: "overdue", description: "Просроченные" },
    { command: "pending", description: "Ждут моего решения" },
    { command: "content", description: "Контент на сегодня — для пересылки в ботов" },
    { command: "notes", description: "Прислать итоги встречи" },
    { command: "help", description: "Справка" },
  ]);
  console.log(`Webhook set to ${url}; commands updated.`);
}

void main(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET);
