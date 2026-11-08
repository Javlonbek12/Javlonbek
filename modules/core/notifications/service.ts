import { db } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { Prisma } from "@/lib/generated/prisma/client";
import { bold, escapeHtml, openInAppRow } from "@/modules/bot/keyboard";
import { sendTelegramMessage, type KeyboardButton, type TelegramButton } from "@/modules/bot/send";
import { ForbiddenError } from "@/modules/core/errors";
import { canSendTestNotification, type Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

import { settleDecided } from "./decisions";
import { isInQuietHours } from "./quiet-hours";
import type { TestOutcome } from "./test-result";
import { OPTIONAL_NOTIFICATION_TYPES, type NotificationType } from "./types";

export type NotificationEvent = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  // Inline buttons for the Telegram message (e.g. approve / return).
  telegramButtons?: TelegramButton[][];
};

type SendTelegram = (
  chatId: bigint,
  text: string,
  buttons?: KeyboardButton[][],
  options?: { html?: boolean },
) => Promise<boolean>;

type Deps = { sendTelegram: SendTelegram; now: Date };

// The Telegram text (HTML): the title in bold, the body under it. The link goes in the text only
// when it can't be a button («Открыть в приложении», see openInAppRow).
export function formatTelegramText(
  event: Pick<NotificationEvent, "title" | "body" | "link">,
  appUrl: string,
  { linkInText = true }: { linkInText?: boolean } = {},
): string {
  const lines = [bold(event.title)];
  if (event.body) lines.push(escapeHtml(event.body));
  if (event.link && linkInText) lines.push("", escapeHtml(`${appUrl}${event.link}`));
  return lines.join("\n");
}

// The text and the buttons of one notification in Telegram, in the recipient's language.
function telegramMessage(event: NotificationEvent, locale: Locale) {
  const { APP_URL } = getEnv();
  const open = event.link
    ? openInAppRow(APP_URL, event.link, t("bot.openInApp", undefined, locale))
    : null;
  const buttons: KeyboardButton[][] = [...(event.telegramButtons ?? []), ...(open ? [open] : [])];
  return {
    text: formatTelegramText(event, APP_URL, { linkInText: !open }),
    buttons: buttons.length ? buttons : undefined,
  };
}

const localeOf = (settings: { locale: string }): Locale =>
  isLocale(settings.locale) ? settings.locale : "ru";

// Single entry point for notifications: saves it for the UI and sends it to Telegram
// when the user linked the bot, has Telegram enabled, didn't turn this type off
// and is not in quiet hours. A type turned off in Settings still shows in the app: the switch is
// for Telegram only (owner's decision, 2026-11-08). Returns null for an unknown user and for a
// deactivated one: they get nothing, in the app or in Telegram.
// `event` is best given as a function: it is then made in the recipient's language.
export async function notify(
  userId: string,
  eventOrBuild: NotificationEvent | (() => NotificationEvent | Promise<NotificationEvent>),
  deps?: Partial<Deps>,
) {
  const { sendTelegram = sendTelegramMessage, now = new Date() } = deps ?? {};
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.deactivatedAt) return null;
  const settings = await getSettings(userId);
  const locale = localeOf(settings);
  const event =
    typeof eventOrBuild === "function" ? await withLocale(locale, eventOrBuild) : eventOrBuild;

  // The decision buttons are kept: the app shows the decision in the list, and a notification
  // held back by quiet hours keeps them in the morning summary.
  const notification = await db.notification.create({
    data: {
      userId,
      type: event.type,
      title: event.title,
      body: event.body,
      link: event.link,
      buttons: event.telegramButtons?.length
        ? (event.telegramButtons as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });
  const optional = OPTIONAL_NOTIFICATION_TYPES.includes(event.type);
  if (optional && settings.disabledTypes.includes(event.type)) return notification;

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
    const message = telegramMessage(event, locale);
    const sent = await sendTelegram(user.botChatId, message.text, message.buttons, { html: true });
    if (sent) {
      return db.notification.update({
        where: { id: notification.id },
        data: { sentToTelegramAt: now },
      });
    }
  }
  return notification;
}

// «Отправить тестовое уведомление»: it always lands in the app; the answer says honestly whether
// it reached Telegram, and if not, why.
export async function sendTestNotification(
  actor: Actor,
  targetUserId: string,
  deps?: Partial<Deps>,
): Promise<TestOutcome> {
  if (!canSendTestNotification(actor, targetUserId)) throw new ForbiddenError();
  const sender = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const notification = await notify(
    targetUserId,
    () => ({
      type: "test",
      title: t("notifications.events.testTitle"),
      body: t("notifications.events.testBody", { name: displayName(sender) }),
      link: "/notifications",
    }),
    deps,
  );
  if (notification?.sentToTelegramAt) return "sent";
  if (notification?.deliverAfterQuiet) return "quiet";
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target?.botChatId) return "noBot";
  if (!(await getSettings(targetUserId)).telegramEnabled) return "off";
  return "failed";
}

