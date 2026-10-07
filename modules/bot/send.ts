import { Api, InputFile } from "grammy";

import { getEnv } from "@/lib/env";

import { inlineKeyboard, type TelegramButton } from "./keyboard";

export type { TelegramButton };

let api: Api | undefined;

// Sends a plain-text message (optionally with inline buttons). Returns false (and logs)
// instead of throwing, so a Telegram problem never breaks the action that triggered it.
export async function sendTelegramMessage(
  chatId: bigint,
  text: string,
  buttons?: TelegramButton[][],
): Promise<boolean> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not set; Telegram message skipped.");
    return false;
  }
  api ??= new Api(token);
  try {
    await api.sendMessage(Number(chatId), text, {
      link_preview_options: { is_disabled: true },
      reply_markup: inlineKeyboard(buttons),
    });
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message", error);
    return false;
  }
}

// Sends a picture with a caption (e.g. an approved planogram). Same error handling as above.
export async function sendTelegramPhoto(
  chatId: bigint,
  png: Buffer,
  caption: string,
  fileName = "planogram.png",
): Promise<boolean> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not set; Telegram photo skipped.");
    return false;
  }
  api ??= new Api(token);
  try {
    await api.sendPhoto(Number(chatId), new InputFile(png, fileName), {
      ...(caption ? { caption: caption.slice(0, 1024) } : {}),
    });
    return true;
  } catch (error) {
    console.error("Failed to send Telegram photo", error);
    return false;
  }
}
