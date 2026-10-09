import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  deleteTask,
  getDeleteMode,
  requestTaskDeletion,
  resolveTaskDeletion,
} from "@/modules/tasks/delete-service";
import { TaskError } from "@/modules/tasks/errors";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { addComment } from "@/modules/tasks/comment-service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

const exists = async (id: string) => (await db.task.count({ where: { id } })) === 1;

describe("deleting tasks", () => {
  beforeEach(resetDb);

  it("an untouched own task is deleted right away", async () => {
    await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    const task = await createTask(
      member,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "submit",
    );
    expect(await getDeleteMode(other, task.id)).toBe("none");
    await expect(deleteTask(other, task.id)).rejects.toBeInstanceOf(TaskError);
    expect(await getDeleteMode(member, task.id)).toBe("direct");
    await deleteTask(member, task.id);
    expect(await exists(task.id)).toBe(false);
  });

  it("a comment counts as progress", async () => {
    await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      member,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "submit",
    );
    await addComment(member, task.id, "Тестовый комментарий");
    expect(await getDeleteMode(member, task.id)).toBe("request");
  });

  it("after approval the employee asks, the manager deletes or keeps", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      member,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "submit",
    );
    await changeStatus(owner, task.id, "APPROVED");

    expect(await getDeleteMode(member, task.id)).toBe("request");
    await expect(deleteTask(member, task.id)).rejects.toBeInstanceOf(TaskError);

    // Ask → the owner is notified; asking twice is refused.
    await requestTaskDeletion(member, task.id, "Тестовая причина");
    expect(
      await db.notification.count({ where: { userId: owner.id, type: "task_delete_request" } }),
    ).toBe(1);
    await expect(requestTaskDeletion(member, task.id, "")).rejects.toMatchObject({
      code: "requested",
    });
    // The employee can't approve their own request.
    await expect(resolveTaskDeletion(member, task.id, true)).rejects.toBeInstanceOf(TaskError);

    // Kept: the request is cleared and the employee hears about it.
    await resolveTaskDeletion(owner, task.id, false);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      deleteRequestedAt: null,
      deleteRequestedById: null,
    });
    expect(
      await db.notification.count({
        where: { userId: member.id, title: "Удаление задачи отклонено" },
      }),
    ).toBe(1);

    // Withdrawn by the employee.
    await requestTaskDeletion(member, task.id, "");
    await resolveTaskDeletion(member, task.id, false);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).deleteRequestedAt).toBe(
      null,
    );

    // Approved: the task is gone.
    await requestTaskDeletion(member, task.id, "");
    await resolveTaskDeletion(owner, task.id, true);
    expect(await exists(task.id)).toBe(false);
  });

  it("the overseer deletes right away; a personal task only by its author", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const team = await createTask(
      member,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "submit",
    );
    await changeStatus(owner, team.id, "APPROVED");
    await changeStatus(member, team.id, "IN_PROGRESS");
    expect(await getDeleteMode(owner, team.id)).toBe("direct");
    await deleteTask(owner, team.id);
    expect(await exists(team.id)).toBe(false);

    const personal = await createTask(
      member,
      taskInput({ title: "Тестовая личная", isPersonal: true }),
      "start",
    );
    expect(await getDeleteMode(owner, personal.id)).toBe("none");
    expect(await getDeleteMode(member, personal.id)).toBe("direct");
    await deleteTask(member, personal.id);
    expect(await exists(personal.id)).toBe(false);
  });
});
