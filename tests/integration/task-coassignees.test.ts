import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";
import {
  addCoAssignee,
  decideCoAssignee,
  getCoAssignees,
  listCoAssigneeDecisions,
  removeCoAssignee,
  withdrawCoAssigneeRequest,
} from "@/modules/tasks/co-assignees";
import { getDeleteMode } from "@/modules/tasks/delete-service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { knownLabels, setTaskLabels } from "@/modules/tasks/labels";
import {
  changeStatus,
  countDecisions,
  createRepeatCopies,
  createTask,
  getTaskDetail,
  listTasks,
  updateTask,
} from "@/modules/tasks/service";
import { addStep, tickStep } from "@/modules/tasks/steps";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

// Labels and co-assignees of team tasks (BACKLOG item 24, step 4).

// Two teams under the owner: a manager with two people, another manager with one.
async function company() {
  const owner = await createTestUser("OWNER");
  const manager = await createTestUser("MANAGER");
  const a1 = await createTestUser("MEMBER");
  const a2 = await createTestUser("MEMBER");
  const other = await createTestUser("MANAGER");
  const b1 = await createTestUser("MEMBER");
  await db.user.updateMany({
    where: { id: { in: [a1.id, a2.id] } },
    data: { managerId: manager.id },
  });
  await db.user.update({ where: { id: b1.id }, data: { managerId: other.id } });
  return { owner, manager, a1, a2, other, b1 };
}

const notices = (userId: string, type: string) =>
  db.notification.count({ where: { userId, type } });
const mine = async (user: Actor) =>
  (await listTasks(user, parseTaskFilters({}), "2026-11-07")).map((t) => t.id);

