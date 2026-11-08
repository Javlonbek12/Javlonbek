import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { completeTask } from "@/modules/tasks/quick-actions";
import {
  changeStatus,
  createTask,
  getTodayOverview,
  LIST_LIMIT,
  listBoardTasks,
  reopenTask,
  undoQuickClose,
} from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

const hoursLater = (hours: number) => new Date(Date.now() + hours * 3_600_000);

describe("«Вернуть в работу» (within 24 hours of closing)", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("the author or whoever controls the task returns it; the assignee hears it", async () => {
    const owner = await createTestUser("OWNER");
    const author = await createTestUser("MEMBER");
    const worker = await createTestUser("MEMBER");
    const task = await createTask(author, taskInput({ assigneeId: worker.id }), "create");
    await changeStatus(worker, task.id, "IN_PROGRESS");
    await changeStatus(worker, task.id, "IN_REVIEW");
    await changeStatus(author, task.id, "DONE");

    // The assignee can't reopen what was accepted.
    await expect(reopenTask(worker, task.id)).rejects.toMatchObject({ code: "forbidden" });
    const back = await reopenTask(author, task.id);
    expect(back).toMatchObject({ status: "IN_PROGRESS", completedAt: null, acceptedById: null });
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.reopened" } }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { userId: worker.id, title: "Задача снова в работе" },
      }),
    ).toBe(1);

    // Cancelled: the owner (who controls every team task) brings it back too — but not after 24 h.
    await changeStatus(owner, task.id, "CANCELLED");
    await expect(reopenTask(owner, task.id, hoursLater(25))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(reopenTask(owner, task.id, hoursLater(23))).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
  });

  it("a team task cancelled before it was ever approved stays cancelled; a personal one returns", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const waiting = await createTask(member, taskInput({ assigneeId: member.id }), "create", {
      needsApproval: true,
    });
    await changeStatus(member, waiting.id, "CANCELLED");
    await expect(reopenTask(member, waiting.id)).rejects.toMatchObject({ code: "forbidden" });

    const personal = await createTask(owner, taskInput({ isPersonal: true }), "start");
    await changeStatus(owner, personal.id, "CANCELLED");
    await expect(reopenTask(owner, personal.id)).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
  });

  it("undo after the round button: handed-in work comes back, a done task reopens", async () => {
    const owner = await createTestUser("OWNER");
    const worker = await createTestUser("MEMBER");
    const task = await createTask(owner, taskInput({ assigneeId: worker.id }), "create");
    expect(await completeTask(worker, task.id)).toBe("IN_REVIEW");
    await expect(undoQuickClose(worker, task.id)).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
    expect(await completeTask(worker, task.id)).toBe("IN_REVIEW");
    expect(await completeTask(owner, task.id)).toBe("DONE");
    await expect(undoQuickClose(owner, task.id)).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
  });
});

describe("handed-in work and the board", () => {
  beforeEach(resetDb);

  it("handed-in work is not the assignee's overdue any more", async () => {
    const owner = await createTestUser("OWNER");
    const worker = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ assigneeId: worker.id, dueDate: "2026-10-01" }),
      "create",
    );
    await changeStatus(worker, task.id, "IN_PROGRESS");
    expect((await getTodayOverview(worker, "2026-10-05")).overdue).toHaveLength(1);
    await changeStatus(worker, task.id, "IN_REVIEW");
    expect((await getTodayOverview(worker, "2026-10-05")).overdue).toHaveLength(0);
  });

  it("the board shows every open task however long the history, and done ones of 30 days", async () => {
    const owner = await createTestUser("OWNER");
    const today = "2026-11-08";
    // A long history of done tasks with early due dates…
    const old = new Date("2026-01-01T00:00:00Z");
    await db.task.createMany({
      data: Array.from({ length: LIST_LIMIT + 5 }, (_, i) => ({
        title: `Старая ${i}`,
        creatorId: owner.id,
        assigneeId: owner.id,
        isPersonal: true,
        status: "DONE" as const,
        dueDate: old,
        completedAt: i < 3 ? new Date("2026-11-01T10:00:00Z") : new Date("2026-02-01T10:00:00Z"),
      })),
    });
    // …and open work due later: it is still on the board.
    const open = await createTask(
      owner,
      taskInput({ title: "Открытая", isPersonal: true, dueDate: "2026-12-01" }),
      "start",
    );
    const { tasks, cut } = await listBoardTasks(owner, parseTaskFilters({ scope: "mine" }), today);
    expect(tasks.map((t) => t.id)).toContain(open.id);
    // Done in the last 30 days only.
    expect(tasks.filter((t) => t.status === "DONE")).toHaveLength(3);
    expect(cut).toBe(false);
  });
});
