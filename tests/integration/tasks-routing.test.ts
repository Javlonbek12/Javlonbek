import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { runSchedulerTick } from "@/modules/scheduler/tick";
import { addComment } from "@/modules/tasks/comment-service";
import { migrateToRoutingV2 } from "@/modules/tasks/migrate-v2";
import { completeTask, updateTaskField } from "@/modules/tasks/quick-actions";
import { saveTaskSettings } from "@/modules/tasks/settings";
import { requestTaskDeletion } from "@/modules/tasks/delete-service";
import {
  changeStatus,
  countDecisions,
  createTask,
  getTaskDetail,
  listDecisions,
  updateTask,
} from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

const writeDigest = async () => "Текст дайджеста";
const count = (userId: string, type: string) => db.notification.count({ where: { userId, type } });

// A small company: the owner, a manager with two people, an employee straight under the owner.
async function company() {
  const owner = await createTestUser("OWNER", { firstName: "Тестовладелец" });
  const manager = await createTestUser("MANAGER");
  const a1 = await createTestUser("MEMBER");
  const a2 = await createTestUser("MEMBER");
  const loose = await createTestUser("MEMBER");
  await db.user.updateMany({
    where: { id: { in: [a1.id, a2.id] } },
    data: { managerId: manager.id },
  });
  return { owner, manager, a1, a2, loose };
}

