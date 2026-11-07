import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addCoAssignee } from "@/modules/tasks/co-assignees";
import { deleteTask, getDeleteMode, restoreTask } from "@/modules/tasks/delete-service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { addTime, getTaskTime, removeTimeEntry, startTimer, stopTimer } from "@/modules/tasks/time";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

// Time spent on a task (BACKLOG item 24, step 5).

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 9, 6, 0) + minutes * 60_000);

async function team() {
  const manager = await createTestUser("MANAGER");
  const worker = await createTestUser("MEMBER");
  const helper = await createTestUser("MEMBER");
  const stranger = await createTestUser("MEMBER");
  await db.user.updateMany({
    where: { id: { in: [worker.id, helper.id] } },
    data: { managerId: manager.id },
  });
  return { manager, worker, helper, stranger };
}

describe("task time", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("a timer takes the task into work, runs one at a time and counts whole minutes", async () => {
    const { manager, worker } = await team();
    const task = await createTask(manager, taskInput({ assigneeId: worker.id }), "create");
    const other = await createTask(manager, taskInput({ assigneeId: worker.id }), "create");
    expect(task.status).toBe("APPROVED");

    expect(await startTimer(worker, task.id, at(0))).toEqual({ started: true });
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      "IN_PROGRESS",
    );
    // Starting it again changes nothing; on another task the first one stops.
    expect(await startTimer(worker, task.id, at(5))).toEqual({ started: false });
    await startTimer(worker, other.id, at(25));
    expect(await stopTimer(worker, other.id, at(25.4))).toBe(0); // under a minute: nothing kept
    const view = await getTaskTime(task, worker);
    expect(view).toMatchObject({ totalMinutes: 25, running: null, canTrack: true });
    expect(await db.taskTimeEntry.count({ where: { taskId: other.id } })).toBe(0);
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.time_logged" } }),
    ).toBe(1);

    // A timer forgotten overnight counts 12 hours at most.
    await startTimer(worker, task.id, at(60));
    expect(await stopTimer(worker, task.id, at(60 + 20 * 60))).toBe(12 * 60);
    expect((await getTaskTime(task, worker)).totalMinutes).toBe(25 + 12 * 60);
  });

  it("time by hand, removing one's own, and who may track", async () => {
    const { manager, worker, helper, stranger } = await team();
    const task = await createTask(manager, taskInput({ assigneeId: worker.id }), "create");
    await addCoAssignee(manager, task.id, helper.id);

    await addTime(worker, task.id, 90, "2026-11-06", "2026-11-07");
    await addTime(helper, task.id, 30, "2026-11-07", "2026-11-07");
    for (const [minutes, day] of [
      [0, "2026-11-07"],
      [24 * 60 + 1, "2026-11-07"],
      [30, "2026-11-08"],
    ] as const)
      await expect(addTime(worker, task.id, minutes, day, "2026-11-07")).rejects.toMatchObject({
        code: "timeInvalid",
      });
    await expect(addTime(stranger, task.id, 30, "2026-11-07", "2026-11-07")).rejects.toMatchObject({
      code: "forbidden",
    });

    await startTimer(helper, task.id, at(0));
    const view = await getTaskTime(task, worker);
    expect(view.totalMinutes).toBe(120);
    expect(view.people.map((p) => [p.id, p.minutes, p.running])).toEqual([
      [worker.id, 90, false],
      [helper.id, 30, true],
    ]);
    expect(view.entries.filter((e) => e.mine)).toHaveLength(1);

    // Only one's own entry goes.
    const helperEntry = view.entries.find((e) => !e.mine && !e.running)!;
    await expect(removeTimeEntry(worker, helperEntry.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    const mine = view.entries.find((e) => e.mine)!;
    await removeTimeEntry(worker, mine.id);
    expect((await getTaskTime(task, worker)).totalMinutes).toBe(30);

    // Closing the task stops the timers running on it; then nobody tracks it.
    // (The co-assignee's timer has taken it into work.)
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      "IN_PROGRESS",
    );
    await changeStatus(worker, task.id, "IN_REVIEW", { now: at(20) });
    await changeStatus(manager, task.id, "DONE", { now: at(45) });
    const closed = await getTaskTime(
      await db.task.findUniqueOrThrow({ where: { id: task.id } }),
      helper,
    );
    expect(closed).toMatchObject({ totalMinutes: 75, running: null, canTrack: false });
    await expect(startTimer(helper, task.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("time by someone else is movement; the bin keeps it", async () => {
    const { manager, worker } = await team();
    const task = await createTask(manager, taskInput({ assigneeId: worker.id }), "create");
    expect(await getDeleteMode(manager, task.id)).toBe("direct");
    await addTime(worker, task.id, 45, "2026-11-07", "2026-11-07");

    const author = await createTestUser("MEMBER");
    await db.user.update({ where: { id: author.id }, data: { managerId: manager.id } });
    const own = await createTask(author, taskInput({ assigneeId: worker.id }), "create");
    expect(await getDeleteMode(author, own.id)).toBe("direct");
    await addTime(worker, own.id, 15, "2026-11-07", "2026-11-07");
    expect(await getDeleteMode(author, own.id)).toBe("request");

    await startTimer(worker, task.id, at(0));
    await deleteTask(manager, task.id, "Тест");
    expect(await db.taskTimeEntry.count({ where: { taskId: task.id } })).toBe(0);
    const owner = await createTestUser("OWNER");
    await restoreTask(owner, task.id);
    const entries = await db.taskTimeEntry.findMany({ where: { taskId: task.id } });
    // The running timer was stopped when the task went to the bin.
    expect(entries.every((e) => e.endedAt !== null)).toBe(true);
    expect(entries.some((e) => e.minutes === 45)).toBe(true);
  });
});
