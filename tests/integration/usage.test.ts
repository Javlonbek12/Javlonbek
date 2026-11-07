import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { collectUsage, usageReport } from "@/modules/ops/usage";
import { addComment } from "@/modules/tasks/comment-service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { addStep, tickStep } from "@/modules/tasks/steps";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

// Usage report for the owner (workflow Server → usage).

describe("usage report", () => {
  beforeEach(resetDb);

  it("counts per person and per module within the period only", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
    const member = await createTestUser("MEMBER", { firstName: "Тестовый сотрудник" });
    const silent = await createTestUser("MEMBER", { firstName: "Тестовый молчун" });

    const task = await createTask(
      owner,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    await createTask(owner, taskInput({ title: "Ещё одна", assigneeId: member.id }), "create");
    await createTask(member, taskInput({ title: "Личная", isPersonal: true }), "draft");
    await addComment(member, task.id, "Тестовый комментарий");
    const step = await addStep(owner, task.id, {
      title: "Шаг",
      responsibleId: null,
      dueDate: null,
    });
    await tickStep(member, step.id, true);
    await changeStatus(member, task.id, "IN_REVIEW");
    await changeStatus(owner, task.id, "DONE");
    await db.aiUsage.create({
      data: {
        userId: owner.id,
        function: "extractTasks",
        model: "test-model",
        inputTokens: 100,
        outputTokens: 20,
      },
    });

    // An old task, outside the period: counted in totals, not in the period.
    const old = new Date("2025-01-10T10:00:00Z");
    const oldTask = await createTask(
      owner,
      taskInput({ title: "Старая задача", assigneeId: silent.id }),
      "create",
    );
    await db.task.update({
      where: { id: oldTask.id },
      data: { createdAt: old, updatedAt: old, statusChangedAt: old },
    });
    await db.activityLog.updateMany({ where: { entityId: oldTask.id }, data: { createdAt: old } });

    const now = new Date();
    const report = await collectUsage(now, 30);
    const by = Object.fromEntries(report.people.map((p) => [p.name, p]));

    expect(by["Тестовый владелец"]).toMatchObject({
      role: "OWNER",
      tasksCreated: 2,
      tasksAssigned: 0,
      tasksDone: 0,
      comments: 0,
      aiCalls: 1,
    });
    expect(by["Тестовый сотрудник"]).toMatchObject({
      tasksCreated: 1,
      tasksAssigned: 2,
      tasksDone: 1,
      comments: 1,
      stepsDone: 1,
    });
    expect(by["Тестовый молчун"]).toMatchObject({ tasksCreated: 0, tasksAssigned: 0 });
    // The silent person's last action is the old task; nothing newer.
    expect(by["Тестовый молчун"].lastActiveAt?.toISOString()).toBe(old.toISOString());
    expect(by["Тестовый владелец"].lastActiveAt!.getTime()).toBeGreaterThan(now.getTime() - 60_000);

    const modules = Object.fromEntries(report.modules.map((m) => [m.label, m]));
    expect(modules["Задачи командные"]).toEqual({ label: "Задачи командные", period: 2, total: 3 });
    expect(modules["Задачи личные"]).toMatchObject({ period: 1, total: 1 });
    expect(modules["Задачи выполнены"]).toMatchObject({ period: 1, total: 1 });
    expect(modules["Шаги задач"]).toMatchObject({ period: 1, total: 1 });
    expect(modules["Комментарии к задачам"]).toMatchObject({ period: 1, total: 1 });
    expect(modules["Встречи"]).toMatchObject({ period: 0, total: 0 });
    expect(report.ai).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20, failed: 0 });
    // Assigning and closing tasks notified people.
    expect(report.notifications.created).toBeGreaterThan(0);

    const text = await usageReport(now, 30);
    expect(text).toContain("Тестовый владелец (владелец)");
    expect(text).toContain("без действий за период: Тестовый молчун");
    expect(text).not.toContain("Тестовая задача");
  });
});
