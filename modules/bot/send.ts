import { Api } from "grammy";

import { getEnv } from "@/lib/env";

let api: Api | undefined;

// Sends a plain-text message. Returns false (and logs) instead of throwing,
// so a Telegram problem never breaks the action that triggered it.
export async function sendTelegramMessage(chatId: bigint, text: string): Promise<boolean> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not set; Telegram message skipped.");
    return false;
  }
  api ??= new Api(token);
  try {
    await api.sendMessage(Number(chatId), text, { link_preview_options: { is_disabled: true } });
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message", error);
    return false;
  }
}
