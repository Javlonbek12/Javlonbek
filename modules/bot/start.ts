import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import type { TelegramProfile } from "@/modules/core/auth/telegram";
import { linkBotChat, loginWithTelegram } from "@/modules/core/users/service";

// /start [inviteCode]: links the chat to an existing user, or registers
// a new user by invite (or as OWNER if nobody is registered yet).
// Returns the reply text.
export async function handleStart(
  profile: TelegramProfile,
  chatId: bigint,
  payload: string,
): Promise<string> {
  const result = await loginWithTelegram(profile, payload.trim() || undefined);
  if (!result.ok) {
    return result.reason === "invite_required"
      ? t("bot.inviteRequired")
      : t(`login.errors.${result.reason}`);
  }

  await linkBotChat(result.user.id, chatId);
  const greeting = result.created
    ? t("bot.welcomeNew", { name: result.user.firstName, role: t(`roles.${result.user.role}`) })
    : t("bot.welcomeBack", { name: result.user.firstName });
  return `${greeting}\n\n${t("bot.openApp", { url: getEnv().APP_URL })}`;
}
