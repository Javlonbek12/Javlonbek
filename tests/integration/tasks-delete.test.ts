import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  deleteTask,
  getDeleteMode,
  listDeletedTasks,
  purgeDeletedTasks,
  requestTaskDeletion,
  resolveTaskDeletion,
  restoreTask,
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
      "create",
    );
    expect(await getDeleteMode(other, task.id)).toBe("none");
    await expect(deleteTask(other, task.id)).rejects.toBeInstanceOf(TaskError);
    expect(await getDeleteMode(member, task.id)).toBe("direct");
    await deleteTask(member, task.id);
    expect(await exists(task.id)).toBe(false);
  });

  it("only what others did counts as movement", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      member,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    // Own comments and own work on an own task: still deleted right away.
    await addComment(member, task.id, "Тестовый комментарий");
    await changeStatus(member, task.id, "IN_PROGRESS");
    expect(await getDeleteMode(member, task.id)).toBe("direct");
    // Someone else's comment: now the author asks.
    await addComment(owner, task.id, "Тестовый комментарий владельца");
    expect(await getDeleteMode(member, task.id)).toBe("request");
  });

  it("after the assignee's work the author asks, the manager deletes or keeps", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const author = await createTestUser("MEMBER");
    const worker = await createTestUser("MEMBER");
    await db.user.updateMany({
      where: { id: { in: [author.id, worker.id] } },
      data: { managerId: manager.id },
    });
    const task = await createTask(
      author,
      taskInput({ title: "Тестовая задача", assigneeId: worker.id }),
      "create",
    );
    expect(await getDeleteMode(author, task.id)).toBe("direct");
    await changeStatus(worker, task.id, "IN_PROGRESS");

    expect(await getDeleteMode(author, task.id)).toBe("request");
    expect(await getDeleteMode(worker, task.id)).toBe("request");
    await expect(deleteTask(author, task.id)).rejects.toBeInstanceOf(TaskError);

    // Ask → the manager is notified (not the assignee); asking twice is refused.
    await requestTaskDeletion(author, task.id, "Тестовая причина");
    expect(
      await db.notification.count({ where: { userId: manager.id, type: "task_delete_request" } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: worker.id, type: "task_delete_request" } }),
    ).toBe(0);
    await expect(requestTaskDeletion(author, task.id, "")).rejects.toMatchObject({
      code: "requested",
    });
    await expect(resolveTaskDeletion(author, task.id, true)).rejects.toBeInstanceOf(TaskError);

    // Kept: the request is cleared; the author and the assignee hear it.
    await resolveTaskDeletion(manager, task.id, false);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      deleteRequestedAt: null,
      deleteRequestedById: null,
    });
    for (const user of [author, worker])
      expect(
        await db.notification.count({
          where: { userId: user.id, title: "Удаление задачи отклонено" },
        }),
      ).toBe(1);

    // Withdrawn by the author.
    await requestTaskDeletion(author, task.id, "");
    await resolveTaskDeletion(author, task.id, false);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).deleteRequestedAt).toBe(
      null,
    );

    // Approved: the task goes to the bin.
    await requestTaskDeletion(author, task.id, "Дубль");
    await resolveTaskDeletion(manager, task.id, true);
    expect(await exists(task.id)).toBe(false);
    expect(await db.deletedTask.findUnique({ where: { id: task.id } })).toMatchObject({
      reason: "Дубль",
      deletedById: manager.id,
    });
  });

  it("the overseer deletes right away into the bin; the owner restores; personal: only the author", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const team = await createTask(
      owner,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    await changeStatus(member, team.id, "IN_PROGRESS");
    await addComment(member, team.id, "Тестовый комментарий");
    expect(await getDeleteMode(owner, team.id)).toBe("direct");
    await deleteTask(owner, team.id, "Больше не нужна");
    expect(await exists(team.id)).toBe(false);
    expect(
      await db.notification.findFirst({
        where: { userId: member.id, body: { contains: "Больше не нужна" } },
      }),
    ).not.toBeNull();

    expect((await listDeletedTasks(owner)).map((row) => row.id)).toEqual([team.id]);
    await expect(listDeletedTasks(member)).rejects.toBeInstanceOf(TaskError);
    await expect(restoreTask(member, team.id)).rejects.toBeInstanceOf(TaskError);
    await restoreTask(owner, team.id);
    expect(await db.task.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({
      status: "IN_PROGRESS",
      assigneeId: member.id,
    });
    expect(await db.comment.count({ where: { taskId: team.id } })).toBe(1);
    expect(await db.deletedTask.count()).toBe(0);

    // The bin keeps tasks for the days set (30 by default).
    await deleteTask(owner, team.id);
    expect(await purgeDeletedTasks(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(await purgeDeletedTasks(new Date(Date.now() + 31 * 86_400_000))).toBe(1);

    const personal = await createTask(
      member,
      taskInput({ title: "Тестовая личная", isPersonal: true }),
      "start",
    );
    expect(await getDeleteMode(owner, personal.id)).toBe("none");
    expect(await getDeleteMode(member, personal.id)).toBe("direct");
    await deleteTask(member, personal.id);
    expect(await exists(personal.id)).toBe(false);
    expect(await db.deletedTask.count()).toBe(0);
  });
});
