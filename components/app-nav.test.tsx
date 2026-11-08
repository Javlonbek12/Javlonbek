import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppNav, MobileHeader, TopBar } from "./app-nav";

const pathname = vi.hoisted(() => ({ value: "/team" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
const savePhoneBar = vi.hoisted(() => vi.fn(async (ids: string[]) => ids));
vi.mock("@/app/(app)/shell-actions", () => ({ savePhoneBarAction: savePhoneBar }));
const user = { name: "Тестовый сотрудник", role: "MEMBER" as const, photoUrl: null };

// The desktop sidebar (the phone bar repeats a few of its links).
const sidebar = () => within(screen.getByRole("navigation", { name: "Main" }));
const phoneBar = () => within(screen.getByRole("navigation", { name: "Main mobile" }));
const barLinks = () =>
  phoneBar()
    .getAllByRole("link")
    .map((link) => link.textContent);

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
    expect(barLinks()).toEqual(["Сегодня", "Задачи", "Встречи", "Планограммы"]);
    expect(screen.queryByText("Все разделы")).not.toBeInTheDocument();
    fireEvent.click(phoneBar().getByRole("button", { name: "Ещё" }));
    expect(screen.getByText("Все разделы")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Распределение POSM" })).toHaveLength(2);
  });

  it("«Ещё» starts with the person, skips the header's bell and gear, has no counter", () => {
    render(<AppNav role="OWNER" unreadCount={7} user={user} />);
    const more = phoneBar().getByRole("button", { name: "Ещё" });
    // The unread counter is on the header's bell only.
    expect(more).not.toHaveTextContent("7");
    fireEvent.click(more);
    expect(
      screen.getByRole("link", { name: /Тестовый сотрудник.*Сотрудник · профиль и настройки/ }),
    ).toHaveAttribute("href", "/settings");
    // Only the sidebar has them now.
    expect(screen.getAllByRole("link", { name: /Уведомления/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Настройки" })).toHaveLength(1);
    // «Работа» would hold only «Проекты»: it joins the next group.
    expect(screen.getByText("Работа и торговый маркетинг")).toBeInTheDocument();
  });

  it("puts the person's own sections in the bar", () => {
    render(
      <AppNav role="OWNER" unreadCount={0} user={user} phoneBar={["content", "distribution"]} />,
    );
    expect(barLinks()).toEqual(["Распределение POSM", "Контент-план"]);
  });

  it("lets the person choose up to four sections for the bar", async () => {
    render(<AppNav role="OWNER" unreadCount={0} user={user} />);
    fireEvent.click(phoneBar().getByRole("button", { name: "Ещё" }));
    fireEvent.click(screen.getByRole("button", { name: "Выбрать разделы для нижней панели" }));
    // Four are ticked already: a fifth can't be added until one is taken off.
    expect(screen.getByRole("checkbox", { name: "Контент-план" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Встречи" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Контент-план" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Сохранить" })));
    expect(savePhoneBar).toHaveBeenCalledWith(["home", "tasks", "planograms", "content"]);
    expect(barLinks()).toEqual(["Сегодня", "Задачи", "Планограммы", "Контент-план"]);
  });
});

describe("TopBar and MobileHeader", () => {
  const bars = { unreadCount: 4, theme: "light" as const, timer: null };

  it("offers a small «+» for a new task except on «Сегодня» and the task pages", () => {
    pathname.value = "/team";
    const { unmount } = render(<TopBar {...bars} />);
    expect(screen.getByRole("link", { name: "Новая задача" })).toHaveAttribute(
      "href",
      "/tasks/new",
    );
    unmount();
    pathname.value = "/tasks/board";
    render(<TopBar {...bars} />);
    expect(screen.queryByRole("link", { name: "Новая задача" })).not.toBeInTheDocument();
    pathname.value = "/team";
  });

  it("shows the next theme on the button and goes light → dark → as on the phone", () => {
    // A light phone.
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<TopBar {...bars} />);
    const toDark = screen.getByRole("button", { name: "Включить тёмную тему" });
    fireEvent.click(toDark);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.cookie).toContain("theme=dark");
    fireEvent.click(screen.getByRole("button", { name: "Тема как в телефоне" }));
    expect(document.documentElement.dataset.theme).toBe("system");
    expect(document.documentElement).not.toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Включить светлую тему" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    vi.unstubAllGlobals();
  });

  it("on phones has the search and the only unread counter, and a slot for extra buttons", () => {
    render(<MobileHeader {...bars} extra={<button type="button">Помощь (тест)</button>} />);
    expect(screen.getByRole("button", { name: "Поиск" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Уведомления" })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Помощь (тест)" })).toBeInTheDocument();
  });
});
