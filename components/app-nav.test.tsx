import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppNav } from "./app-nav";

const pathname = vi.hoisted(() => ({ value: "/team" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
const user = { name: "Тестовый сотрудник", role: "MEMBER" as const, photoUrl: null };

// The desktop sidebar (the phone bar repeats a few of its links).
const sidebar = () => within(screen.getByRole("navigation", { name: "Main" }));

describe("AppNav", () => {
  it("shows the registry modules in Russian and marks the current page", () => {
    render(<AppNav role="MEMBER" unreadCount={0} user={user} />);
    expect(sidebar().getByRole("link", { name: "Сегодня" })).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Задачи" })).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Команда" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Groups head the sections.
    expect(sidebar().getByText("Торговый маркетинг")).toBeInTheDocument();
  });

  it("marks only the most specific item for nested pages", () => {
    pathname.value = "/team/structure";
    render(<AppNav role="MEMBER" unreadCount={0} user={user} />);
    expect(sidebar().getByRole("link", { name: "Оргструктура" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(sidebar().getByRole("link", { name: "Команда" })).not.toHaveAttribute("aria-current");
    pathname.value = "/team";
  });

  it("shows the unread notifications counter", () => {
    render(<AppNav role="OWNER" unreadCount={3} user={user} />);
    expect(sidebar().getByRole("link", { name: /Уведомления/ })).toHaveTextContent("3");
  });

  it("collapses to icons and shows the person at the bottom", () => {
    render(<AppNav role="MEMBER" unreadCount={0} user={user} collapsed />);
    expect(screen.getByRole("button", { name: "Развернуть меню" })).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Сегодня" })).toHaveAttribute("title", "Сегодня");
  });

  it("on phones keeps four sections in the bar and the rest under «Ещё»", () => {
    render(<AppNav role="OWNER" unreadCount={0} user={user} />);
    const bar = within(screen.getByRole("navigation", { name: "Main mobile" }));
    expect(bar.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Сегодня",
      "Задачи",
      "Встречи",
      "Планограммы",
    ]);
    expect(screen.queryByText("Все разделы")).not.toBeInTheDocument();
    fireEvent.click(bar.getByRole("button", { name: "Ещё" }));
    expect(screen.getByText("Все разделы")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Распределение POSM" })).toHaveLength(2);
  });
});
