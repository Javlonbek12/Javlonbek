import { describe, expect, it } from "vitest";

import { cleanTasks, MAX_COMPOSED_STEPS, MAX_MISSING } from "./prompts";

const base = {
  title: "Отправить POSM",
  assigneeName: null,
  dueDate: "2026-11-22",
  priority: null,
  project: null,
  personal: false,
};

describe("cleanTasks: the written-out parts", () => {
  it("keeps a step's date only when it is a real date no later than the task's due date", () => {
    const [task] = cleanTasks([
      {
        ...base,
        description: "  Что сделать: 12 магазинов\nЗачем: акция  ",
        steps: [
          { title: " Собрать   комплекты ", dueDate: "2026-11-20" },
          { title: "Передать дистрибьютору", dueDate: "2026-11-25" },
          { title: "Проверить", dueDate: "завтра" },
          { title: "  ", dueDate: null },
        ],
        missing: ["  Как понять, что готово? ", ""],
      },
    ]);
    expect(task.description).toBe("Что сделать: 12 магазинов\nЗачем: акция");
    expect(task.steps).toEqual([
      { title: "Собрать комплекты", dueDate: "2026-11-20" },
      { title: "Передать дистрибьютору", dueDate: null },
      { title: "Проверить", dueDate: null },
    ]);
    expect(task.missing).toEqual(["Как понять, что готово?"]);
  });

  it("caps steps and questions, and treats an empty description as none", () => {
    const [task] = cleanTasks([
      {
        ...base,
        dueDate: null,
        description: "   ",
        steps: Array.from({ length: 9 }, (_, i) => ({ title: `Шаг ${i}`, dueDate: "2026-12-01" })),
        missing: Array.from({ length: 7 }, (_, i) => `Вопрос ${i}`),
      },
    ]);
    expect(task.description).toBeNull();
    expect(task.steps).toHaveLength(MAX_COMPOSED_STEPS);
    // No task due date: any real step date stays.
    expect(task.steps?.[0].dueDate).toBe("2026-12-01");
    expect(task.missing).toHaveLength(MAX_MISSING);
  });

  it("works for a task without the written-out parts", () => {
    const [task] = cleanTasks([base]);
    expect(task).toMatchObject({ description: null, steps: [], missing: [] });
  });
});
