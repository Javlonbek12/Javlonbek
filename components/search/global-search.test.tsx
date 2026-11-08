import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SearchGroup } from "@/modules/search/types";

import { SearchBar, SearchButton } from "./global-search";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const groups: SearchGroup[] = [
  {
    key: "people",
    hits: [
      {
        id: "person:1",
        title: "Сотрудник (тест)",
        subtitle: "Мерчендайзер",
        href: "/team/1",
        kind: "person",
      },
    ],
  },
  {
    key: "tasks",
    hits: [
      {
        id: "task:1",
        title: "Тест: отчёт",
        subtitle: "В работе",
        href: "/tasks/1",
        kind: "task",
      },
    ],
  },
];

function answer(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("SearchBar", () => {
  it("shows the results grouped by kind and opens one with the keys", async () => {
    const fetch = answer({ groups });
    render(<SearchBar />);
    const field = screen.getByRole("combobox", { name: "Поиск" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "тест" } });

    await screen.findByRole("option", { name: /Сотрудник \(тест\)/ });
    const list = screen.getByRole("listbox");
    expect(fetch).toHaveBeenCalledWith("/api/search?q=%D1%82%D0%B5%D1%81%D1%82", expect.anything());
    expect(within(list).getByRole("group", { name: "Люди" })).toHaveTextContent(
      "Сотрудник (тест)Мерчендайзер",
    );
    expect(within(list).getByRole("option", { name: /Тест: отчёт/ })).toHaveAttribute(
      "href",
      "/tasks/1",
    );

    // The first result is picked; the arrow moves to the next.
    expect(within(list).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/tasks/1");
  });

  it("asks for two letters and says when nothing is found", async () => {
    answer({ groups: [] });
    render(<SearchBar />);
    const field = screen.getByRole("combobox", { name: "Поиск" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "т" } });
    expect(screen.getByText("Введите хотя бы две буквы")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "тестовое" } });
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
    // Enter still looks among the tasks, as the box always did.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/tasks?q=%D1%82%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%BE%D0%B5");
  });

  it("says so when the search fails", async () => {
    answer({ error: "unauthorized" }, 401);
    render(<SearchBar />);
    const field = screen.getByRole("combobox", { name: "Поиск" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "тест" } });
    await waitFor(() =>
      expect(screen.getByText("Поиск не ответил. Попробуйте ещё раз.")).toBeInTheDocument(),
    );
  });
});

describe("SearchButton", () => {
  it("opens the search over the whole screen on phones and closes on a result", async () => {
    answer({ groups });
    render(<SearchButton />);
    fireEvent.click(screen.getByRole("button", { name: "Поиск" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Поиск" }), {
      target: { value: "сотр" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /Сотрудник \(тест\)/ }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
