import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { ExtractedTask, InterpretedCommand } from "@/modules/ai/prompts";
import { handleCallback, handleText, type ConversationDeps } from "@/modules/bot/conversation";
import { createProposedTasks } from "@/modules/tasks/batch";
import { composeTask, parseTasksToCreate } from "@/modules/tasks/compose";
import { addInitialSteps } from "@/modules/tasks/steps";
import { createTask } from "@/modules/tasks/service";
import { TODAY } from "@/tests/fixtures/phrases";
import { resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";
import { createFixtureTeam } from "@/tests/helpers/team";

// «Оформить с ИИ»: the task in one's own words written out (description, steps, what is missing),
// in the bot's card and on the new task form. The model is faked.

const NOW = new Date(`${TODAY}T09:00:00+05:00`);
const CHAT = 9000001n;
const create: InterpretedCommand = { intent: "create_tasks", taskQuery: null, newDueDate: null };

const written = (over: Partial<ExtractedTask> = {}): ExtractedTask => ({
  title: "Отправить POSM в 12 магазинов",
  assigneeName: "Азизу",
  dueDate: "2026-10-10",
  priority: "URGENT",
  project: null,
  personal: false,
  description: "Что сделать: шелфтокеры и воблеры\nЗачем: акция с 25-го",
  steps: [
    { title: "Собрать комплекты", dueDate: "2026-10-08" },
    { title: "Передать дистрибьютору", dueDate: null },
  ],
  missing: ["Как понять, что готово?"],
  ...over,
});

const deps = (tasks: ExtractedTask[]): ConversationDeps => ({
  now: NOW,
  interpret: async () => create,
  extract: async () => tasks,
});

describe("bot: the card with the written-out task", () => {
  beforeEach(resetDb);

  it("shows the description, steps and questions, and saves the description and the steps", async () => {
    const users = await createFixtureTeam();
    const reply = await handleText(users.owner, CHAT, "азизу posm", deps([written()]));
    expect(reply.text).toContain("📝 Что сделать: шелфтокеры и воблеры");
    expect(reply.text).toContain("1) Собрать комплекты");
    expect(reply.text).toContain("❓ Как понять, что готово?");

    await handleCallback(users.owner, `d:${reply.draftId}:save`);
    const task = await db.task.findFirstOrThrow({
      include: { steps: { orderBy: { position: "asc" } } },
    });
    expect(task.description).toBe("Что сделать: шелфтокеры и воблеры\nЗачем: акция с 25-го");
    expect(task.steps.map((s) => [s.title, s.dueDate?.toISOString().slice(0, 10) ?? null])).toEqual(
      [
        ["Собрать комплекты", "2026-10-08"],
        ["Передать дистрибьютору", null],
      ],
    );
  });

  it("«Без описания и шагов» saves the task as a bare title", async () => {
    const users = await createFixtureTeam();
    const reply = await handleText(users.owner, CHAT, "азизу posm", deps([written()]));
    const menu = await handleCallback(users.owner, `d:${reply.draftId}:e:0`);
    expect(menu.buttons?.flat().map((b) => b.data)).toContain(`d:${reply.draftId}:pl:0`);
    const card = await handleCallback(users.owner, `d:${reply.draftId}:pl:0`);
    expect(card.text).not.toContain("📝");
    expect(card.text).not.toContain("❓");
    await handleCallback(users.owner, `d:${reply.draftId}:save`);
    const task = await db.task.findFirstOrThrow({ include: { steps: true } });
    expect(task.description).toBeNull();
    expect(task.steps).toHaveLength(0);
  });
});

describe("form: composeTask", () => {
  beforeEach(resetDb);

  async function compose(tasks: ExtractedTask[], projects: string[] = []) {
    const users = await createFixtureTeam();
    const result = await composeTask(users.owner, "текст", {
      assignableIds: Object.values(users).map((u) => u.id),
      projects,
      extract: async () => tasks,
      now: NOW,
    });
    return { users, result };
  }

  it("fills the form's fields from the written-out task", async () => {
    const { users, result } = await compose(
      [written({ project: "акция esse ноябрь" })],
      ["Акция ESSE ноябрь"],
    );
    expect(result?.tasks).toHaveLength(1);
    const [task] = result!.tasks;
    expect(task.values).toEqual({
      title: "Отправить POSM в 12 магазинов",
      assigneeId: users.aziz.id,
      dueDate: "2026-10-10",
      priority: "URGENT",
      project: "Акция ESSE ноябрь",
      description: "Что сделать: шелфтокеры и воблеры\nЗачем: акция с 25-го",
      steps: JSON.stringify(written().steps),
    });
    expect(task.missing).toEqual(["Как понять, что готово?"]);
    expect(task.notes).toEqual([]);
  });

  it("gives every task of the text, each saying what the form could not fill", async () => {
    const { users, result } = await compose([
      written({ assigneeName: "Бобуру", project: "Неизвестный" }),
      written({ title: "Созвониться с дистрибьютором", assigneeName: "Дильнозе", steps: [] }),
    ]);
    expect(result?.tasks.map((task) => task.values.title)).toEqual([
      "Отправить POSM в 12 магазинов",
      "Созвониться с дистрибьютором",
    ]);
    const [first, second] = result!.tasks;
    expect(first.values.assigneeId).toBeUndefined();
    expect(first.values.project).toBeUndefined();
    expect(first.notes).toEqual([
      "Не нашёл сотрудника «Бобуру» — выберите исполнителя.",
      "Проекта «Неизвестный» нет в списке — выберите проект под «Ещё».",
    ]);
    expect(second.values.assigneeId).toBe(users.dilnoza.id);
    expect(second.values.steps).toBeUndefined();
  });

  it("one's own task goes to oneself; a personal one ticks «Личная задача»", async () => {
    const own = await compose([written({ assigneeName: null, steps: [], description: null })]);
    const [ownTask] = own.result!.tasks;
    expect(ownTask.values).toMatchObject({ assigneeId: own.users.owner.id });
    expect(ownTask.values.steps).toBeUndefined();
    expect(ownTask.values.description).toBeUndefined();
    await resetDb();
    const personal = await compose([written({ assigneeName: null, personal: true })]);
    expect(personal.result!.tasks[0].values.isPersonal).toBe("on");
    expect(personal.result!.tasks[0].values.assigneeId).toBeUndefined();
  });

  it("no task in the text: nothing to fill", async () => {
    expect((await compose([])).result).toBeNull();
  });
});

describe("form: «Создать все»", () => {
  beforeEach(resetDb);

  const item = (over: Record<string, unknown> = {}) => ({
    title: "  Отправить   POSM ",
    assigneeId: null as string | null,
    personal: false,
    dueDate: "2026-10-10",
    priority: "HIGH",
    project: null,
    description: "Что сделать: 12 магазинов",
    steps: [
      { title: "Собрать комплекты", dueDate: "2026-10-08" },
      { title: "Передать", dueDate: "не дата" },
    ],
    ...over,
  });

  it("checks the list: a task needs a title and an assignee (or is personal)", () => {
    expect(parseTasksToCreate([])).toBeNull();
    expect(parseTasksToCreate("x")).toBeNull();
    expect(parseTasksToCreate([item({ assigneeId: "u1", title: "  " })])).toBeNull();
    expect(parseTasksToCreate([item()])).toBeNull();
    expect(parseTasksToCreate([item({ personal: true, assigneeId: "u1" })])).toEqual([
      {
        title: "Отправить POSM",
        assigneeId: null,
        personal: true,
        dueDate: "2026-10-10",
        priority: "HIGH",
        project: null,
        description: "Что сделать: 12 магазинов",
        steps: [
          { title: "Собрать комплекты", dueDate: "2026-10-08" },
          { title: "Передать", dueDate: null },
        ],
      },
    ]);
  });

  it("creates every task along its route, each with its description and steps", async () => {
    const users = await createFixtureTeam();
    const tasks = parseTasksToCreate([
      item({ assigneeId: users.aziz.id }),
      item({ title: "Созвониться", assigneeId: users.owner.id, steps: [], description: null }),
    ])!;
    const result = await createProposedTasks(users.owner, tasks);
    expect(result).toEqual({ saved: 2, pending: 0, errors: [] });
    const created = await db.task.findMany({
      orderBy: { createdAt: "asc" },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    expect(created.map((task) => [task.title, task.assigneeId, task.steps.length])).toEqual([
      ["Отправить POSM", users.aziz.id, 2],
      ["Созвониться", users.owner.id, 0],
    ]);
    expect(created[0].description).toBe("Что сделать: 12 магазинов");
    expect(created[0].priority).toBe("HIGH");
  });
});

describe("addInitialSteps", () => {
  beforeEach(resetDb);

  it("adds the steps in order; a step that does not fit is left out", async () => {
    const users = await createFixtureTeam();
    const task = await createTask(users.owner, taskInput({ assigneeId: users.aziz.id }), "create");
    await addInitialSteps(users.owner, task.id, [
      { title: "Первый", dueDate: "2026-10-08" },
      { title: "   ", dueDate: null },
      { title: "Второй", dueDate: null },
    ]);
    const steps = await db.taskStep.findMany({
      where: { taskId: task.id },
      orderBy: { position: "asc" },
    });
    expect(steps.map((s) => s.title)).toEqual(["Первый", "Второй"]);
  });
});
