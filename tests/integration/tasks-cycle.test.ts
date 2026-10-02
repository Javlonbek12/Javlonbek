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

// Stage 2 "done" scenario: create a task for an employee, the employee sees it only after
// approval, does it, and the creator accepts it.
describe("full task cycle", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("member creates → manager approves → member works → creator accepts", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");

    // OWNER creates a task for the member and sends it for approval.
    const task = await createTask(
      owner,
      taskInput({ title: "Подготовить отчёт", assigneeId: member.id, dueDate: TODAY }),
      "submit",
    );
    expect(task.status).toBe("PENDING_APPROVAL");

    // The member does not see it yet.
    expect(await listTasks(member, mine, TODAY)).toEqual([]);
    expect(await getTaskDetail(member, task.id)).toBeNull();

    // OWNER approves: now the member sees it and is notified.
    await changeStatus(owner, task.id, "APPROVED");
    expect((await listTasks(member, mine, TODAY)).map((t) => t.id)).toEqual([task.id]);
    const assigned = await db.notification.findFirst({
      where: { userId: member.id, type: "task_assigned" },
    });
    expect(assigned?.link).toBe(`/tasks/${task.id}`);
    expect((await getTodayOverview(member, TODAY)).dueToday.map((t) => t.id)).toEqual([task.id]);

    // The member does the work and hands it in.
    await changeStatus(member, task.id, "IN_PROGRESS");
    await changeStatus(member, task.id, "IN_REVIEW");
    expect(await db.notification.count({ where: { userId: owner.id, type: "task_status" } })).toBe(
      1,
    );
    expect((await getTodayOverview(owner, TODAY)).waiting.map((t) => t.id)).toEqual([task.id]);

    // The member cannot accept their own work; OWNER accepts.
    await expect(changeStatus(member, task.id, "DONE")).rejects.toMatchObject({
      code: "forbidden",
    });
    const done = await changeStatus(owner, task.id, "DONE");
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();

    // History keeps every step.
    const history = await db.activityLog.findMany({
      where: { entityId: task.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.action)).toEqual([
      "task.created",
      "task.status_changed",
      "task.status_changed",
      "task.status_changed",
      "task.status_changed",
      "task.status_changed",
    ]);
  });

  it("a MEMBER's team task needs a MANAGER to approve it", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const colleague = await createTestUser("MEMBER");

    const task = await createTask(member, taskInput({ assigneeId: colleague.id }), "submit");
    await expect(changeStatus(member, task.id, "APPROVED")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await db.notification.count({ where: { userId: manager.id, type: "task_pending_approval" } }),
    ).toBe(1);
    await expect(changeStatus(manager, task.id, "APPROVED")).resolves.toMatchObject({
      status: "APPROVED",
    });
  });

  it("a MEMBER cannot create an already approved team task", async () => {
    await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await expect(
      createTask(member, taskInput({ assigneeId: member.id }), "approve"),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    // Nothing is saved when the first step is not allowed.
    expect(await db.task.count()).toBe(0);
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
