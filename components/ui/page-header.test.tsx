import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("shows the title, the line under it and the buttons", () => {
    render(
      <LocaleProvider locale="ru">
        <PageHeader title="Команда" actions={<button type="button">Пригласить</button>}>
          2–8 нояб.
        </PageHeader>
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Команда" })).toBeInTheDocument();
    expect(screen.getByText("2–8 нояб.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пригласить" })).toBeInTheDocument();
  });

  it("keeps the description behind the «?»", () => {
    render(
      <LocaleProvider locale="ru">
        <PageHeader title="Распределение POSM" hint="Как идёт кампания" />
      </LocaleProvider>,
    );
    const hint = screen.getByText("Как идёт кампания");
    expect(hint).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Что это?" }));
    expect(hint).toBeVisible();
  });
});
