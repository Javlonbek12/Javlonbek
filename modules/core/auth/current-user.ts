import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n";
import { setRequestLocale } from "@/lib/i18n/server";
import { withAccess } from "@/modules/core/access/actor";
import { requireSessionSecret } from "@/lib/env";

import { readSessionToken, SESSION_COOKIE } from "./session";

// Cached per request, so layout and page share one DB query.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = readSessionToken(token, requireSessionSecret());
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { settings: { select: { locale: true } } },
  });
  if (!user) return null;
  // The page is drawn in the user's language.
  const { settings, ...rest } = user;
  const locale = isLocale(settings?.locale) ? settings.locale : "ru";
  setRequestLocale(locale);
  // With the role settings attached: menus, lists and approvals follow them.
  return { ...(await withAccess(rest)), locale };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// The language to draw this request in: the signed-in user's setting; for guests (sign-in,
// invitation) the browser's: Russian if it lists Russian or Uzbek, otherwise English.
export const getViewerLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser();
  if (user) return user.locale;
  const accepted = ((await headers()).get("accept-language") ?? "").toLowerCase();
  const locale: Locale = !accepted || /\b(ru|uz)\b/.test(accepted) ? "ru" : "en";
  setRequestLocale(locale);
  return locale;
});
