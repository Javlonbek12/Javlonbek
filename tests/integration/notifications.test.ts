import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { ForbiddenError } from "@/modules/core/errors";
import { decisionOf, inAppDecisions, settleDecided } from "@/modules/core/notifications/decisions";
import {
  countUnread,
  deliverDeferredNotifications,
  formatTelegramText,
  listNotifications,
  markAllRead,
  markRead,
  morningSummary,
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

  it("saves the notification and sends it to Telegram: a bold title, the link", async () => {
    const user = await createTestUser("MEMBER");
    const notification = await notify(user.id, event);
    expect(notification?.sentToTelegramAt).not.toBeNull();
    // Tests run on http://localhost, which Telegram doesn't take for a link button: the link
    // stays in the text.
    expect(telegramMock).toHaveBeenCalledWith(
      user.botChatId,
      "<b>Тест</b>\nТекст\n\nhttp://localhost:3000/team",
      undefined,
      { html: true },
    );
  });

  it("formats the text for Telegram's HTML and leaves out a link that is a button", () => {
    const text = formatTelegramText(
      { title: "A < B & C", body: "<i>не тег</i>", link: "/x" },
      "https://example.test",
      { linkInText: false },
    );
    expect(text).toBe("<b>A &lt; B &amp; C</b>\n&lt;i&gt;не тег&lt;/i&gt;");
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

  it("says honestly whether it reached Telegram, and if not, why", async () => {
    const linked = await createTestUser("MEMBER");
    expect(await sendTestNotification(linked, linked.id)).toBe("sent");

    const noBot = await createTestUser("MEMBER", { botChatId: null });
    expect(await sendTestNotification(noBot, noBot.id)).toBe("noBot");
    expect(await countUnread(noBot.id)).toBe(1);

    const off = await createTestUser("MEMBER");
    await updateSettings(off.id, { ...baseSettings, telegramEnabled: false });
    expect(await sendTestNotification(off, off.id)).toBe("off");

    const quiet = await createTestUser("MEMBER");
    await updateSettings(quiet.id, { ...baseSettings, quietHoursStart: 0, quietHoursEnd: 1439 });
    expect(await sendTestNotification(quiet, quiet.id)).toBe("quiet");

    const failing = await createTestUser("MEMBER");
    const sendTelegram = async () => false;
    expect(await sendTestNotification(failing, failing.id, { sendTelegram })).toBe("failed");
  });
});

describe("decisions in notifications", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("keeps the decision buttons; a decided one reads itself", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await db.task.create({
      data: {
        title: "Тест",
        creatorId: member.id,
        assigneeId: member.id,
        status: "PENDING_APPROVAL",
        deciderIds: [owner.id],
      },
    });
    const buttons = [[{ text: "✅ Утвердить", data: `t:${task.id}:A` }]];
    const asks = await notify(owner.id, {
      type: "task_pending_approval",
      title: "Тест",
      link: `/tasks/${task.id}`,
      telegramButtons: buttons,
    });
    expect(asks?.buttons).toEqual(buttons);
    const pending = await settleDecided(owner.id);
    expect(pending.get(asks!.id)).toEqual({ kind: "approve", taskId: task.id });
    expect(await inAppDecisions(owner, pending)).toEqual(
      new Map([[asks!.id, { kind: "approve", taskId: task.id, takeOn: false }]]),
    );

    // Approved elsewhere (the bot, the task page): nothing waits any more.
    await db.task.update({ where: { id: task.id }, data: { status: "APPROVED" } });
    expect(await countUnread(owner.id)).toBe(0);
    expect((await settleDecided(owner.id)).size).toBe(0);
  });

  it("older notifications without buttons: decided by their type and link", () => {
    expect(decisionOf({ type: "task_delete_request", link: "/tasks/abc", buttons: null })).toEqual({
      kind: "delete",
      taskId: "abc",
    });
    expect(decisionOf({ type: "content_review", link: "/content/p1", buttons: null })).toEqual({
      kind: "postReview",
      postId: "p1",
    });
    expect(decisionOf({ type: "task_status", link: "/tasks/abc", buttons: null })).toBeNull();
    expect(
      decisionOf({
        type: "task_team",
        link: "/tasks/abc",
        buttons: [[{ text: "✖️", data: "t:abc:C" }]],
      }),
    ).toBeNull();
  });
});

describe("after quiet hours", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("several held-back notifications come as one summary that keeps the buttons", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(user.id, {
      ...baseSettings,
      quietHoursStart: 22 * 60,
      quietHoursEnd: 8 * 60,
    });
    const night = new Date("2026-10-01T18:00:00Z"); // 23:00 in Tashkent
    await notify(user.id, { type: "test", title: "Первое" }, { now: night });
    await notify(
      user.id,
      {
        type: "task_pending_approval",
        title: "Второе <важное>",
        telegramButtons: [[{ text: "✅ Утвердить", data: "t:abc:A" }]],
      },
      { now: night },
    );
    expect(telegramMock).not.toHaveBeenCalled();

    expect(await deliverDeferredNotifications(new Date("2026-10-02T03:01:00Z"))).toBe(2);
    expect(telegramMock).toHaveBeenCalledTimes(1);
    const [chat, text, buttons, options] = telegramMock.mock.calls[0]!;
    expect(chat).toBe(user.botChatId);
    expect(text).toContain("1. <b>Первое</b>");
    expect(text).toContain("2. <b>Второе &lt;важное&gt;</b>");
    // The answer to «2 ✅ Утвердить» comes as a new message («:s»): the summary keeps the rest.
    expect(buttons).toEqual([[{ text: "2 ✅ Утвердить", data: "t:abc:A:s" }]]);
    expect(options).toEqual({ html: true });
    expect(await deliverDeferredNotifications(new Date("2026-10-02T03:02:00Z"))).toBe(0);
  });

  it("the link becomes an «Открыть в приложении» button on a real (https) address", () => {
    const summary = morningSummary(
      [{ id: "1", title: "Тест", body: null, link: null, buttons: null }],
      "https://example.test",
      "ru",
    );
    expect(summary.buttons).toEqual([
      [{ text: "Открыть в приложении", url: "https://example.test/notifications" }],
    ]);
    expect(summary.text).not.toContain("https://");
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
