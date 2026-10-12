import { Api } from "grammy";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { Locale } from "@/lib/i18n";

// The menu of commands next to the message field, in both languages.
export const BOT_COMMANDS: Record<Locale, { command: string; description: string }[]> = {
  ru: [
    { command: "today", description: "Задачи на сегодня и просроченные" },
    { command: "week", description: "Задачи на 7 дней" },
    { command: "overdue", description: "Просроченные" },
    { command: "pending", description: "Ждут моего решения" },
    { command: "content", description: "Контент на сегодня — для пересылки в ботов" },
    { command: "notes", description: "Прислать итоги встречи" },
    { command: "help", description: "Справка" },
  ],
  en: [
    { command: "today", description: "Tasks for today and overdue" },
    { command: "week", description: "Tasks for 7 days" },
    { command: "overdue", description: "Overdue" },
    { command: "pending", description: "Waiting for my decision" },
    { command: "content", description: "Today's content — to forward to the bots" },
    { command: "notes", description: "Send meeting outcomes" },
    { command: "help", description: "Help" },
  ],
};

// Gives one person the menu in their language (their chat with the bot). Never throws.
export async function syncBotCommands(userId: string, locale: Locale) {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  const user = await db.user.findUnique({ where: { id: userId }, select: { botChatId: true } });
  if (!token || !user?.botChatId) return;
  try {
    await new Api(token).setMyCommands(BOT_COMMANDS[locale], {
      scope: { type: "chat", chat_id: Number(user.botChatId) },
    });
  } catch (error) {
    console.error("Failed to set the bot commands for a chat", error);
  }
}
