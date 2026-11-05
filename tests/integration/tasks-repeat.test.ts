import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import { TaskError } from "@/modules/tasks/errors";
import {
  createRepeatCopies,
  createTask,
  listPlannedRepeats,
  updateTask,
} from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { telegramMock } from "@/tests/helpers/telegram";

const weekly = {
  frequency: "WEEKLY" as const,
  interval: 1,
  weekdays: [],
  monthDay: null,
  until: null,
};
// Midday in Tashkent, so the calendar day is the same in every time zone used here.
const at = (day: string) => new Date(`${day}T07:00:00Z`);

async function seriesTasks(seriesId: string) {
  const tasks = await db.task.findMany({ where: { seriesId }, orderBy: { dueDate: "asc" } });
  return tasks.map((t) => ({ due: toDateString(t.dueDate!), status: t.status, title: t.title }));
}

describe("repeating tasks", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("makes each copy on its start date, once, approved like the first", async () => {
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
      { repeat: weekly },
    );
    const { seriesId } = await db.task.findUniqueOrThrow({ where: { id: first.id } });
    expect(seriesId).toBeTruthy();

    // The next one (due 13 Nov) starts on 9 Nov: nothing before that day.
    expect(await createRepeatCopies(at("2026-11-08"))).toBe(0);
    expect(await createRepeatCopies(at("2026-11-09"))).toBe(1);
    expect(await createRepeatCopies(at("2026-11-09"))).toBe(0);
    const tasks = await seriesTasks(seriesId!);
    expect(tasks).toEqual([
      { due: "2026-11-06", status: "APPROVED", title: "Еженедельный отчёт" },
      { due: "2026-11-13", status: "APPROVED", title: "Еженедельный отчёт" },
    ]);
    const copy = await db.task.findFirstOrThrow({
      where: { seriesId, dueDate: new Date("2026-11-13") },
    });
    expect(copy.assigneeId).toBe(member.id);
    expect(toDateString(copy.startDate!)).toBe("2026-11-09");
  });

  it("catches up on missed copies and stops at the until date", async () => {
    const owner = await createTestUser("OWNER");
    await createTask(
      owner,
      taskInput({ title: "Ежедневная проверка", isPersonal: true, dueDate: "2026-11-02" }),
      "draft",
      {
        repeat: { ...weekly, frequency: "DAILY", until: "2026-11-04" },
      },
    );
    expect(await createRepeatCopies(at("2026-11-10"))).toBe(2);
    const series = await db.taskSeries.findFirstOrThrow();
    expect(series.nextDate).toBeNull();
    const tasks = await seriesTasks(series.id);
    expect(tasks.map((t) => [t.due, t.status])).toEqual([
      ["2026-11-02", "DRAFT"],
      ["2026-11-03", "DRAFT"],
      ["2026-11-04", "DRAFT"],
    ]);
  });

  it("needs a due date; editing changes the rule or stops it", async () => {
    const owner = await createTestUser("OWNER");
    await expect(
      createTask(owner, taskInput({ isPersonal: true, dueDate: null }), "draft", {
        repeat: weekly,
      }),
    ).rejects.toEqual(new TaskError("repeatDate"));
    expect(await db.task.count()).toBe(0);

    const task = await createTask(
      owner,
      taskInput({ isPersonal: true, dueDate: "2026-11-02" }),
      "draft",
      { repeat: weekly },
    );
    // Monthly on the 20th from now on.
    await updateTask(owner, task.id, taskInput({ isPersonal: true, dueDate: "2026-11-02" }), {
      ...weekly,
      frequency: "MONTHLY",
      monthDay: 20,
    });
    const series = await db.taskSeries.findFirstOrThrow();
    expect(toDateString(series.nextDate!)).toBe("2026-11-20");
    // Saving without a repeat stops it; the task stays in the series.
    await updateTask(owner, task.id, taskInput({ isPersonal: true, dueDate: "2026-11-02" }), null);
    expect((await db.taskSeries.findFirstOrThrow()).nextDate).toBeNull();
    expect(await createRepeatCopies(at("2026-12-30"))).toBe(0);
  });

  it("ends the series when all its tasks were deleted", async () => {
    const owner = await createTestUser("OWNER");
    const task = await createTask(
      owner,
      taskInput({ isPersonal: true, dueDate: "2026-11-02" }),
      "draft",
      { repeat: weekly },
    );
    await db.task.delete({ where: { id: task.id } });
    expect(await createRepeatCopies(at("2026-11-20"))).toBe(0);
    expect((await db.taskSeries.findFirstOrThrow()).nextDate).toBeNull();
  });

  it("the calendar shows copies not made yet to those who see the series", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    await createTask(
      owner,
      taskInput({
        title: "Ежемесячная сверка",
        assigneeId: member.id,
        startDate: "2026-11-05",
        dueDate: "2026-11-11",
      }),
      "create",
      { repeat: { ...weekly, frequency: "MONTHLY" } },
    );
    const march = await listPlannedRepeats(member, "mine", "2027-03-01", "2027-04-05");
    expect(march.map((p) => [p.dueDate, p.appearsOn, p.task.title])).toEqual([
      ["2027-03-11", "2027-03-05", "Ежемесячная сверка"],
    ]);
    expect(await listPlannedRepeats(other, "mine", "2027-03-01", "2027-04-05")).toEqual([]);
    expect(await listPlannedRepeats(owner, "team", "2027-03-01", "2027-04-05")).toHaveLength(1);
  });
});
