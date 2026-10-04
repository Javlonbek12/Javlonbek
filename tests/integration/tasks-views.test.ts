import { beforeEach, describe, expect, it } from "vitest";

import { visibleTasksWhere, canViewTask } from "@/modules/tasks/access";
import { db } from "@/lib/db";
import { addComment, listComments } from "@/modules/tasks/comment-service";
import {
  listTasksDueBetween,
  listTimeline,
  createTask,
  updateTask,
  changeStatus,
} from "@/modules/tasks/service";
import { addDependency } from "@/modules/tasks/dependency-service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

describe("visibility rule in the database matches canViewTask", () => {
  beforeEach(resetDb);

  it("for every role and task kind", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    const draft = await createTask(owner, taskInput({ assigneeId: member.id }));
    const approved = await createTask(owner, taskInput({ assigneeId: member.id }), "approve");
    const personal = await createTask(member, taskInput({ isPersonal: true }));
    const memberDraft = await createTask(member, taskInput({ assigneeId: other.id }));

    for (const user of [owner, manager, member, other]) {
      const visible = await db.task.findMany({
        where: visibleTasksWhere(user),
        select: { id: true },
      });
      const all = await db.task.findMany();
      const expected = all
        .filter((task) => canViewTask(user, task))
        .map((t) => t.id)
        .sort();
      expect(visible.map((t) => t.id).sort()).toEqual(expected);
    }
    expect([draft, approved, personal, memberDraft]).toHaveLength(4);
  });
});

describe("calendar and timeline", () => {
  beforeEach(resetDb);

  it("show approved team tasks and personal tasks, not drafts", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await createTask(
      owner,
      taskInput({ title: "черновик", assigneeId: owner.id, dueDate: "2026-10-05" }),
    );
    await createTask(
      owner,
      taskInput({ title: "утверждена", assigneeId: owner.id, dueDate: "2026-10-05" }),
      "approve",
    );
    await createTask(
      owner,
      taskInput({ title: "личная", isPersonal: true, dueDate: "2026-10-06" }),
    );
    await createTask(
      owner,
      taskInput({ title: "чужая", assigneeId: member.id, dueDate: "2026-10-06" }),
      "approve",
    );

    const calendar = await listTasksDueBetween(owner, "mine", "2026-10-01", "2026-11-01");
    expect(calendar.map((t) => t.title)).toEqual(["утверждена", "личная"]);
    const team = await listTasksDueBetween(owner, "team", "2026-10-01", "2026-11-01");
    expect(team.map((t) => t.title).sort()).toEqual(["утверждена", "чужая"]);
  });

  it("timeline returns overlapping bars and dependency arrows", async () => {
    const owner = await createTestUser("OWNER");
    const a = await createTask(
      owner,
      taskInput({
        title: "A",
        assigneeId: owner.id,
        startDate: "2026-09-20",
        dueDate: "2026-10-03",
      }),
      "approve",
    );
    const b = await createTask(
      owner,
      taskInput({ title: "B", assigneeId: owner.id, dueDate: "2026-10-10" }),
      "approve",
    );
    await createTask(
      owner,
      taskInput({ title: "далеко", assigneeId: owner.id, dueDate: "2026-12-10" }),
      "approve",
    );
    await addDependency(owner, b.id, a.id);

    const { tasks, edges } = await listTimeline(owner, "mine", "2026-10-01", "2026-10-29");
    expect(tasks.map((t) => t.title)).toEqual(["A", "B"]);
    expect(edges).toEqual([{ blockerId: a.id, blockedId: b.id }]);
  });
});

describe("editing and comments", () => {
  beforeEach(resetDb);

  it("logs changed fields and notifies about comments", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ title: "Было", assigneeId: member.id }),
      "approve",
    );

    await updateTask(
      owner,
      task.id,
      taskInput({ title: "Стало", assigneeId: member.id, dueDate: "2026-10-09" }),
    );
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "task.updated" } });
    expect(log.details).toEqual({ title: ["Было", "Стало"], dueDate: [null, "2026-10-09"] });

    await expect(
      updateTask(member, task.id, taskInput({ title: "Взлом", assigneeId: member.id })),
    ).rejects.toMatchObject({
      code: "forbidden",
    });

    await addComment(member, task.id, "Готово наполовину");
    expect((await listComments(task.id)).map((c) => c.body)).toEqual(["Готово наполовину"]);
    expect(await db.notification.count({ where: { userId: owner.id, type: "task_comment" } })).toBe(
      1,
    );
  });

  it("does not notify an assignee about comments on a task they cannot see yet", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const draft = await createTask(owner, taskInput({ assigneeId: member.id }));
    await addComment(owner, draft.id, "Черновая мысль");
    expect(await db.notification.count({ where: { userId: member.id } })).toBe(0);
    await expect(addComment(member, draft.id, "?")).rejects.toMatchObject({ code: "forbidden" });
    await changeStatus(owner, draft.id, "APPROVED");
  });
});
