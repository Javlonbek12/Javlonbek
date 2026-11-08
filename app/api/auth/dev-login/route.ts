import { z } from "zod";

import { isDevLoginEnabled } from "@/lib/env";
import {
  isLoginRateLimited,
  loginErrorRedirect,
  loginResultResponse,
} from "@/modules/core/auth/login-response";
import { loginWithTelegram } from "@/modules/core/users/service";

const schema = z.object({
  telegramId: z.string().regex(/^\d{1,15}$/),
  firstName: z.string().trim().min(1).max(64),
  invite: z.string().optional(),
});

// Local testing without a public domain: logs in as a fake Telegram user.
// Disabled unless ALLOW_DEV_LOGIN=true, and always disabled in production.
export async function POST(request: Request) {
  if (!isDevLoginEnabled()) return loginErrorRedirect("dev_login_disabled");

  const form = Object.fromEntries(await request.formData());
  const parsed = schema.safeParse(form);
  const inviteCode = typeof form.invite === "string" && form.invite ? form.invite : undefined;
  const next = form.next;
  if (isLoginRateLimited(request)) return loginErrorRedirect("too_many_requests", inviteCode, next);
  if (!parsed.success) return loginErrorRedirect("invalid_signature", inviteCode, next);

  const result = await loginWithTelegram(
    { telegramId: BigInt(parsed.data.telegramId), firstName: parsed.data.firstName },
    inviteCode,
  );
  return loginResultResponse(result, inviteCode, next);
}
