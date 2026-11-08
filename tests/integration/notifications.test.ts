import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { ForbiddenError } from "@/modules/core/errors";
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  notify,
  openNotification,
  sendTestNotification,
} from "@/modules/core/notifications/service";
import { updateSettings } from "@/modules/core/settings/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { telegramMock } from "@/tests/helpers/telegram";

const event = { type: "role_changed" as const, title: "Тест", body: "Текст", link: "/team" };
const baseSettings = {
  timezone: "Asia/Tashkent",
  telegramEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  disabledTypes: [],
  digestTime: 510,
};

describe("notify", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("saves the notification and sends it to Telegram with a link", async () => {
    const user = await createTestUser("MEMBER");
    const notification = await notify(user.id, event);
    expect(notification?.sentToTelegramAt).not.toBeNull();
    expect(telegramMock).toHaveBeenCalledWith(
      user.botChatId,
      "Тест\nТекст\n\nhttp://localhost:3000/team",
      undefined,
    );
  });

  it("writes the notification in the recipient's language", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, { ...baseSettings, locale: "en" });
    const notification = await notify(user.id, () => ({
      type: "role_changed",
      title: t("notifications.events.roleChangedTitle"),
      body: t("notifications.events.roleChangedBody", { role: t("roles.MANAGER") }),
    }));
    expect(notification).toMatchObject({ title: "Your role changed", body: "New role: Manager." });
  });

  it("does not send to Telegram if the user has not linked the bot", async () => {
    const user = await createTestUser("MEMBER", { botChatId: null });
    const notification = await notify(user.id, event);
    expect(notification).not.toBeNull();
    expect(telegramMock).not.toHaveBeenCalled();
  });

  it("respects 'Telegram off' but still shows it in the app", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, { ...baseSettings, telegramEnabled: false });
    await notify(user.id, event);
    expect(telegramMock).not.toHaveBeenCalled();
    expect(await countUnread(user.id)).toBe(1);
  });

  it("does not send to Telegram during quiet hours", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, {
      ...baseSettings,
      quietHoursStart: 22 * 60,
      quietHoursEnd: 8 * 60,
    });
    const night = new Date("2026-10-02T23:30:00+05:00");
    const notification = await notify(user.id, event, { now: night });
    expect(telegramMock).not.toHaveBeenCalled();
    expect(notification?.sentToTelegramAt).toBeNull();
  });

  it("a type turned off is not sent to Telegram but stays in the app; tests always arrive", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, { ...baseSettings, disabledTypes: ["role_changed"] });
    const kept = await notify(user.id, event);
    expect(kept).not.toBeNull();
    expect(kept!.sentToTelegramAt).toBeNull();
    expect(telegramMock).not.toHaveBeenCalled();
    await notify(user.id, { type: "test", title: "Тест" });
    expect(telegramMock).toHaveBeenCalledTimes(1);
  });

  it("marks only own notifications as read", async () => {
    const a = await createTestUser("MEMBER");
    const b = await createTestUser("MEMBER");
    const forA = await notify(a.id, event);
    await markRead(b.id, forA!.id);
    expect(await countUnread(a.id)).toBe(1);
    await markRead(a.id, forA!.id);
    expect(await countUnread(a.id)).toBe(0);
  });

  it("marks all as read", async () => {
    const user = await createTestUser("MEMBER");
    await notify(user.id, event);
    await notify(user.id, event);
    await markAllRead(user.id);
    expect(await countUnread(user.id)).toBe(0);
  });

  it("opening marks it read and follows only links inside the app", async () => {
    const user = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    const inside = await notify(user.id, event);
    const outside = await notify(user.id, { ...event, link: "//evil.example/x" });
    expect(await openNotification(other.id, inside!.id)).toBeNull();
    expect(await openNotification(user.id, inside!.id)).toBe("/team");
    expect(await openNotification(user.id, outside!.id)).toBe("/notifications");
    expect(await countUnread(user.id)).toBe(0);
  });

  it("lists unread only and pages beyond the first 50", async () => {
    const user = await createTestUser("MEMBER");
    await db.notification.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        userId: user.id,
        type: "test",
        title: `Тест ${i}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
        readAt: i % 2 ? new Date() : null,
      })),
    });
    const first = await listNotifications(user.id);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]!.title).toBe("Тест 52");
    expect(first.more).toBe(true);
    const second = await listNotifications(user.id, { page: 2 });
    expect(second.items.map((n) => n.title)).toEqual(["Тест 2", "Тест 1", "Тест 0"]);
    expect(second.more).toBe(false);
    const unread = await listNotifications(user.id, { unreadOnly: true });
    expect(unread.items).toHaveLength(27);
    expect(unread.items.every((n) => n.readAt === null)).toBe(true);
  });
});

describe("sendTestNotification", () => {
  beforeEach(resetDb);

  it("a MEMBER can send only to themselves", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await expect(sendTestNotification(member, owner.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendTestNotification(member, member.id)).resolves.not.toBeNull();
  });

  it("OWNER can send to anyone; the text names the sender", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
    const member = await createTestUser("MEMBER");
    await sendTestNotification(owner, member.id);
    const notification = await db.notification.findFirstOrThrow({ where: { userId: member.id } });
    expect(notification.body).toContain("Тестовый владелец");
  });
});

describe("monthly AI usage summary", () => {
  beforeEach(resetDb);

  it("sums calls and tokens by user and function for the month", async () => {
    const { getMonthlyUsage } = await import("@/modules/ai/run");
    const user = await createTestUser("OWNER");
    await db.aiUsage.createMany({
      data: [
        {
          userId: user.id,
          function: "extractTasks",
          model: "m",
          inputTokens: 100,
          outputTokens: 10,
          createdAt: new Date("2026-10-02T10:00:00Z"),
        },
        {
          userId: user.id,
          function: "extractTasks",
          model: "m",
          inputTokens: 50,
          outputTokens: 5,
          createdAt: new Date("2026-10-03T10:00:00Z"),
        },
        {
          userId: user.id,
          function: "extractTasks",
          model: "m",
          inputTokens: 999,
          outputTokens: 9,
          createdAt: new Date("2026-09-30T10:00:00Z"),
        },
      ],
    });
    const rows = await getMonthlyUsage(
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(rows).toEqual([
      expect.objectContaining({ fn: "extractTasks", calls: 2, inputTokens: 150, outputTokens: 15 }),
    ]);
  });
});
