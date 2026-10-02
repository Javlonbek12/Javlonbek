import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppNav } from "./app-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/team" }));

describe("AppNav", () => {
  it("shows the registry modules in Russian and marks the current page", () => {
    render(<AppNav role="MEMBER" unreadCount={0} />);
    expect(screen.getByRole("link", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Задачи" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Команда" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the unread notifications counter", () => {
    render(<AppNav role="OWNER" unreadCount={3} />);
    expect(screen.getByRole("link", { name: /Уведомления/ })).toHaveTextContent("3");
  });
});