export const NOTIFICATIONS_PAGE = 50;

// One page of the list, newest first; `more` = there is an older page. `types`: only these (a
// group's filter).
export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; page?: number; types?: string[] } = {},
) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const rows = await db.notification.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.types ? { type: { in: options.types } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * NOTIFICATIONS_PAGE,
    take: NOTIFICATIONS_PAGE + 1,
  });
  return { items: rows.slice(0, NOTIFICATIONS_PAGE), more: rows.length > NOTIFICATIONS_PAGE };
}

// «Открыть»: the notification becomes read and its link is where to go. Only a path inside the
// app is followed (a stored link is never sent anywhere else).
export async function openNotification(userId: string, notificationId: string, now = new Date()) {
  const notification = await db.notification.findFirst({ where: { id: notificationId, userId } });
  if (!notification) return null;
  await markRead(userId, notificationId, now);
  const link = notification.link ?? "";
  return link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\")
    ? link
    : "/notifications";
}

// What waits for the person: notifications whose decision was already taken (here, in the bot,
// by someone else) are marked read first (`settle: false` — the caller just did it).
export async function countUnread(userId: string, { settle = true }: { settle?: boolean } = {}) {
  if (settle) await settleDecided(userId);
  return db.notification.count({ where: { userId, readAt: null } });
}

// Only the owner of a notification can mark it read (userId is part of the filter).
export async function markRead(userId: string, notificationId: string, now = new Date()) {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: now },
  });
}

// Several at once (a collapsed group of similar ones).
export async function markManyRead(userId: string, ids: string[], now = new Date()) {
  await db.notification.updateMany({
    where: { id: { in: ids }, userId, readAt: null },
    data: { readAt: now },
  });
}

export async function markAllRead(userId: string, now = new Date()) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
}

// The morning summary keeps at most this many notifications with their buttons.
export const SUMMARY_LIMIT = 10;

type Deferred = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  buttons: unknown;
};

// After quiet hours: several held-back notifications come as one message — numbered lines, and
// under it each one's decision buttons with its number («1 ✅ Утвердить»). The answer to such a
// button comes as a new message («:s»), so the summary keeps the other buttons.
export function morningSummary(items: Deferred[], appUrl: string, locale: Locale) {
  const shown = items.slice(0, SUMMARY_LIMIT);
  const lines = [bold(t("notifications.summary.title", { count: items.length }, locale)), ""];
  const buttons: KeyboardButton[][] = [];
  shown.forEach((item, i) => {
    const n = i + 1;
    const body = item.body ? ` — ${escapeHtml(item.body.split("\n")[0]!.slice(0, 140))}` : "";
    lines.push(`${n}. ${bold(item.title)}${body}`);
    const rows = Array.isArray(item.buttons) ? (item.buttons as TelegramButton[][]) : [];
    for (const row of rows)
      buttons.push(row.map((b) => ({ text: `${n} ${b.text}`, data: `${b.data}:s` })));
  });
  if (items.length > shown.length)
    lines.push("", escapeHtml(t("bot.lists.more", { count: items.length - shown.length }, locale)));
  const open = openInAppRow(appUrl, "/notifications", t("bot.openInApp", undefined, locale));
  if (open) buttons.push(open);
  else lines.push("", escapeHtml(`${appUrl}/notifications`));
  return { text: lines.join("\n"), buttons };
}

// Telegram delivery of notifications held back by quiet hours (called by the scheduler): one
// notification as it is, several as one morning summary.
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
  const byUser = new Map<string, typeof pending>();
  for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
  const { APP_URL } = getEnv();
  let sent = 0;
  for (const items of byUser.values()) {
    const { user } = items[0]!;
    const settings = user.settings;
    const ids = items.map((n) => n.id);
    if (!user.botChatId || !settings?.telegramEnabled || user.deactivatedAt) {
      await db.notification.updateMany({
        where: { id: { in: ids } },
        data: { deliverAfterQuiet: false },
      });
      continue;
    }
    if (isInQuietHours(now, settings.timezone, settings.quietHoursStart, settings.quietHoursEnd))
      continue;
    const locale = localeOf(settings);
    const message =
      items.length === 1
        ? telegramMessage(
            {
              type: items[0]!.type as NotificationType,
              title: items[0]!.title,
              body: items[0]!.body ?? undefined,
              link: items[0]!.link ?? undefined,
              telegramButtons: Array.isArray(items[0]!.buttons)
                ? (items[0]!.buttons as TelegramButton[][])
                : undefined,
            },
            locale,
          )
        : morningSummary(items, APP_URL, locale);
    const ok = await sendTelegram(user.botChatId, message.text, message.buttons, { html: true });
    await db.notification.updateMany({
      where: { id: { in: ids } },
      data: ok ? { sentToTelegramAt: now, deliverAfterQuiet: false } : { deliverAfterQuiet: false },
    });
    if (ok) sent += items.length;
  }
  return sent;
}
