import { Api } from "grammy";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n";
import { canUseModule, withAccess } from "@/modules/core/access/actor";
import type { ConfigurableModule } from "@/modules/core/access/config";

type BotCommand = { command: string; description: string; module?: ConfigurableModule };

// The menu of commands next to the message field, in both languages. A command of a section
// shows only to those whose role has the section (Settings → Roles).
export const BOT_COMMANDS: Record<Locale, BotCommand[]> = {
  ru: [
    { command: "today", description: "Задачи на сегодня и просроченные" },
    { command: "week", description: "Задачи на 7 дней" },
    { command: "overdue", description: "Просроченные" },
    { command: "pending", description: "Ждут моего решения" },
    {
      command: "content",
      description: "Контент на сегодня — для пересылки в ботов",
      module: "content",
    },
    { command: "notes", description: "Прислать итоги встречи", module: "meetings" },
    { command: "help", description: "Справка" },
  ],
  en: [
    { command: "today", description: "Tasks for today and overdue" },
    { command: "week", description: "Tasks for 7 days" },
    { command: "overdue", description: "Overdue" },
    { command: "pending", description: "Waiting for my decision" },
    {
      command: "content",
      description: "Today's content — to forward to the bots",
      module: "content",
    },
    { command: "notes", description: "Send meeting outcomes", module: "meetings" },
    { command: "help", description: "Help" },
  ],
};

export function commandsFor(actor: Parameters<typeof canUseModule>[0], locale: Locale) {
  return BOT_COMMANDS[locale]
    .filter((c) => !c.module || canUseModule(actor, c.module))
    .map(({ command, description }) => ({ command, description }));
}

// Gives one person the menu in their language and for their role (their chat with the bot).
// `api`: the bot's own, when called from the bot. Never throws.
export async function syncBotCommands(userId: string, locale?: Locale, api?: Api) {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  const found = await db.user.findUnique({
    where: { id: userId },
    include: { settings: { select: { locale: true } } },
  });
  if (!token || !found?.botChatId || found.deactivatedAt) return;
  const { settings, ...user } = found;
  const lang: Locale = locale ?? (isLocale(settings?.locale) ? settings.locale : "ru");
  try {
    await (api ?? new Api(token)).setMyCommands(commandsFor(await withAccess(user), lang), {
      scope: { type: "chat", chat_id: Number(found.botChatId) },
    });
  } catch (error) {
    console.error("Failed to set the bot commands for a chat", error);
  }
}

// After the role settings change: everyone's menu follows them.
export async function syncAllBotCommands() {
  const users = await db.user.findMany({
    where: { botChatId: { not: null }, deactivatedAt: null },
    select: { id: true },
  });
  for (const user of users) await syncBotCommands(user.id);
}
