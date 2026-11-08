import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import { requestDueChange, resolveDueChange } from "@/modules/tasks/due-change";
import { createTask, decisionCount, listDecisions } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

// «Попросить перенести срок»: the assignee asks, the author decides.

const today = "2026-11-09";

async function setup() {
  const manager = await createTestUser("MANAGER");
  const worker = await createTestUser("MEMBER");
  await db.user.update({ where: { id: worker.id }, data: { managerId: manager.id } });
  const task = await createTask(
    manager,
    taskInput({ assigneeId: worker.id, dueDate: "2026-11-10" }),
    "create",
  );
  return { manager, worker, task };
}

describe("asking to move a due date", () => {
  beforeEach(resetDb);

  it("the assignee asks with a reason; the author sees it in «Ждут решения» and moves the date", async () => {
    const { manager, worker, task } = await setup();
    await expect(requestDueChange(worker, task.id, "2026-11-20", " ", today)).rejects.toThrow(
      "invalid",
    );
    await expect(
      requestDueChange(worker, task.id, "2026-11-01", "Тест: поздно", today),
    ).rejects.toThrow("invalid");
    // The author changes the date themselves; asking is for the one who can't.
    await expect(requestDueChange(manager, task.id, "2026-11-20", "Тест", today)).rejects.toThrow(
      "forbidden",
    );

    await requestDueChange(worker, task.id, "2026-11-20", "Тест: ждём материалы", today);
    await expect(
      requestDueChange(worker, task.id, "2026-11-21", "Тест: ещё раз", today),
    ).rejects.toThrow("requested");
    const decisions = await listDecisions(manager);
    expect(decisions.dueChange.map((t) => t.id)).toEqual([task.id]);
    expect(decisionCount(decisions)).toBe(1);
    expect((await listDecisions(worker)).dueChange).toEqual([]);
    expect(
      await db.notification.count({ where: { userId: manager.id, link: { contains: task.id } } }),
    ).toBeGreaterThan(0);

    await expect(resolveDueChange(worker, task.id, "approve")).rejects.toThrow("forbidden");
    await resolveDueChange(manager, task.id, "approve");
    const moved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(toDateString(moved.dueDate!)).toBe("2026-11-20");
    expect(moved.dueChangeAt).toBeNull();
    expect((await listDecisions(manager)).dueChange).toEqual([]);
  });

  it("kept or withdrawn: the date stays", async () => {
    const { manager, worker, task } = await setup();
    await requestDueChange(worker, task.id, "2026-11-20", "Тест", today);
    await resolveDueChange(manager, task.id, "reject");
    await requestDueChange(worker, task.id, "2026-11-25", "Тест", today);
    await expect(resolveDueChange(manager, task.id, "withdraw")).rejects.toThrow("forbidden");
    await resolveDueChange(worker, task.id, "withdraw");
    const kept = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(toDateString(kept.dueDate!)).toBe("2026-11-10");
    expect(kept.dueChangeAt).toBeNull();
  });
});
