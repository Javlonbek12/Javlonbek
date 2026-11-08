import { db } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n";
import { withAccess } from "@/modules/core/access/actor";
import { requireSessionSecret } from "@/lib/env";

import { readSessionToken, SESSION_COOKIE } from "./session";

// For API route handlers: reads the session cookie straight from the request. `locale` is the
// user's language: a handler that writes texts (a download) runs inside withLocale(user.locale, …),
// because the per-page language set while rendering doesn't reach route handlers.
export async function getUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const userId = readSessionToken(decodeURIComponent(token), requireSessionSecret());
  if (!userId) return null;
  const found = await db.user.findUnique({ where: { id: userId }, include: { settings: true } });
  // A deactivated person's session no longer works.
  if (!found || found.deactivatedAt) return null;
  const { settings, ...user } = found;
  const locale: Locale = isLocale(settings?.locale) ? settings.locale : "ru";
  return { ...(await withAccess(user)), locale };
}
