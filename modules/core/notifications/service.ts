import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { sendTelegramMessage, type TelegramButton } from "@/modules/bot/send";
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
  // Inline buttons for the Telegram message (e.g. approve / return).
  telegramButtons?: TelegramButton[][];
};

type Deps = {
  sendTelegram: (chatId: bigint, text: string, buttons?: TelegramButton[][]) => Promise<boolean>;
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
  if (user.botChatId && settings.telegramEnabled && quiet) {
    // Sent by the scheduler once quiet hours are over.
    return db.notification.update({
      where: { id: notification.id },
      data: { deliverAfterQuiet: true },
    });
  }
  if (user.botChatId && settings.telegramEnabled) {
    const sent = await sendTelegram(
      user.botChatId,
      formatTelegramText(event, getEnv().APP_URL),
      event.telegramButtons,
    );
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

// Telegram delivery of notifications held back by quiet hours (called by the scheduler).
export async function deliverDeferredNotifications(
  now = new Date(),
  deps?: Partial<Pick<Deps, "sendTelegram">>,
) {
  const sendTelegram = deps?.sendTelegram ?? sendTelegramMessage;
  const pending = await db.notification.findMany({
    where: { deliverAfterQuiet: true, sentToTelegramAt: null },
    include: { user: { include: { settings: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  let sent = 0;
  for (const n of pending) {
    const settings = n.user.settings;
    if (!n.user.botChatId || !settings?.telegramEnabled) {
      await db.notification.update({ where: { id: n.id }, data: { deliverAfterQuiet: false } });
      continue;
    }
    if (isInQuietHours(now, settings.timezone, settings.quietHoursStart, settings.quietHoursEnd))
      continue;
    const text = formatTelegramText(
      {
        type: n.type as NotificationType,
        title: n.title,
        body: n.body ?? undefined,
        link: n.link ?? undefined,
      },
      getEnv().APP_URL,
    );
    const ok = await sendTelegram(n.user.botChatId, text);
    await db.notification.update({
      where: { id: n.id },
      data: ok ? { sentToTelegramAt: now, deliverAfterQuiet: false } : { deliverAfterQuiet: false },
    });
    if (ok) sent += 1;
  }
  return sent;
}
