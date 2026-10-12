import { db } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";

// A person's interface language (site, bot, notifications).
export async function localeOf(userId: string): Promise<Locale> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { locale: true },
  });
  return isLocale(settings?.locale) ? settings.locale : "ru";
}

// Runs `build` in the person's language: texts made inside come out in it.
export async function inLocaleOf<T>(userId: string, build: () => T | Promise<T>): Promise<T> {
  return withLocale(await localeOf(userId), build);
}
