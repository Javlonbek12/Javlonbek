import { z } from "zod";

import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { isValidTimezone } from "@/lib/time";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";

export async function getSettings(userId: string) {
  return db.userSettings.upsert({
    where: { userId },
    create: { userId, timezone: getEnv().DEFAULT_TIMEZONE },
    update: {},
  });
}

const minutes = z.number().int().min(0).max(1439).nullable();

export const settingsInputSchema = z
  .object({
    timezone: z.string().refine(isValidTimezone, "invalid timezone"),
    telegramEnabled: z.boolean(),
    quietHoursStart: minutes,
    quietHoursEnd: minutes,
    disabledTypes: z.array(z.enum(OPTIONAL_NOTIFICATION_TYPES as [string, ...string[]])),
  })
  // Quiet hours are either fully set or fully off.
  .refine((v) => (v.quietHoursStart === null) === (v.quietHoursEnd === null), "quiet hours");

export type SettingsInput = z.infer<typeof settingsInputSchema>;

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
