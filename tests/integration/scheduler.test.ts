import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { notify } from "@/modules/core/notifications/service";
import { updateSettings } from "@/modules/core/settings/service";
import { digestTemplate } from "@/modules/scheduler/digest";
import { claim, LAST_TICK_KEY, runSchedulerTick } from "@/modules/scheduler/tick";
import { createTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

const settings = (timezone: string, extra: Partial<Parameters<typeof updateSettings>[1]> = {}) => ({
  timezone,
  telegramEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  disabledTypes: [],
  digestTime: 510,
  ...extra,
});
const writeDigest = async () => "Текст дайджеста";
const count = (userId: string, type: string) => db.notification.count({ where: { userId, type } });

describe("scheduler", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("sends the morning digest at 08:30 local time in each timezone, once", async () => {
    const tashkent = await createTestUser("OWNER");
    const moscow = await createTestUser("MEMBER");
    await updateSettings(tashkent.id, settings("Asia/Tashkent"));
    await updateSettings(moscow.id, settings("Europe/Moscow"));
    for (const user of [tashkent, moscow]) {
      await createTask(user, taskInput({ title: "Дело", isPersonal: true, dueDate: "2026-10-02" }));
    }

    // 03:35 UTC = 08:35 in Tashkent, 06:35 in Moscow.
    await runSchedulerTick(new Date("2026-10-02T03:35:00Z"), { writeDigest });
    expect(await count(tashkent.id, "digest")).toBe(1);
    expect(await count(moscow.id, "digest")).toBe(0);

    // The next minute: no duplicate for Tashkent.
    await runSchedulerTick(new Date("2026-10-02T03:36:00Z"), { writeDigest });
    expect(await count(tashkent.id, "digest")).toBe(1);

    // 05:31 UTC = 08:31 in Moscow.
    await runSchedulerTick(new Date("2026-10-02T05:31:00Z"), { writeDigest });
    expect(await count(moscow.id, "digest")).toBe(1);
    expect(await count(tashkent.id, "digest")).toBe(1);

    const digest = await db.notification.findFirstOrThrow({
      where: { userId: tashkent.id, type: "digest" },
    });
    expect(digest.body).toBe("Текст дайджеста");
    expect(await db.systemState.findUnique({ where: { key: LAST_TICK_KEY } })).not.toBeNull();
  });

  it("does not send an empty digest", async () => {
    const user = await createTestUser("OWNER");
    await updateSettings(user.id, settings("Asia/Tashkent"));
    await runSchedulerTick(new Date("2026-10-02T03:35:00Z"), { writeDigest });
    expect(await count(user.id, "digest")).toBe(0);
  });

  it("reminds the day before the due date at 17:00, once", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await updateSettings(member.id, settings("Asia/Tashkent"));
    await createTask(
      owner,
      taskInput({ title: "Отчёт", assigneeId: member.id, dueDate: "2026-10-03" }),
      "approve",
    );
    // A draft (not approved) is never reminded about.
    await createTask(
      owner,
      taskInput({ title: "Черновик", assigneeId: member.id, dueDate: "2026-10-03" }),
    );

    await runSchedulerTick(new Date("2026-10-02T11:59:00Z"), { writeDigest }); // 16:59
    expect(await count(member.id, "due_reminder")).toBe(0);
    await runSchedulerTick(new Date("2026-10-02T12:00:00Z"), { writeDigest }); // 17:00
    await runSchedulerTick(new Date("2026-10-02T12:30:00Z"), { writeDigest });
    expect(await count(member.id, "due_reminder")).toBe(1);
  });

  it("tells the assignee and the creator about an overdue task, once", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await createTask(
      owner,
      taskInput({ title: "Просрочка", assigneeId: member.id, dueDate: "2026-10-01" }),
      "approve",
    );

    await runSchedulerTick(new Date("2026-10-02T04:00:00Z"), { writeDigest }); // 09:00 Tashkent
    await runSchedulerTick(new Date("2026-10-02T05:00:00Z"), { writeDigest });
    expect(await count(member.id, "overdue")).toBe(1);
    expect(await count(owner.id, "overdue")).toBe(1);
  });

  it("sends the Friday team summary to managers and the owner only", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    await createTask(owner, taskInput({ assigneeId: member.id, dueDate: "2026-09-30" }), "approve");

    await runSchedulerTick(new Date("2026-10-02T12:00:00Z"), { writeDigest }); // Friday 17:00
    await runSchedulerTick(new Date("2026-10-02T12:01:00Z"), { writeDigest });
    expect(await count(owner.id, "weekly_summary")).toBe(1);
    expect(await count(manager.id, "weekly_summary")).toBe(1);
    expect(await count(member.id, "weekly_summary")).toBe(0);
    const summary = await db.notification.findFirstOrThrow({
      where: { userId: owner.id, type: "weekly_summary" },
    });
    expect(summary.body).toContain("🔥 Просрочено сейчас: 1");
  });

  it("respects «turn off this type»", async () => {
    const owner = await createTestUser("OWNER");
    await updateSettings(owner.id, settings("Asia/Tashkent", { disabledTypes: ["overdue"] }));
    await createTask(owner, taskInput({ isPersonal: true, dueDate: "2026-10-01" }));
    await runSchedulerTick(new Date("2026-10-02T04:00:00Z"), { writeDigest });
    expect(await count(owner.id, "overdue")).toBe(0);
  });

  it("holds Telegram messages during quiet hours and delivers them afterwards", async () => {
    const user = await createTestUser("MEMBER");
    await updateSettings(
      user.id,
      settings("Asia/Tashkent", { quietHoursStart: 22 * 60, quietHoursEnd: 8 * 60 }),
    );
    await notify(
      user.id,
      { type: "test", title: "Ночное" },
      { now: new Date("2026-10-01T18:00:00Z") },
    ); // 23:00
    expect(telegramMock).not.toHaveBeenCalled();

    await runSchedulerTick(new Date("2026-10-01T22:00:00Z"), { writeDigest }); // 03:00 — still quiet
    expect(telegramMock).not.toHaveBeenCalled();

    await runSchedulerTick(new Date("2026-10-02T03:01:00Z"), { writeDigest }); // 08:01
    expect(telegramMock).toHaveBeenCalledTimes(1);
    await runSchedulerTick(new Date("2026-10-02T03:02:00Z"), { writeDigest });
    expect(telegramMock).toHaveBeenCalledTimes(1);
  });

  it("claim() lets only one of two parallel ticks send", async () => {
    const user = await createTestUser("OWNER");
    const results = await Promise.all([
      claim(user.id, "digest", "2026-10-02"),
      claim(user.id, "digest", "2026-10-02"),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });
});

describe("digest template (fallback without AI)", () => {
  it("lists overdue first, then today, waiting and tomorrow", () => {
    const text = digestTemplate({
      overdue: [{ title: "Старое", dueDate: "2026-09-30" }],
      dueToday: [{ title: "Сегодня" }],
      waitingForDecision: [{ title: "Утвердить", status: "На утверждении" }],
      dueTomorrow: [],
    });
    expect(text.split("\n")).toEqual([
      "🔥 Просрочено: 1",
      "  • Старое (30 сент.)",
      "📋 На сегодня: 1",
      "  • Сегодня",
      "⏳ Ждут вашего решения: 1",
      "  • Утвердить — На утверждении",
    ]);
  });
});
