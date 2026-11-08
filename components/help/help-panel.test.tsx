import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HelpResult } from "@/app/(app)/help-actions";
import { LocaleProvider } from "@/components/locale-provider";

import { HelpPanel, type AskHelp } from "./help-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/tasks/board" }));

function setUp(ask: AskHelp, open = true) {
  const onClose = vi.fn();
  render(
    <LocaleProvider locale="ru">
      <HelpPanel open={open} onClose={onClose} ask={ask} />
    </LocaleProvider>,
  );
  return { onClose, dialog: within(screen.getByRole("dialog", { hidden: true })) };
}

const answered: HelpResult = {
  ok: true,
  answer: "1. Откройте «Новая задача».\n2. Нажмите **«Создать»**.",
  links: [{ href: "/tasks/new", label: "Новая задача" }],
  covered: true,
};

describe("HelpPanel", () => {
  it("offers questions for the page, the warning note and a box to ask", () => {
    const { dialog } = setUp(vi.fn());
    expect(dialog.getByRole("heading", { name: "Помощь" })).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: "Как поставить задачу сотруднику?" }),
    ).toBeInTheDocument();
    expect(dialog.getByText("ИИ может ошибаться — проверьте в разделе.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Спросить" })).toBeDisabled();
  });

  it("stays hidden while closed", () => {
    setUp(vi.fn(), false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks with the page, waits, then shows the answer with links to the app", async () => {
    let finish!: (result: HelpResult) => void;
    const ask = vi.fn<AskHelp>(() => new Promise((resolve) => (finish = resolve)));
    const { dialog } = setUp(ask);

    fireEvent.click(dialog.getByRole("button", { name: "Как поставить задачу сотруднику?" }));
    expect(ask).toHaveBeenCalledWith({
      question: "Как поставить задачу сотруднику?",
      history: [],
      path: "/tasks/board",
    });
    expect(dialog.getByRole("status")).toHaveTextContent("Ищу ответ в руководстве…");
    expect(dialog.getByRole("button", { name: "Спросить" })).toBeDisabled();

    await act(async () => finish(answered));
    expect(dialog.queryByRole("status")).not.toBeInTheDocument();
    const reply = dialog.getByLabelText("Помощь", { selector: "div" });
    expect(within(reply).getAllByRole("listitem")).toHaveLength(2);
    expect(within(reply).getByText("«Создать»").tagName).toBe("STRONG");
    // The page named in the text and the button below both open it.
    const links = within(reply).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/tasks/new", "/tasks/new"]);
  });

  it("sends the conversation with the next question and shows errors without sending them", async () => {
    const ask = vi
      .fn<AskHelp>()
      .mockResolvedValueOnce(answered)
      .mockResolvedValueOnce({ ok: false, error: "ai.errors.limit" })
      .mockResolvedValueOnce(answered);
    const { dialog } = setUp(ask);
    const box = dialog.getByRole("textbox");

    for (const text of ["Первый вопрос", "Второй вопрос", "Третий вопрос"]) {
      fireEvent.change(box, { target: { value: text } });
      // Enter asks; the box empties.
      await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
      expect(box).toHaveValue("");
    }

    expect(dialog.getByRole("alert")).toHaveTextContent("Дневной лимит обращений к ИИ исчерпан");
    expect(ask.mock.calls[2]![0].history).toEqual([
      { role: "user", text: "Первый вопрос" },
      { role: "assistant", text: answered.ok ? answered.answer : "" },
      { role: "user", text: "Второй вопрос" },
    ]);
  });

  it("keeps a failed request inside the sheet", async () => {
    const { dialog } = setUp(vi.fn<AskHelp>().mockRejectedValue(new Error("offline")));
    await act(async () =>
      fireEvent.click(dialog.getByRole("button", { name: "Как поставить задачу сотруднику?" })),
    );
    expect(dialog.getByRole("alert")).toHaveTextContent("Что-то пошло не так");
  });

  it("starts a new conversation and closes", async () => {
    const { dialog, onClose } = setUp(vi.fn<AskHelp>().mockResolvedValue(answered));
    await act(async () =>
      fireEvent.click(dialog.getByRole("button", { name: "Как поставить задачу сотруднику?" })),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Новый разговор" }));
    expect(dialog.getByText("Частые вопросы здесь")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalled();
  });
});
