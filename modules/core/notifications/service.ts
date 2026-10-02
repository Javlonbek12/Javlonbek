import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { sendTelegramMessage } from "@/modules/bot/send";
import { ForbiddenError } from "@/modules/core/errors";
import { canSendTestNotification, type Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

import { isInQuietHours } from "./quiet-hours";
import { OPTIONAL_NOTIFICATION_TYPES, type NotificationType } from "./types";

export type NotificationEvent = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
};

type Deps = {
  sendTelegram: (chatId: bigint, text: string) => Promise<boolean>;
  now: Date;
};

export function formatTelegramText(event: NotificationEvent, appUrl: string): string {
  const lines = [event.title];
  if (event.body) lines.push(event.body);
  if (event.link) lines.push("", `${appUrl}${event.link}`);
  return lines.join("\n");
}

// Single entry point for notifications: saves it for the UI and sends it to Telegram
// when the user linked the bot, has Telegram enabled, didn't turn this type off
// and is not in quiet hours. Returns null when the user turned this type off.
export async function notify(userId: string, event: NotificationEvent, deps?: Partial<Deps>) {
  const { sendTelegram = sendTelegramMessage, now = new Date() } = deps ?? {};
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const settings = await getSettings(userId);

  const optional = OPTIONAL_NOTIFICATION_TYPES.includes(event.type);
  if (optional && settings.disabledTypes.includes(event.type)) return null;

  const notification = await db.notification.create({
    data: { userId, type: event.type, title: event.title, body: event.body, link: event.link },
  });

  const quiet = isInQuietHours(
    now,
    settings.timezone,
    settings.quietHoursStart,
    settings.quietHoursEnd,
  );
  if (user.botChatId && settings.telegramEnabled && !quiet) {
    const sent = await sendTelegram(user.botChatId, formatTelegramText(event, getEnv().APP_URL));
    if (sent) {
      return db.notification.update({
        where: { id: notification.id },
        data: { sentToTelegramAt: now },
      });
    }
  }
  return notification;
}

export async function sendTestNotification(actor: Actor, targetUserId: string) {
  if (!canSendTestNotification(actor, targetUserId)) throw new ForbiddenError();
  const sender = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  return notify(targetUserId, {
    type: "test",
    title: t("notifications.events.testTitle"),
    body: t("notifications.events.testBody", { name: displayName(sender) }),
    link: "/notifications",
  });
}

export async function listNotifications(userId: string, limit = 50) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function countUnread(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

// Only the owner of a notification can mark it read (userId is part of the filter).
export async function markRead(userId: string, notificationId: string, now = new Date()) {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: now },
  });
}

export async function markAllRead(userId: string, now = new Date()) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
}
