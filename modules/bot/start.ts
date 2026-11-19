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
  const code = payload.trim() ? (inviteCodeFromText(payload) ?? payload.trim()) : undefined;
  const result = await loginWithTelegram(profile, code);
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

// The invite code in what someone sent the bot: the invite link (…/invite/CODE), the bot link
// (…?start=CODE) or the code itself.
export function inviteCodeFromText(text: string): string | null {
  const s = text.trim();
  const link =
    s.match(/\/invite\/([A-Za-z0-9_-]{6,64})/) ?? s.match(/[?&]start=([A-Za-z0-9_-]{6,64})/);
  if (link) return link[1];
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

// Someone the bot does not know yet sends a message: when it holds an invite (the link or the
// code), they join or are linked as with /start CODE; otherwise null (the bot asks for the invite).
export async function handleUnknownText(
  profile: TelegramProfile,
  chatId: bigint,
  text: string,
): Promise<(BotReply & { userId?: string }) | null> {
  const code = inviteCodeFromText(text);
  return code ? handleStart(profile, chatId, code) : null;
}
