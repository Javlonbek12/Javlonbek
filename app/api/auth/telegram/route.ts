import { getEnv } from "@/lib/env";
import {
  isLoginRateLimited,
  loginErrorRedirect,
  loginResultResponse,
} from "@/modules/core/auth/login-response";
import { verifyTelegramLogin } from "@/modules/core/auth/telegram";
import { loginWithTelegram } from "@/modules/core/users/service";

// Telegram Login Widget redirects here (data-auth-url) with the signed user data.
// Our own `invite` parameter is not part of Telegram's signature.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { invite, ...telegramData } = params;
  const inviteCode = invite || undefined;

  if (isLoginRateLimited(request)) return loginErrorRedirect("too_many_requests", inviteCode);

  const token = getEnv().TELEGRAM_BOT_TOKEN;
  const profile = token ? verifyTelegramLogin(telegramData, token) : null;
  if (!profile) return loginErrorRedirect("invalid_signature", inviteCode);

  return loginResultResponse(await loginWithTelegram(profile, inviteCode), inviteCode);
}
