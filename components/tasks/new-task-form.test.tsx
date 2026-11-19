import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ComposeTaskResult } from "@/app/(app)/tasks/actions";
import { LocaleProvider } from "@/components/locale-provider";

import { NewTaskForm } from "./new-task-form";

const users = [
  { id: "me", label: "Тестовый сотрудник" },
  { id: "aziz", label: "Азиз" },
];

function setUp(compose?: (text: string) => Promise<ComposeTaskResult>) {
  const { container } = render(
    <LocaleProvider locale="ru">
      <NewTaskForm
        action={vi.fn()}
        compose={compose}
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

const composed: ComposeTaskResult = {
  ok: true,
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
});
