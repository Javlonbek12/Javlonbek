import { t } from "@/lib/i18n";
import type { TelegramProfile } from "@/modules/core/auth/telegram";
import { linkBotChat, loginWithTelegram } from "@/modules/core/users/service";

import type { BotReply } from "./conversation";

// /start [inviteCode]: links the chat to an existing user, or registers
// a new user by invite (or as OWNER if nobody is registered yet). On success the greeting
// teaches by doing: «📋 Сегодня» and «⏳ Ждут решения» to try right away. `userId`: who was
// linked (the bot then gives them the command menu of their role).
export async function handleStart(
  profile: TelegramProfile,
  chatId: bigint,
  payload: string,
): Promise<BotReply & { userId?: string }> {
  const result = await loginWithTelegram(profile, payload.trim() || undefined);
  if (!result.ok) {
    return {
      text:
        result.reason === "invite_required"
          ? t("bot.inviteRequired")
          : t(`login.errors.${result.reason}`),
    };
  }

  await linkBotChat(result.user.id, chatId);
  const greeting = result.created
    ? t("bot.welcomeNew", { name: result.user.firstName, role: t(`roles.${result.user.role}`) })
    : t("bot.welcomeBack", { name: result.user.firstName });
  return {
    text: `${greeting}\n\n${t("bot.welcomeTry")}`,
    buttons: [
      [
        { text: t("bot.menu.today"), data: "l:today" },
        { text: t("bot.menu.pending"), data: "l:pending" },
      ],
    ],
    open: "/",
    userId: result.user.id,
  };
}
