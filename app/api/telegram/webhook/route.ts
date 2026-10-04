import { timingSafeEqual } from "node:crypto";

import { webhookCallback } from "grammy";

import { getEnv } from "@/lib/env";
import { createBot } from "@/modules/bot/bot";

let handler: ((request: Request) => Promise<Response>) | undefined;

function hasValidSecret(request: Request, secret: string): boolean {
  const received = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Prod mode: Telegram sends bot updates here with the secret header we registered
// via setWebhook. The secret is checked before the bot does any work.
export async function POST(request: Request) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = getEnv();
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: "bot is not configured" }, { status: 503 });
  }
  if (!hasValidSecret(request, TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  handler ??= webhookCallback(createBot(TELEGRAM_BOT_TOKEN), "std/http", {
    secretToken: TELEGRAM_WEBHOOK_SECRET,
  });
  return handler(request);
}
