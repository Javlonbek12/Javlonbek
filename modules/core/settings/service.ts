import { z } from "zod";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { isValidTimezone } from "@/lib/time";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";
import { LOCALES, type Locale } from "@/lib/i18n";

export async function getSettings(userId: string) {
  try {
    return await db.userSettings.upsert({
      where: { userId },
      create: { userId, timezone: getEnv().DEFAULT_TIMEZONE },
      update: {},
    });
  } catch (error) {
    // A page reads the settings twice in parallel on a person's first visit: both try to create
    // the row and one loses on the unique key. The row exists now, so read it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return db.userSettings.findUniqueOrThrow({ where: { userId } });
    }
    throw error;
  }
}

const minutes = z.number().int().min(0).max(1439).nullable();

export const settingsInputSchema = z
  .object({
    timezone: z.string().refine(isValidTimezone, "invalid timezone"),
    telegramEnabled: z.boolean(),
    quietHoursStart: minutes,
    quietHoursEnd: minutes,
    disabledTypes: z.array(z.enum(OPTIONAL_NOTIFICATION_TYPES as [string, ...string[]])),
    digestTime: z.number().int().min(0).max(1439),
    locale: z.enum(LOCALES as [Locale, ...Locale[]]).default("ru"),
  })
  // Quiet hours are either fully set or fully off.
  .refine((v) => (v.quietHoursStart === null) === (v.quietHoursEnd === null), "quiet hours");

export type SettingsInput = z.input<typeof settingsInputSchema>;

export async function updateSettings(userId: string, input: SettingsInput) {
  const data = settingsInputSchema.parse(input);
  return db.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

// "Today" as YYYY-MM-DD in the user's timezone.
export async function getUserToday(userId: string, now = new Date()) {
  const { timezone } = await getSettings(userId);
  return todayInTimezone(timezone, now);
}
