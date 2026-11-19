import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { ExtractedTask, InterpretedCommand } from "@/modules/ai/prompts";
import { handleCallback, handleText, type ConversationDeps } from "@/modules/bot/conversation";
import { composeTask } from "@/modules/tasks/compose";
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
    expect(result?.values).toEqual({
      title: "Отправить POSM в 12 магазинов",
      assigneeId: users.aziz.id,
      dueDate: "2026-10-10",
      priority: "URGENT",
      project: "Акция ESSE ноябрь",
      description: "Что сделать: шелфтокеры и воблеры\nЗачем: акция с 25-го",
      steps: JSON.stringify(written().steps),
    });
    expect(result?.missing).toEqual(["Как понять, что готово?"]);
    expect(result?.notes).toEqual([]);
  });

  it("says what the form could not fill: an unknown person and project, several tasks", async () => {
    const { result } = await compose([
      written({ assigneeName: "Бобуру", project: "Неизвестный" }),
      written({ title: "Вторая" }),
    ]);
    expect(result?.values.assigneeId).toBeUndefined();
    expect(result?.values.project).toBeUndefined();
    expect(result?.notes).toEqual([
      "В тексте задач: 2. Оформлена первая, остальные поставьте отдельно.",
      "Не нашёл сотрудника «Бобуру» — выберите исполнителя.",
      "Проекта «Неизвестный» нет в списке — выберите проект под «Ещё».",
    ]);
  });

  it("one's own task goes to oneself; a personal one ticks «Личная задача»", async () => {
    const own = await compose([written({ assigneeName: null, steps: [], description: null })]);
    expect(own.result?.values).toMatchObject({ assigneeId: own.users.owner.id });
    expect(own.result?.values.steps).toBeUndefined();
    expect(own.result?.values.description).toBeUndefined();
    await resetDb();
    const personal = await compose([written({ assigneeName: null, personal: true })]);
    expect(personal.result?.values.isPersonal).toBe("on");
    expect(personal.result?.values.assigneeId).toBeUndefined();
  });

  it("no task in the text: nothing to fill", async () => {
    expect((await compose([])).result).toBeNull();
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