describe("co-assignees", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("a teammate joins right away and works like the assignee, but doesn't accept", async () => {
    const { manager, a1, a2 } = await company();
    const task = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");
    expect(task.status).toBe("APPROVED");
    expect(await getTaskDetail(a2, task.id)).toBeNull();

    expect(await addCoAssignee(a1, task.id, a2.id)).toBe("added");
    expect(await notices(a2.id, "task_assigned")).toBe(1);
    expect(await getTaskDetail(a2, task.id)).not.toBeNull();
    expect(await mine(a2)).toEqual([task.id]);
    await expect(addCoAssignee(a1, task.id, a2.id)).rejects.toMatchObject({
      code: "coAssigneeExists",
    });
    // Whoever accepts the result can't do it too.
    await expect(addCoAssignee(a1, task.id, manager.id)).rejects.toMatchObject({
      code: "coAssigneeReviewer",
    });

    // Takes it into work, ticks a step, hands it in; the author hears.
    await changeStatus(a2, task.id, "IN_PROGRESS");
    const step = await addStep(a2, task.id, { title: "Шаг", responsibleId: a2.id, dueDate: null });
    await tickStep(a2, step.id, true);
    await changeStatus(a2, task.id, "IN_REVIEW");
    expect(await notices(a1.id, "task_status")).toBeGreaterThan(0);
    // Accepting is not theirs.
    await expect(changeStatus(a2, task.id, "DONE")).rejects.toMatchObject({ code: "forbidden" });
    // They may take it back, like the assignee, without a reason.
    await changeStatus(a2, task.id, "IN_PROGRESS");
    await changeStatus(a1, task.id, "IN_REVIEW");
    await changeStatus(manager, task.id, "DONE");
    expect(await notices(a2.id, "task_status")).toBeGreaterThan(0);
  });

  it("another team's person or a manager is a request the route decides", async () => {
    const { owner, manager, a1, a2, other, b1 } = await company();
    const task = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");

    // Someone in another team: their manager decides.
    expect(await addCoAssignee(a1, task.id, b1.id)).toBe("requested");
    await expect(addCoAssignee(a1, task.id, b1.id)).rejects.toMatchObject({
      code: "coAssigneeRequested",
    });
    expect(await notices(other.id, "task_pending_approval")).toBe(1);
    expect(await getTaskDetail(b1, task.id)).toBeNull();
    const [request] = await listCoAssigneeDecisions(other);
    expect(request).toMatchObject({ task: { id: task.id }, name: b1.firstName });
    expect(await countDecisions(other)).toBe(1);
    await expect(decideCoAssignee(a2, request!.id, true)).rejects.toMatchObject({
      code: "forbidden",
    });
    await decideCoAssignee(other, request!.id, true);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).coAssigneeIds).toEqual([
      b1.id,
    ]);
    expect(await getTaskDetail(b1, task.id)).not.toBeNull();
    expect(await notices(b1.id, "task_assigned")).toBe(1);
    expect(await countDecisions(other)).toBe(0);

    // A manager: they decide themselves; declining leaves the task as it was.
    expect(await addCoAssignee(a1, task.id, other.id)).toBe("requested");
    const [up] = await listCoAssigneeDecisions(other);
    await decideCoAssignee(other, up!.id, false);
    expect((await getCoAssignees(task)).requests).toEqual([]);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).coAssigneeIds).toEqual([
      b1.id,
    ]);

    // The owner adds anyone straight away; the one who asked takes a request back.
    expect(await addCoAssignee(owner, task.id, other.id)).toBe("added");
    const extra = await createTestUser("MEMBER");
    await db.user.update({ where: { id: extra.id }, data: { managerId: other.id } });
    expect(await addCoAssignee(a1, task.id, extra.id)).toBe("requested");
    const [pending] = (await getCoAssignees({ id: task.id, coAssigneeIds: [] })).requests;
    await withdrawCoAssigneeRequest(a1, pending!.id);
    expect(await countDecisions(other)).toBe(0);
  });

  it("taking off, leaving, closing and reassigning", async () => {
    const { owner, manager, a1, a2, b1 } = await company();
    const task = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");
    await addCoAssignee(manager, task.id, a2.id);
    // A personal task has none.
    const own = await createTask(a1, taskInput({ isPersonal: true }), "start");
    await expect(addCoAssignee(a1, own.id, a2.id)).rejects.toMatchObject({ code: "forbidden" });

    // A co-assignee can't take others off, nor add anyone; they can leave.
    expect(await addCoAssignee(owner, task.id, b1.id)).toBe("added");
    await expect(removeCoAssignee(a2, task.id, b1.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(addCoAssignee(a2, task.id, manager.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await getDeleteMode(a2, task.id)).toBe("request");
    const step = await addStep(manager, task.id, {
      title: "Шаг",
      responsibleId: a2.id,
      dueDate: null,
    });
    expect(await removeCoAssignee(a2, task.id, a2.id)).toEqual({ sees: false });
    expect(await getTaskDetail(a2, task.id)).toBeNull();
    expect((await db.taskStep.findUniqueOrThrow({ where: { id: step.id } })).responsibleId).toBe(
      null,
    );

    // The author takes one off; they hear it.
    await removeCoAssignee(manager, task.id, b1.id);
    expect(await notices(b1.id, "task_status")).toBe(1);

    // Becoming the assignee: no longer a co-assignee.
    await addCoAssignee(manager, task.id, a2.id);
    const moved = await updateTask(manager, task.id, taskInput({ assigneeId: a2.id }));
    expect(moved).toMatchObject({ assigneeId: a2.id, coAssigneeIds: [] });

    // Closing drops requests nobody needs to decide any more.
    await addCoAssignee(a2, task.id, b1.id);
    expect(await db.taskCoAssigneeRequest.count()).toBe(1);
    await changeStatus(manager, task.id, "CANCELLED");
    expect(await db.taskCoAssigneeRequest.count()).toBe(0);
    await expect(addCoAssignee(manager, task.id, b1.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("a repeat copies co-assignees and labels", async () => {
    const { manager, a1, a2 } = await company();
    const first = await createTask(
      manager,
      taskInput({ assigneeId: a1.id, startDate: "2026-11-02", dueDate: "2026-11-06" }),
      "create",
      {
        repeat: { frequency: "WEEKLY", interval: 1, weekdays: [], monthDay: null, until: null },
      },
    );
    await addCoAssignee(manager, first.id, a2.id);
    await setTaskLabels(manager, first.id, "отчёт, выставка");
    await changeStatus(a2, first.id, "IN_PROGRESS");
    await changeStatus(a2, first.id, "IN_REVIEW");
    await changeStatus(manager, first.id, "DONE");
    expect(await createRepeatCopies(new Date("2026-11-09T07:00:00Z"))).toBe(1);
    const copy = await db.task.findFirstOrThrow({
      where: { seriesId: first.seriesId!, NOT: { id: first.id } },
    });
    expect(copy).toMatchObject({ coAssigneeIds: [a2.id], labels: ["отчёт", "выставка"] });
  });
});

describe("labels", () => {
  beforeEach(resetDb);

  it("the people of a task label it; the list filters by a label", async () => {
    const { manager, a1, a2 } = await company();
    const task = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");
    const other = await createTask(manager, taskInput({ assigneeId: a1.id }), "create");

    await setTaskLabels(a1, task.id, " выставка, срочно  для HO ,Выставка");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).labels).toEqual([
      "выставка",
      "срочно для HO",
    ]);
    await expect(setTaskLabels(a2, task.id, "чужое")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await knownLabels(a1)).toEqual(["выставка", "срочно для HO"]);
    expect(await knownLabels(a2)).toEqual([]);

    const found = await listTasks(a1, parseTaskFilters({ label: "выставка" }), "2026-11-07");
    expect(found.map((t) => t.id)).toEqual([task.id]);
    expect(found.map((t) => t.id)).not.toContain(other.id);
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.labels_changed" } }),
    ).toBe(1);

    // A closed task keeps its labels as they are.
    await changeStatus(a1, task.id, "IN_PROGRESS");
    await changeStatus(a1, task.id, "IN_REVIEW");
    await changeStatus(manager, task.id, "DONE");
    await expect(setTaskLabels(manager, task.id, "")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
