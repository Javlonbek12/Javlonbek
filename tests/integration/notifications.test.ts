import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError } from "@/modules/core/errors";
import {
  countUnread,
  markAllRead,
  markRead,
  notify,
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
    );
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

  it("skips types the user turned off, but test notifications always arrive", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, { ...baseSettings, disabledTypes: ["role_changed"] });
    expect(await notify(user.id, event)).toBeNull();
    expect(await notify(user.id, { type: "test", title: "Тест" })).not.toBeNull();
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
