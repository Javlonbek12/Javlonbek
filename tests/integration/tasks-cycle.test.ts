import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { parseTaskFilters } from "@/modules/tasks/filters";
import {
  changeStatus,
  createTask,
  getTaskDetail,
  getTodayOverview,
  listTasks,
} from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

const TODAY = "2026-10-02";
const mine = parseTaskFilters({ scope: "mine" });

// Routing v2: a task down the hierarchy starts right away, the assignee does it and hands it in,
// the author accepts. Approval comes in only when the author disposes of someone else's time.
describe("full task cycle", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("owner creates → it starts right away → member works → the author accepts", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");

    const task = await createTask(
      owner,
      taskInput({ title: "Подготовить отчёт", assigneeId: member.id, dueDate: TODAY }),
      "create",
    );
    expect(task).toMatchObject({ status: "APPROVED", reviewerId: owner.id, deciderIds: [] });
    expect((await listTasks(member, mine, TODAY)).map((t) => t.id)).toEqual([task.id]);
    const assigned = await db.notification.findFirst({
      where: { userId: member.id, type: "task_assigned" },
    });
    expect(assigned?.link).toBe(`/tasks/${task.id}`);
    expect((await getTodayOverview(member, TODAY)).dueToday.map((t) => t.id)).toEqual([task.id]);

    // Taking it on and handing it in: the author hears both.
    await changeStatus(member, task.id, "IN_PROGRESS");
    await changeStatus(member, task.id, "IN_REVIEW");
    expect(await db.notification.count({ where: { userId: owner.id, type: "task_status" } })).toBe(
      2,
    );
    expect((await getTodayOverview(owner, TODAY)).waiting.map((t) => t.id)).toEqual([task.id]);

    // The assignee never judges their own work; sending back needs a reason.
    await expect(changeStatus(member, task.id, "DONE")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(changeStatus(owner, task.id, "IN_PROGRESS")).rejects.toMatchObject({
      code: "reason",
    });
    await changeStatus(owner, task.id, "IN_PROGRESS", { reason: "Добавьте итоги за квартал" });
    expect(
      await db.comment.findFirst({ where: { taskId: task.id, authorId: owner.id } }),
    ).toMatchObject({ body: expect.stringContaining("Добавьте итоги за квартал") });
    await changeStatus(member, task.id, "IN_REVIEW");
    const done = await changeStatus(owner, task.id, "DONE");
    expect(done).toMatchObject({ status: "DONE", acceptedById: owner.id });
    expect(done.completedAt).not.toBeNull();

    const history = await db.activityLog.findMany({
      where: { entityId: task.id },
      orderBy: { createdAt: "asc" },
    });
    // Every step is kept, the route start and the reason included.
    expect(history.map((h) => (h.details as { to?: string } | null)?.to ?? h.action)).toEqual([
      "task.created",
      "APPROVED",
      "IN_PROGRESS",
      "IN_REVIEW",
      "IN_PROGRESS",
      "IN_REVIEW",
      "DONE",
    ]);
    expect(history[4]!.details).toMatchObject({ reason: "Добавьте итоги за квартал" });
  });

  it("inside the team a task starts right away; the manager hears it with a cancel button", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const colleague = await createTestUser("MEMBER");
    await db.user.updateMany({
      where: { id: { in: [member.id, colleague.id] } },
      data: { managerId: manager.id },
    });

    const task = await createTask(member, taskInput({ assigneeId: colleague.id }), "create");
    expect(task).toMatchObject({ status: "APPROVED", reviewerId: member.id });
    const notice = await db.notification.findFirst({
      where: { userId: manager.id, type: "task_team" },
    });
    expect(notice?.link).toBe(`/tasks/${task.id}`);
    // The manager may cancel it (their zone), but has nothing to approve.
    await expect(changeStatus(manager, task.id, "CANCELLED")).resolves.toMatchObject({
      status: "CANCELLED",
    });
  });

  it("a task for another team waits for that team's manager; a decline needs a reason", async () => {
    await createTestUser("OWNER");
    const managerA = await createTestUser("MANAGER");
    const managerB = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const foreign = await createTestUser("MEMBER");
    await db.user.update({ where: { id: member.id }, data: { managerId: managerA.id } });
    await db.user.update({ where: { id: foreign.id }, data: { managerId: managerB.id } });
    const task = await createTask(member, taskInput({ assigneeId: foreign.id }), "create");
    expect(task).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [managerB.id] });
    expect(await getTaskDetail(foreign, task.id)).toBeNull();
    expect(
      await db.notification.count({
        where: { userId: managerB.id, type: "task_pending_approval" },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { userId: managerA.id, type: "task_pending_approval" },
      }),
    ).toBe(0);
    await expect(changeStatus(managerA, task.id, "APPROVED")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(changeStatus(managerB, task.id, "DRAFT")).rejects.toMatchObject({
      code: "reason",
    });
    await changeStatus(managerB, task.id, "DRAFT", { reason: "У сотрудника отпуск" });
    const rejected = await db.notification.findFirst({
      where: { userId: member.id, type: "task_status" },
    });
    expect(rejected?.body).toContain("У сотрудника отпуск");
  });

  it("a request to a manager is decided by the manager; «Требует утверждения» goes up", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const colleague = await createTestUser("MEMBER");
    await db.user.updateMany({
      where: { id: { in: [member.id, colleague.id] } },
      data: { managerId: manager.id },
    });

    const up = await createTask(member, taskInput({ assigneeId: manager.id }), "create");
    expect(up).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [manager.id] });
    await expect(changeStatus(manager, up.id, "APPROVED")).resolves.toMatchObject({
      status: "APPROVED",
    });

    const flagged = await createTask(member, taskInput({ assigneeId: colleague.id }), "create", {
      needsApproval: true,
    });
    expect(flagged).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [manager.id] });
  });
});

describe("personal tasks", () => {
  beforeEach(resetDb);

  it("skip approval and are hidden from everyone else, including OWNER", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      member,
      taskInput({ title: "Личное", isPersonal: true }),
      "start",
    );
    expect(task.status).toBe("IN_PROGRESS");
    expect(task.assigneeId).toBe(member.id);

    expect(await getTaskDetail(owner, task.id)).toBeNull();
    expect(
      await listTasks(owner, parseTaskFilters({ scope: "team", status: "all" }), TODAY),
    ).toEqual([]);
    await expect(changeStatus(owner, task.id, "CANCELLED")).rejects.toMatchObject({
      code: "forbidden",
    });

    await changeStatus(member, task.id, "DONE");
    expect(await db.notification.count()).toBe(0);
  });
});
