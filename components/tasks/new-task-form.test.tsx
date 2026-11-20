import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ComposeTaskResult, CreateComposedResult } from "@/app/(app)/tasks/actions";
import { LocaleProvider } from "@/components/locale-provider";

import { NewTaskForm } from "./new-task-form";

const users = [
  { id: "me", label: "Тестовый сотрудник" },
  { id: "aziz", label: "Азиз" },
];

function setUp(
  compose?: (text: string) => Promise<ComposeTaskResult>,
  createMany: (tasks: unknown) => Promise<CreateComposedResult> = vi.fn(),
) {
  const { container } = render(
    <LocaleProvider locale="ru">
      <NewTaskForm
        action={vi.fn()}
        compose={compose}
        createMany={createMany}
        isNew
        today="2026-11-19"
        initial={{ assigneeId: "me", priority: "MEDIUM", dueDate: "" }}
        users={users}
        plans={[]}
        projects={[{ name: "Акция ESSE", phases: [] }]}
      />
    </LocaleProvider>,
  );
  const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  return { field };
}

const posm = {
  values: {
    title: "Отправить POSM в 12 магазинов",
    assigneeId: "aziz",
    dueDate: "2026-11-22",
    priority: "URGENT",
    project: "Акция ESSE",
    description: "Что сделать: шелфтокеры\nЗачем: акция с 25-го",
    steps: JSON.stringify([
      { title: "Собрать комплекты", dueDate: "2026-11-20" },
      { title: "Передать дистрибьютору", dueDate: null },
    ]),
  },
  missing: ["Как понять, что готово?"],
  notes: [],
};
const composed: ComposeTaskResult = { ok: true, tasks: [posm] };

async function writeUp(text: string) {
  fireEvent.click(screen.getByRole("button", { name: /Оформить с ИИ/ }));
  fireEvent.change(screen.getByLabelText("Задача своими словами"), { target: { value: text } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Оформить" })));
}

describe("NewTaskForm: «Оформить с ИИ»", () => {
  it("is not offered without AI", () => {
    setUp();
    expect(screen.queryByRole("button", { name: /Оформить с ИИ/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать" })).toBeInTheDocument();
  });

  it("fills the form, lists the steps and says what is missing", async () => {
    const compose = vi.fn(async () => composed);
    const { field } = setUp(compose);
    await writeUp("азизу posm 12 магазинов до пятницы срочно");
    expect(compose).toHaveBeenCalledWith("азизу posm 12 магазинов до пятницы срочно");

    expect(field("title")?.value).toBe("Отправить POSM в 12 магазинов");
    expect(field("assigneeId")?.value).toBe("aziz");
    expect(field("dueDate")?.value).toBe("2026-11-22");
    expect(field("priority")?.value).toBe("URGENT");
    expect(field("project")?.value).toBe("Акция ESSE");
    expect(field("description")?.value).toBe("Что сделать: шелфтокеры\nЗачем: акция с 25-го");
    expect(screen.getByText("Собрать комплекты")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Как понять, что готово?");

    // A step taken out is not sent with the form.
    fireEvent.click(screen.getAllByRole("button", { name: "Убрать шаг" })[0]);
    expect(JSON.parse(field("steps")!.value)).toEqual([
      { title: "Передать дистрибьютору", dueDate: null },
    ]);
  });

  it("shows the AI's error and leaves the form as it was", async () => {
    const { field } = setUp(async () => ({ ok: false, error: "ai.errors.limit" }));
    await writeUp("что-то");
    expect(screen.getByRole("alert")).toHaveTextContent("Дневной лимит обращений к ИИ исчерпан");
    expect(field("title")?.value).toBe("");
    expect(field("steps")).toBeNull();
  });

  it("several tasks in the text: a list to check, then «Создать все»", async () => {
    const createMany = vi.fn(async () => ({ ok: true as const, saved: 2, pending: 1, errors: [] }));
    setUp(
      async (): Promise<ComposeTaskResult> => ({
        ok: true,
        tasks: [
          posm,
          {
            values: { title: "Созвониться с дистрибьютором", dueDate: "2026-11-20" },
            missing: [],
            notes: ["Не нашёл сотрудника «Бобуру» — выберите исполнителя."],
          },
          { values: { title: "Лишняя", assigneeId: "me" }, missing: [], notes: [] },
        ],
      }),
      createMany,
    );
    await writeUp("три дела");
    expect(screen.getByRole("status")).toHaveTextContent("Найдено задач: 3");
    // The one-task form gives way to the list.
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Не нашёл сотрудника «Бобуру» — выберите исполнителя."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Убрать задачу 3" }));
    // The second task has nobody yet: asked for before anything is sent.
    fireEvent.click(screen.getByRole("button", { name: "Создать все (2)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("У задачи 2 не выбран исполнитель.");
    expect(createMany).not.toHaveBeenCalled();

    const second = within(screen.getByRole("group", { name: "Задача 2" }));
    fireEvent.change(second.getByLabelText("Исполнитель"), { target: { value: "me" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Создать все (2)" })));
    expect(createMany).toHaveBeenCalledWith([
      {
        title: "Отправить POSM в 12 магазинов",
        assigneeId: "aziz",
        personal: false,
        dueDate: "2026-11-22",
        priority: "URGENT",
        project: "Акция ESSE",
        description: "Что сделать: шелфтокеры\nЗачем: акция с 25-го",
        steps: [
          { title: "Собрать комплекты", dueDate: "2026-11-20" },
          { title: "Передать дистрибьютору", dueDate: null },
        ],
      },
      {
        title: "Созвониться с дистрибьютором",
        assigneeId: "me",
        personal: false,
        dueDate: "2026-11-20",
        priority: "MEDIUM",
        project: null,
        description: null,
        steps: [],
      },
    ]);
    expect(screen.getByText("Создано задач: 2.")).toBeInTheDocument();
    expect(screen.getByText("Отправлено на утверждение: 1.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К задачам" })).toHaveAttribute("href", "/tasks");
  });
});
