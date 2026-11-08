import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getMyDay, getTeamToday } from "@/modules/home/today";
import { getMyDashboard } from "@/modules/tasks/dashboard";
import { getRunningTimer } from "@/modules/tasks/time";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { startTimer } from "@/modules/tasks/time";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

const today = "2026-11-09";

describe("«Сегодня»", () => {
  beforeEach(resetDb);

  it("numbers match the lists: personal drafts count, handed-in work is not overdue", async () => {
    const manager = await createTestUser("MANAGER");
    const worker = await createTestUser("MEMBER");
    await db.user.update({ where: { id: worker.id }, data: { managerId: manager.id } });
    // A personal task from the bot starts as a draft.
    const draft = await createTask(
      worker,
      taskInput({ title: "Личное", isPersonal: true, dueDate: "2026-11-05" }),
    );
    await db.task.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    const handedIn = await createTask(
      manager,
      taskInput({ title: "Сдано", assigneeId: worker.id, dueDate: "2026-11-06" }),
      "create",
    );
    await changeStatus(worker, handedIn.id, "IN_PROGRESS");
    await changeStatus(worker, handedIn.id, "IN_REVIEW");

    const stats = await getMyDashboard(worker, today, "UTC");
    const day = await getMyDay(worker, today);
    expect(stats.overdue).toBe(1);
    expect(day.day.filter((t) => t.when === "overdue").map((t) => t.title)).toEqual(["Личное"]);
    expect(day.handedIn).toBe(1);

    // The manager sees the worker in «Моя команда сегодня».
    const team = await getTeamToday(manager, today);
    expect(team?.rows).toEqual([
      expect.objectContaining({ id: worker.id, open: 1, handedIn: 1, overdue: 0 }),
    ]);
    // A member oversees nobody.
    expect(await getTeamToday(worker, today)).toBeNull();
  });

  it("the running timer is shown for its owner only", async () => {
    const worker = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    const task = await createTask(
      worker,
      taskInput({ title: "С таймером", assigneeId: worker.id }),
      "create",
    );
    expect(await getRunningTimer(worker.id)).toBeNull();
    await startTimer(worker, task.id);
    expect(await getRunningTimer(worker.id)).toMatchObject({
      taskId: task.id,
      title: "С таймером",
    });
    expect(await getRunningTimer(other.id)).toBeNull();
  });
});
