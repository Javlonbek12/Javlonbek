import { beforeEach, describe, expect, it } from "vitest";

import { formatDay } from "@/lib/dates";
import { db } from "@/lib/db";
import type { DigestData } from "@/modules/ai/prompts";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import { notify } from "@/modules/core/notifications/service";
import { updateSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { digestTemplate, type DigestWriter } from "@/modules/scheduler/digest";
import { claim, LAST_TICK_KEY, runSchedulerTick } from "@/modules/scheduler/tick";
import { requestTaskDeletion } from "@/modules/tasks/delete-service";
import { changeStatus, countDecisions, createTask } from "@/modules/tasks/service";
import { startTimer } from "@/modules/tasks/time";
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
      "create",
    );
    // A draft (not approved) is never reminded about.
    await createTask(
      owner,
      taskInput({ title: "Черновик", assigneeId: member.id, dueDate: "2026-10-03" }),
    );

    // A Monday task is reminded about on Friday too: the reminder covers the weekend.
    await createTask(
      owner,
      taskInput({ title: "Понедельник", assigneeId: member.id, dueDate: "2026-10-05" }),
      "create",
    );

    // 2 Oct 2026 is a Friday: the reminder comes at 16:30.
    await runSchedulerTick(new Date("2026-10-02T11:29:00Z"), { writeDigest }); // 16:29
    expect(await count(member.id, "due_reminder")).toBe(0);
    await runSchedulerTick(new Date("2026-10-02T11:30:00Z"), { writeDigest }); // 16:30
    await runSchedulerTick(new Date("2026-10-02T12:30:00Z"), { writeDigest });
    expect(await count(member.id, "due_reminder")).toBe(2);
    // Nobody has started them yet: the author hears it too.
    expect(await count(owner.id, "due_reminder")).toBe(2);
  });

  it("on weekdays reminds at 17:00 about tomorrow only", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await updateSettings(member.id, settings("Asia/Tashkent"));
    const task = await createTask(
      owner,
      taskInput({ title: "Отчёт", assigneeId: member.id, dueDate: "2026-10-01" }),
      "create",
    );
    await changeStatus(member, task.id, "IN_PROGRESS");
    await runSchedulerTick(new Date("2026-09-30T11:59:00Z"), { writeDigest }); // Wed 16:59
    expect(await count(member.id, "due_reminder")).toBe(0);
    await runSchedulerTick(new Date("2026-09-30T12:00:00Z"), { writeDigest }); // 17:00
    expect(await count(member.id, "due_reminder")).toBe(1);
    // Already started: the author is not reminded.
    expect(await count(owner.id, "due_reminder")).toBe(0);
  });

  it("tells the assignee and the creator about an overdue task, once", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await createTask(
      owner,
      taskInput({ title: "Просрочка", assigneeId: member.id, dueDate: "2026-10-01" }),
      "create",
    );

    // With the morning digest on, overdue tasks are listed there, not sent one by one.
    await runSchedulerTick(new Date("2026-10-02T04:00:00Z"), { writeDigest }); // 09:00 Tashkent
    expect(await count(member.id, "overdue")).toBe(0);

    // Digest off: a separate notice, once a day, to the assignee and the author.
    for (const user of [owner, member])
      await updateSettings(user.id, settings("Asia/Tashkent", { disabledTypes: ["digest"] }));
    await runSchedulerTick(new Date("2026-10-02T05:00:00Z"), { writeDigest });
    await runSchedulerTick(new Date("2026-10-02T06:00:00Z"), { writeDigest });
    expect(await count(member.id, "overdue")).toBe(1);
    expect(await count(owner.id, "overdue")).toBe(1);
    // And again the next day while it stays overdue.
    await runSchedulerTick(new Date("2026-10-03T04:00:00Z"), { writeDigest });
    expect(await count(member.id, "overdue")).toBe(2);
  });

  it("the digest tells the author what is overdue at the assignees, and all that waits for them", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    for (const user of [owner, member]) await updateSettings(user.id, settings("Asia/Tashkent"));
    await createTask(
      owner,
      taskInput({ title: "Отчёт исполнителя", assigneeId: member.id, dueDate: "2026-10-01" }),
      "create",
    );
    // Handed in: it waits for acceptance — not «overdue» for anyone, but a decision for the author.
    const handedIn = await createTask(
      owner,
      taskInput({ title: "Сдана", assigneeId: member.id, dueDate: "2026-09-30" }),
      "create",
    );
    await changeStatus(member, handedIn.id, "IN_PROGRESS");
    await changeStatus(member, handedIn.id, "IN_REVIEW");
    // A request to delete (the assignee asks): a decision for the owner too.
    const doomed = await createTask(
      owner,
      taskInput({ title: "Дубль", assigneeId: member.id }),
      "create",
    );
    await changeStatus(member, doomed.id, "IN_PROGRESS");
    await requestTaskDeletion(member, doomed.id, "Дубль");
    // Someone else's task: not the owner's to answer for in the digest.
    await createTask(
      member,
      taskInput({ title: "Чужая", assigneeId: other.id, dueDate: "2026-09-29" }),
      "create",
    );

    const seen = new Map<string, DigestData>();
    const capture: DigestWriter = async (user, _today, data) => {
      seen.set(user.id, data);
      return digestTemplate(data);
    };
    await runSchedulerTick(new Date("2026-10-02T03:35:00Z"), { writeDigest: capture });

    const forOwner = seen.get(owner.id)!;
    expect(forOwner.overdueAtDoers.map((x) => [x.title, x.assignee])).toEqual([
      ["Отчёт исполнителя", displayName(member)],
    ]);
    // The same list as «Ждут решения» (its badge counts 2 too).
    expect(forOwner.waitingForDecision.map((x) => x.title).sort()).toEqual(["Дубль", "Сдана"]);
    expect(await countDecisions(await withAccess(owner))).toBe(2);
    const body = (
      await db.notification.findFirstOrThrow({ where: { userId: owner.id, type: "digest" } })
    ).body!;
    expect(body).toContain("⏰ Просрочены у исполнителей: 1");

    // The assignee: their own overdue, without the work they handed in.
    expect(seen.get(member.id)!.overdue.map((x) => x.title)).toEqual(["Отчёт исполнителя"]);
  });

  it("the digest reminds about a timer left running since yesterday", async () => {
    const owner = await createTestUser("OWNER");
    await updateSettings(owner.id, settings("Asia/Tashkent"));
    const task = await createTask(owner, taskInput({ title: "Звонки", isPersonal: true }), "start");
    await startTimer(owner, task.id, new Date("2026-10-01T12:00:00Z"));
    const seen: DigestData[] = [];
    const capture: DigestWriter = async (_user, _today, data) => {
      seen.push(data);
      return "Текст";
    };
    await runSchedulerTick(new Date("2026-10-02T03:35:00Z"), { writeDigest: capture });
    expect(seen[0]?.runningTimer).toEqual({ title: "Звонки", since: formatDay("2026-10-01") });
  });

  it("work handed in gets no due or overdue reminders for the assignee", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await updateSettings(member.id, settings("Asia/Tashkent", { disabledTypes: ["digest"] }));
    for (const due of ["2026-10-01", "2026-10-03"]) {
      const task = await createTask(
        owner,
        taskInput({ title: `Сдана ${due}`, assigneeId: member.id, dueDate: due }),
        "create",
      );
      await changeStatus(member, task.id, "IN_PROGRESS");
      await changeStatus(member, task.id, "IN_REVIEW");
    }
    await runSchedulerTick(new Date("2026-10-02T05:00:00Z"), { writeDigest }); // 10:00, overdue
    await runSchedulerTick(new Date("2026-10-02T11:30:00Z"), { writeDigest }); // Fri 16:30, due
    expect(await count(member.id, "overdue")).toBe(0);
    expect(await count(member.id, "due_reminder")).toBe(0);
  });

  it("sends the Friday team summary to the owner and to managers who see all team tasks", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    // The summary covers the whole team, so it needs the "all tasks" setting for managers.
    await saveRoleConfig(owner, {
      MANAGER: { modules: ["meetings"], taskScope: "all" },
      MEMBER: { modules: [], taskScope: "own" },
    });
    await createTask(owner, taskInput({ assigneeId: member.id, dueDate: "2026-09-30" }), "create");

    await runSchedulerTick(new Date("2026-10-02T12:00:00Z"), { writeDigest }); // Friday 17:00
    await runSchedulerTick(new Date("2026-10-02T12:01:00Z"), { writeDigest });
    expect(await count(owner.id, "weekly_summary")).toBe(1);
    expect(await count(manager.id, "weekly_summary")).toBe(1);
    expect(await count(member.id, "weekly_summary")).toBe(0);
    const summary = await db.notification.findFirstOrThrow({
      where: { userId: owner.id, type: "weekly_summary" },
    });
    expect(summary.body).toContain("🔥 Просрочено сейчас: 1");

    // With the default "own people" setting the manager gets the summary of their own zone.
    await saveRoleConfig(owner, DEFAULT_ROLE_CONFIG);
    await runSchedulerTick(new Date("2026-10-09T12:00:00Z"), { writeDigest });
    expect(await count(owner.id, "weekly_summary")).toBe(2);
    expect(await count(manager.id, "weekly_summary")).toBe(2);
    const zone = await db.notification.findFirstOrThrow({
      where: { userId: manager.id, type: "weekly_summary" },
      orderBy: { createdAt: "desc" },
    });
    expect(zone.body).not.toContain("Просрочено сейчас: 1");

    // "Only own tasks": no summary at all.
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MANAGER: { ...DEFAULT_ROLE_CONFIG.MANAGER, taskScope: "own" },
    });
    await runSchedulerTick(new Date("2026-10-16T12:00:00Z"), { writeDigest });
    expect(await count(manager.id, "weekly_summary")).toBe(2);
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
  it("lists overdue first, then overdue at the assignees, today, waiting, tomorrow, the timer", () => {
    const text = digestTemplate({
      overdue: [{ title: "Старое", dueDate: "2026-09-30" }],
      overdueAtDoers: [{ title: "Отчёт Азиза", dueDate: "2026-09-29", assignee: "Азиз" }],
      dueToday: [{ title: "Сегодня" }],
      waitingForDecision: [{ title: "Утвердить", status: "На утверждении" }],
      dueTomorrow: [],
      runningTimer: { title: "Звонки", since: "1 окт." },
    });
    expect(text.split("\n")).toEqual([
      "🔥 Просрочено: 1",
      `  • Старое (${formatDay("2026-09-30")})`,
      "⏰ Просрочены у исполнителей: 1",
      `  • Отчёт Азиза — Азиз (${formatDay("2026-09-29")})`,
      "📋 На сегодня: 1",
      "  • Сегодня",
      "⏳ Ждут вашего решения: 1",
      "  • Утвердить — На утверждении",
      "⏱ Таймер идёт с 1 окт.: «Звонки». Если работа закончена — остановите его.",
    ]);
  });
});
