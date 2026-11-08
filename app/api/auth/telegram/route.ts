import { getEnv } from "@/lib/env";
import {
  isLoginRateLimited,
  loginErrorRedirect,
  loginResultResponse,
} from "@/modules/core/auth/login-response";
import { verifyTelegramLogin } from "@/modules/core/auth/telegram";
import { loginWithTelegram } from "@/modules/core/users/service";

// Telegram Login Widget redirects here (data-auth-url) with the signed user data.
// Our own `invite` and `next` (the page to return to) are not part of Telegram's signature.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { invite, next, ...telegramData } = params;
  const inviteCode = invite || undefined;

  if (isLoginRateLimited(request)) return loginErrorRedirect("too_many_requests", inviteCode, next);

  const token = getEnv().TELEGRAM_BOT_TOKEN;
  const profile = token ? verifyTelegramLogin(telegramData, token) : null;
  if (!profile) return loginErrorRedirect("invalid_signature", inviteCode, next);

  return loginResultResponse(await loginWithTelegram(profile, inviteCode), inviteCode, next);
}
