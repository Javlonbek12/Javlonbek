import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppNav } from "./app-nav";

const pathname = vi.hoisted(() => ({ value: "/team" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
const user = { name: "Тестовый сотрудник", role: "MEMBER" as const, photoUrl: null };

describe("AppNav", () => {
  it("shows the registry modules in Russian and marks the current page", () => {
    render(<AppNav role="MEMBER" unreadCount={0} user={user} />);
    expect(screen.getByRole("link", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Задачи" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Команда" })).toHaveAttribute("aria-current", "page");
  });

  it("marks only the most specific item for nested pages", () => {
    pathname.value = "/team/structure";
    render(<AppNav role="MEMBER" unreadCount={0} user={user} />);
    expect(screen.getByRole("link", { name: "Оргструктура" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Команда" })).not.toHaveAttribute("aria-current");
    pathname.value = "/team";
  });

  it("shows the unread notifications counter", () => {
    render(<AppNav role="OWNER" unreadCount={3} user={user} />);
    expect(screen.getByRole("link", { name: /Уведомления/ })).toHaveTextContent("3");
  });

  it("collapses to icons and shows the person at the bottom", () => {
    render(<AppNav role="MEMBER" unreadCount={0} user={user} collapsed />);
    expect(screen.getByRole("button", { name: "Развернуть меню" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сегодня" })).toHaveAttribute("title", "Сегодня");
  });
});
