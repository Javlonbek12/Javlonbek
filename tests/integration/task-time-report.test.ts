import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createTask } from "@/modules/tasks/service";
import { addTime, startTimer, stopTimer } from "@/modules/tasks/time";
import { getTimeReport } from "@/modules/tasks/time-report";
import { timeReportXlsx } from "@/modules/tasks/time-report-xlsx";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

// «Who spent how much time» (BACKLOG item 24): everyone sees the time on the tasks they see.

const period = { from: "2026-11-02", to: "2026-11-08" };
const today = "2026-11-08";

describe("time report", () => {
  beforeEach(resetDb);

  it("the owner sees all team time, a member their own; personal time only its author", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const worker = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    await db.user.updateMany({
      where: { id: { in: [worker.id, other.id] } },
      data: { managerId: manager.id },
    });
    const task = await createTask(
      manager,
      taskInput({ assigneeId: worker.id, estimateHours: 2 }),
      "create",
    );
    const otherTask = await createTask(manager, taskInput({ assigneeId: other.id }), "create");
    const personal = await createTask(worker, taskInput({ isPersonal: true }));

    await startTimer(worker, task.id, new Date("2026-11-03T06:00:00Z"));
    await stopTimer(worker, task.id, new Date("2026-11-03T07:30:00Z"));
    await addTime(worker, personal.id, 40, "2026-11-04", today);
    await addTime(other, otherTask.id, 60, "2026-11-05", today);
    // Outside the period.
    await addTime(other, otherTask.id, 25, "2026-11-01", today);

    const all = await getTimeReport(owner, period, "Asia/Tashkent");
    expect(all.totalMinutes).toBe(150);
    expect(all.people.map((p) => p.minutes)).toEqual([90, 60]);
    expect(all.people[0]!.tasks[0]).toMatchObject({ id: task.id, estimateMinutes: 120 });

    const mine = await getTimeReport(worker, period, "Asia/Tashkent");
    expect(mine.people).toHaveLength(1);
    expect(mine.people[0]).toMatchObject({ id: worker.id, minutes: 130 });
    expect(mine.taskCount).toBe(2);

    const excel = await timeReportXlsx(all);
    expect(excel.subarray(0, 2).toString()).toBe("PK");
  });
});
