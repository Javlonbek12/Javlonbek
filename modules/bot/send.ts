import { Api, InputFile, InputMediaBuilder } from "grammy";

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

export type MediaItem = { kind: "PHOTO" | "VIDEO" | "FILE"; path: string; name: string };

// Sends files from disk: one as a photo / video / document, several as an album (Telegram groups
// photos with videos, documents only with documents — the caller passes one kind of group).
// The caption goes under the first item.
export async function sendTelegramMedia(
  chatId: bigint,
  items: MediaItem[],
  caption: string,
): Promise<boolean> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not set; Telegram media skipped.");
    return false;
  }
  if (!items.length) return true;
  api ??= new Api(token);
  const chat = Number(chatId);
  const options = caption ? { caption: caption.slice(0, 1024) } : {};
  try {
    if (items.length === 1) {
      const [item] = items as [MediaItem];
      const file = new InputFile(item.path, item.name);
      if (item.kind === "PHOTO") await api.sendPhoto(chat, file, options);
      else if (item.kind === "VIDEO") await api.sendVideo(chat, file, options);
      else await api.sendDocument(chat, file, options);
      return true;
    }
    const list = items.slice(0, 10);
    const file = (item: MediaItem) => new InputFile(item.path, item.name);
    const extra = (i: number) => (i === 0 ? options : {});
    if (list.every((item) => item.kind === "FILE"))
      await api.sendMediaGroup(
        chat,
        list.map((item, i) => InputMediaBuilder.document(file(item), extra(i))),
      );
    else
      await api.sendMediaGroup(
        chat,
        list
          .filter((item) => item.kind !== "FILE")
          .map((item, i) =>
            item.kind === "PHOTO"
              ? InputMediaBuilder.photo(file(item), extra(i))
              : InputMediaBuilder.video(file(item), extra(i)),
          ),
      );
    return true;
  } catch (error) {
    console.error("Failed to send Telegram media", error);
    return false;
  }
}