describe("routing v2", () => {
  beforeEach(resetDb);

  it("the owner's flag makes a team approve tasks inside it", async () => {
    const { owner, manager, a1, a2 } = await company();
    await saveTaskSettings(owner, { teamApproval: [manager.id], trashDays: 30 });
    const task = await createTask(a1, taskInput({ assigneeId: a2.id }), "create");
    expect(task).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [manager.id] });
    // The assignee doesn't see it while it waits.
    expect(await getTaskDetail(a2, task.id)).toBeNull();
    await changeStatus(manager, task.id, "APPROVED");
    expect(await getTaskDetail(a2, task.id)).not.toBeNull();
  });

  it("a new assignee recomputes the route; after «В работе» the assignee is fixed", async () => {
    const { manager, a1, a2, loose } = await company();
    const task = await createTask(a1, taskInput({ assigneeId: a2.id }), "create");
    expect(task.status).toBe("APPROVED");

    // To someone outside the team: now it waits (for the owner, the loose employee's manager).
    const moved = await updateTask(a1, task.id, taskInput({ assigneeId: loose.id }));
    expect(moved).toMatchObject({ status: "PENDING_APPROVAL", assigneeId: loose.id });
    expect(
      await db.notification.count({ where: { userId: a2.id, title: "Вас сняли с задачи" } }),
    ).toBe(1);

    await updateTask(a1, task.id, taskInput({ assigneeId: a2.id }));
    await changeStatus(a2, task.id, "IN_PROGRESS");
    await expect(
      updateTask(manager, task.id, taskInput({ assigneeId: a1.id })),
    ).rejects.toMatchObject({ code: "assigneeLocked" });
  });

  it("an own task is accepted by the nearest manager; the owner's closes on hand-in", async () => {
    const { owner, manager, a1 } = await company();
    // «Создать» on one's own task: straight into work (no «Взять в работу» click).
    const own = await createTask(a1, taskInput({ assigneeId: a1.id }), "create", {
      startOwn: true,
    });
    expect(own).toMatchObject({ status: "IN_PROGRESS", reviewerId: manager.id });
    expect(own.approvedAt).not.toBeNull();
    await changeStatus(a1, own.id, "IN_REVIEW");
    await expect(changeStatus(a1, own.id, "DONE")).rejects.toMatchObject({ code: "forbidden" });
    await expect(changeStatus(manager, own.id, "DONE")).resolves.toMatchObject({ status: "DONE" });

    // One that starts later waits as «Утверждена»; with «Требует утверждения» it waits too.
    const later = await createTask(
      a1,
      taskInput({ assigneeId: a1.id, startDate: "2099-01-01", dueDate: "2099-01-02" }),
      "create",
      { startOwn: true },
    );
    expect(later.status).toBe("APPROVED");
    const flagged = await createTask(a1, taskInput({ assigneeId: a1.id }), "create", {
      needsApproval: true,
      startOwn: true,
    });
    expect(flagged.status).toBe("PENDING_APPROVAL");

    const owners = await createTask(owner, taskInput({ assigneeId: owner.id }), "create");
    expect(owners.reviewerId).toBeNull();
    await changeStatus(owner, owners.id, "IN_PROGRESS");
    await expect(changeStatus(owner, owners.id, "DONE")).resolves.toMatchObject({
      status: "DONE",
    });
  });

  it("waiting: after a working day the decider hears it, after three the owner and the author", async () => {
    const { owner, manager, a1, loose } = await company();
    // Wed 30 Sep 2026, 10:00 Tashkent.
    const task = await createTask(a1, taskInput({ assigneeId: loose.id }), "create");
    expect(task.deciderIds).toEqual([owner.id]);
    await db.task.update({
      where: { id: task.id },
      data: { statusChangedAt: new Date("2026-09-30T05:00:00Z") },
    });

    await runSchedulerTick(new Date("2026-09-30T10:00:00Z"), { writeDigest });
    expect(await count(owner.id, "task_waiting")).toBe(0);
    // Thursday 09:00: one working day.
    await runSchedulerTick(new Date("2026-10-01T04:00:00Z"), { writeDigest });
    await runSchedulerTick(new Date("2026-10-01T05:00:00Z"), { writeDigest });
    expect(await count(owner.id, "task_waiting")).toBe(1);
    expect(await count(a1.id, "task_waiting")).toBe(0);
    // Monday 5 Oct: three working days (the weekend doesn't count).
    await runSchedulerTick(new Date("2026-10-04T04:00:00Z"), { writeDigest });
    expect(await count(a1.id, "task_waiting")).toBe(0);
    await runSchedulerTick(new Date("2026-10-05T04:00:00Z"), { writeDigest });
    expect(await count(a1.id, "task_waiting")).toBe(1);
    expect(await count(manager.id, "task_waiting")).toBe(0);
  });

  it("the panel changes one field at a time under the same rules", async () => {
    const { owner, a1, a2, loose } = await company();
    const task = await createTask(
      a1,
      taskInput({ assigneeId: a2.id, dueDate: "2026-11-10", project: "Тестовый проект" }),
      "create",
    );
    await updateTaskField(a1, task.id, "priority", "URGENT");
    await updateTaskField(a1, task.id, "dueDate", "2026-11-12");
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      priority: "URGENT",
      project: "Тестовый проект",
      dueDate: new Date("2026-11-12T00:00:00Z"),
    });
    // A new assignee outside the team: the route is worked out again.
    expect(await updateTaskField(a1, task.id, "assigneeId", loose.id)).toMatchObject({
      status: "PENDING_APPROVAL",
      deciderIds: [owner.id],
    });
    // Someone who can't edit it can't change a field either.
    await expect(updateTaskField(a2, task.id, "priority", "LOW")).rejects.toMatchObject({
      code: "forbidden",
    });

    // The round button: the assignee hands in, the author accepts.
    await updateTaskField(a1, task.id, "assigneeId", a2.id);
    expect(await completeTask(a2, task.id)).toBe("IN_REVIEW");
    expect(await completeTask(a1, task.id)).toBe("DONE");
  });

  it("«Ждут решения»: what to approve, what to accept, what they ask to delete", async () => {
    const { manager, a1, a2 } = await company();
    const flagged = await createTask(
      a1,
      taskInput({ title: "Утвердить", assigneeId: a2.id }),
      "create",
      {
        needsApproval: true,
      },
    );
    const own = await createTask(a1, taskInput({ title: "Принять", assigneeId: a1.id }), "create");
    await changeStatus(a1, own.id, "IN_PROGRESS");
    await changeStatus(a1, own.id, "IN_REVIEW");
    const doomed = await createTask(
      a1,
      taskInput({ title: "Удалить", assigneeId: a2.id }),
      "create",
    );
    await changeStatus(a2, doomed.id, "IN_PROGRESS");
    await requestTaskDeletion(a1, doomed.id, "Дубль");

    const decisions = await listDecisions(manager);
    expect(decisions.approve.map((t) => t.id)).toEqual([flagged.id]);
    expect(decisions.accept.map((t) => t.id)).toEqual([own.id]);
    expect(decisions.remove.map((t) => t.id)).toEqual([doomed.id]);
    expect(await countDecisions(manager)).toBe(3);
    // The one who asked doesn't decide on their own request; the employees decide nothing here.
    expect(await countDecisions(a1)).toBe(0);
    expect(await countDecisions(a2)).toBe(0);
  });

  it("@mentions in a comment reach those who can see the task", async () => {
    const { owner, manager, a1, a2, loose } = await company();
    await db.user.update({ where: { id: a2.id }, data: { telegramUsername: "tester_two" } });
    const task = await createTask(a1, taskInput({ assigneeId: a1.id }), "create");
    await addComment(a1, task.id, `@tester_two и @${owner.firstName}, гляньте`);
    expect(
      await db.notification.count({
        where: { userId: owner.id, title: "Вас упомянули в комментарии" },
      }),
    ).toBe(1);
    // A colleague who can't see the task isn't told about it.
    expect(await count(a2.id, "task_comment")).toBe(0);
    expect(await count(loose.id, "task_comment")).toBe(0);
    // The manager accepts the result of a1's own task: they hear every comment.
    expect(await count(manager.id, "task_comment")).toBe(1);
  });

  it("while a task waits, whoever decides hears its comments", async () => {
    const { owner, a1, loose } = await company();
    // To another team: waits for the owner.
    const waiting = await createTask(a1, taskInput({ assigneeId: loose.id }), "create");
    expect(waiting.deciderIds).toEqual([owner.id]);
    await addComment(a1, waiting.id, "Уточнение по срокам");
    expect(await count(owner.id, "task_comment")).toBe(1);
    // Decided: the decider is no longer part of the conversation.
    await changeStatus(owner, waiting.id, "APPROVED");
    await addComment(a1, waiting.id, "Спасибо");
    expect(await count(owner.id, "task_comment")).toBe(1);
  });

  it("the rollout re-routes waiting tasks once and tells who it concerns", async () => {
    const { owner, manager, a1, a2, loose } = await company();
    // Tasks made under the old rules: everything waited for approval.
    const old = (assigneeId: string) =>
      db.task.create({
        data: {
          title: "Старая задача",
          creatorId: a1.id,
          assigneeId,
          status: "PENDING_APPROVAL",
        },
      });
    const inTeam = await old(a2.id);
    const outside = await old(loose.id);
    const started = await db.task.create({
      data: { title: "В работе", creatorId: owner.id, assigneeId: a1.id, status: "IN_PROGRESS" },
    });

    expect(await migrateToRoutingV2(new Date("2026-11-05T05:00:00Z"))).toMatchObject({
      done: true,
      approved: 1,
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: inTeam.id } })).toMatchObject({
      status: "APPROVED",
      reviewerId: a1.id,
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: outside.id } })).toMatchObject({
      status: "PENDING_APPROVAL",
      deciderIds: [owner.id],
    });
    expect((await db.task.findUniqueOrThrow({ where: { id: started.id } })).reviewerId).toBe(
      owner.id,
    );
    for (const user of [a1, a2])
      expect(
        await db.notification.count({
          where: { userId: user.id, title: "Задача утверждена автоматически по новым правилам" },
        }),
      ).toBe(1);
    expect(await count(manager.id, "task_status")).toBe(0);
    // Only once.
    expect(await migrateToRoutingV2()).toMatchObject({ done: false });
  });
});
