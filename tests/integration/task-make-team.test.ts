import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createPlan } from "@/modules/tasks/plan-service";
import {
  changeStatus,
  createTask,
  getTaskDetail,
  listDecisions,
  makeTeamTask,
} from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

// A personal task becomes a team task (BACKLOG item 15).

async function company() {
  const owner = await createTestUser("OWNER");
  const manager = await createTestUser("MANAGER");
  const worker = await createTestUser("MEMBER");
  const colleague = await createTestUser("MEMBER");
  const other = await createTestUser("MANAGER");
  const outsider = await createTestUser("MEMBER");
  await db.user.updateMany({
    where: { id: { in: [worker.id, colleague.id] } },
    data: { managerId: manager.id },
  });
  await db.user.update({ where: { id: outsider.id }, data: { managerId: other.id } });
  return { owner, manager, worker, colleague, other, outsider };
}

const personal = (title = "Тестовая личная") => taskInput({ title, isPersonal: true });

describe("making a personal task a team task", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("on oneself: work going on goes on; the manager sees it and accepts it", async () => {
    const { manager, worker } = await company();
    const task = await createTask(worker, personal(), "start");
    expect(task).toMatchObject({ isPersonal: true, status: "IN_PROGRESS" });
    expect(await getTaskDetail(manager, task.id)).toBeNull();

    const team = await makeTeamTask(worker, task.id, { assigneeId: worker.id });
    expect(team).toMatchObject({
      isPersonal: false,
      assigneeId: worker.id,
      status: "IN_PROGRESS",
      reviewerId: manager.id,
    });
    expect(team.approvedAt).not.toBeNull();
    expect(await getTaskDetail(manager, task.id)).not.toBeNull();
    expect(await db.notification.count({ where: { userId: manager.id, type: "task_team" } })).toBe(
      1,
    );
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.made_team" } }),
    ).toBe(1);

    // Handing it in goes to the manager now.
    await changeStatus(worker, task.id, "IN_REVIEW");
    await changeStatus(manager, task.id, "DONE");
  });

  it("to someone else: the route decides; a personal plan lets it go", async () => {
    const { worker, colleague, other, outsider } = await company();
    const plan = await createPlan(worker, {
      title: "Тестовый план",
      level: "WEEK",
      date: "2026-11-09",
      parentId: null,
      isPersonal: true,
    });
    const task = await createTask(worker, { ...personal(), planId: plan.id }, "draft");

    // A colleague in the same team: it starts right away, they take it.
    const toColleague = await makeTeamTask(worker, task.id, { assigneeId: colleague.id });
    expect(toColleague).toMatchObject({
      status: "APPROVED",
      assigneeId: colleague.id,
      planId: null,
    });
    expect(
      await db.notification.count({ where: { userId: colleague.id, type: "task_assigned" } }),
    ).toBe(1);

    // Someone in another team: their manager decides.
    const second = await createTask(worker, personal("Тестовая вторая"), "start");
    const toOutsider = await makeTeamTask(worker, second.id, { assigneeId: outsider.id });
    expect(toOutsider).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [other.id] });
    expect((await listDecisions(other)).approve.map((t) => t.id)).toEqual([second.id]);
    expect(await getTaskDetail(outsider, second.id)).toBeNull();
  });

  it("only its author, only while open, only a personal task", async () => {
    const { manager, worker, colleague } = await company();
    const task = await createTask(worker, personal(), "start");
    await expect(
      makeTeamTask(colleague, task.id, { assigneeId: colleague.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(makeTeamTask(worker, task.id, { assigneeId: "nobody" })).rejects.toMatchObject({
      code: "invalid",
    });
    // With «Требует утверждения» even one's own task waits for the manager.
    const flagged = await makeTeamTask(worker, task.id, {
      assigneeId: worker.id,
      needsApproval: true,
    });
    expect(flagged).toMatchObject({ status: "PENDING_APPROVAL", deciderIds: [manager.id] });
    await expect(makeTeamTask(worker, task.id, { assigneeId: worker.id })).rejects.toMatchObject({
      code: "forbidden",
    });

    const done = await createTask(worker, personal("Тестовая готовая"), "start");
    await changeStatus(worker, done.id, "DONE");
    await expect(makeTeamTask(worker, done.id, { assigneeId: worker.id })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
