import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import { deleteTask, getDeleteMode, restoreTask } from "@/modules/tasks/delete-service";
import { changeStatus, createRepeatCopies, createTask } from "@/modules/tasks/service";
import {
  addStep,
  listSteps,
  moveStep,
  removeStep,
  tickStep,
  updateStep,
} from "@/modules/tasks/steps";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

// Steps of the work on a task («Работа», BACKLOG item 24).

const step = (title: string, extra: { responsibleId?: string; dueDate?: string } = {}) => ({
  title,
  responsibleId: extra.responsibleId ?? null,
  dueDate: extra.dueDate ?? null,
});
const statusOf = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).status;

describe("task steps", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("the author plans, the assignee ticks: the first tick takes the task into work, all ticked offers to hand in", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ title: "Тестовый отчёт", assigneeId: member.id, dueDate: "2026-11-20" }),
      "create",
    );
    expect(task.status).toBe("APPROVED");
    const first = await addStep(
      owner,
      task.id,
      step("Собрать данные", { responsibleId: member.id, dueDate: "2026-11-10" }),
    );
    const second = await addStep(member, task.id, step("Написать отчёт"));
    expect((await listSteps(task.id)).map((s) => [s.title, s.position])).toEqual([
      ["Собрать данные", 0],
      ["Написать отчёт", 1],
    ]);

    // The author ticking on an approved task does not take it into work for the assignee.
    expect(await tickStep(owner, first.id, true)).toEqual({ started: false, allDone: false });
    expect(await statusOf(task.id)).toBe("APPROVED");
    await tickStep(owner, first.id, false);

    expect(await tickStep(member, first.id, true)).toEqual({ started: true, allDone: false });
    expect(await statusOf(task.id)).toBe("IN_PROGRESS");
    expect(await tickStep(member, second.id, true)).toEqual({ started: false, allDone: true });
    // Never handed in on its own.
    expect(await statusOf(task.id)).toBe("IN_PROGRESS");
    const done = (await listSteps(task.id)).find((s) => s.id === second.id)!;
    expect(done.doneById).toBe(member.id);
    expect(
      await db.activityLog.count({ where: { entityId: task.id, action: "task.step_done" } }),
    ).toBe(3);

    // Handed in: the steps are fixed until the task is taken back.
    await changeStatus(member, task.id, "IN_REVIEW");
    await expect(tickStep(member, second.id, false)).rejects.toMatchObject({ code: "forbidden" });
    await expect(addStep(member, task.id, step("Ещё один"))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("only the people of the task work with steps; a step goes to the author or the assignee", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const stranger = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    const s = await addStep(owner, task.id, step("Шаг"));
    await expect(addStep(stranger, task.id, step("Чужой шаг"))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(tickStep(stranger, s.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addStep(owner, task.id, step("Шаг", { responsibleId: stranger.id })),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(addStep(owner, task.id, step("   "))).rejects.toMatchObject({ code: "invalid" });
    await expect(
      addStep(owner, task.id, step("Шаг", { dueDate: "31.12.2026" })),
    ).rejects.toMatchObject({ code: "invalid" });

    const updated = await updateStep(
      member,
      s.id,
      step("Шаг уточнён", { responsibleId: owner.id, dueDate: "2026-12-01" }),
    );
    expect(updated).toMatchObject({ title: "Шаг уточнён", responsibleId: owner.id });
    expect(toDateString(updated.dueDate!)).toBe("2026-12-01");
  });

  it("a team draft: steps are planned now and ticked once approved; a personal task starts with its first tick", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const draft = await createTask(
      owner,
      taskInput({ title: "Черновик", assigneeId: member.id }),
      "draft",
    );
    const s = await addStep(owner, draft.id, step("Подготовить"));
    await expect(tickStep(owner, s.id, true)).rejects.toMatchObject({ code: "forbidden" });

    const personal = await createTask(
      member,
      taskInput({ title: "Личная", isPersonal: true }),
      "draft",
    );
    expect(personal.status).toBe("DRAFT");
    const p = await addStep(member, personal.id, step("Сделать"));
    expect(await tickStep(member, p.id, true)).toEqual({ started: true, allDone: true });
    expect(await statusOf(personal.id)).toBe("IN_PROGRESS");
    await expect(addStep(owner, personal.id, step("Чужой"))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("moves and removes steps, keeping the order 0, 1, 2…", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const task = await createTask(
      owner,
      taskInput({ title: "Тестовая задача", assigneeId: member.id }),
      "create",
    );
    const [a, b, c] = [
      await addStep(owner, task.id, step("A")),
      await addStep(owner, task.id, step("B")),
      await addStep(owner, task.id, step("C")),
    ];
    await moveStep(owner, c.id, "up");
    await moveStep(owner, a.id, "up"); // already first: nothing
    expect((await listSteps(task.id)).map((s) => s.title)).toEqual(["A", "C", "B"]);
    await removeStep(member, b.id);
    await moveStep(owner, a.id, "down");
    expect((await listSteps(task.id)).map((s) => [s.title, s.position])).toEqual([
      ["C", 0],
      ["A", 1],
    ]);
  });

  it("a step ticked by someone other than the author is movement: the author then asks to delete", async () => {
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
    expect(task.status).toBe("APPROVED");
    const s = await addStep(author, task.id, step("Шаг"));
    // The author's own tick is no movement.
    await tickStep(author, s.id, true);
    expect(await getDeleteMode(author, task.id)).toBe("direct");
    await tickStep(author, s.id, false);
    // The manager ticks it (and can't take the task into work for the assignee).
    await tickStep(manager, s.id, true);
    expect(await statusOf(task.id)).toBe("APPROVED");
    expect(await getDeleteMode(author, task.id)).toBe("request");
  });

  it("a repeat copies the steps, not done, with their dates moved; the bin keeps them", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const first = await createTask(
      owner,
      taskInput({
        title: "Еженедельный отчёт",
        assigneeId: member.id,
        startDate: "2026-11-02",
        dueDate: "2026-11-06",
      }),
      "create",
      { repeat: { frequency: "WEEKLY", interval: 1, weekdays: [], monthDay: null, until: null } },
    );
    const s = await addStep(
      owner,
      first.id,
      step("Выгрузить данные", { responsibleId: member.id, dueDate: "2026-11-04" }),
    );
    await addStep(owner, first.id, step("Отправить"));
    await tickStep(member, s.id, true);

    expect(await createRepeatCopies(new Date("2026-11-09T07:00:00Z"))).toBe(1);
    const copy = await db.task.findFirstOrThrow({
      where: { seriesId: first.seriesId, id: { not: first.id } },
    });
    const copied = await listSteps(copy.id);
    expect(
      copied.map((x) => [
        x.title,
        x.doneAt,
        x.responsibleId,
        x.dueDate ? toDateString(x.dueDate) : null,
      ]),
    ).toEqual([
      ["Выгрузить данные", null, member.id, "2026-11-11"],
      ["Отправить", null, null, null],
    ]);

    // Deleted and restored: the steps come back as they were.
    await deleteTask(owner, first.id, "Тест");
    expect(await db.taskStep.count({ where: { taskId: first.id } })).toBe(0);
    await restoreTask(owner, first.id);
    const restored = await listSteps(first.id);
    expect(restored.map((x) => [x.title, x.doneById])).toEqual([
      ["Выгрузить данные", member.id],
      ["Отправить", null],
    ]);
    expect(restored[0]!.doneAt).toBeInstanceOf(Date);
  });
});
