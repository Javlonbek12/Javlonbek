import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PeriodPicker } from "./period-picker";

const chips = [
  { key: "1", label: "1 мес.", href: "/x?months=1", dates: "1–8 нояб." },
  { key: "3", label: "3 мес.", href: "/x?months=3", dates: "1 сент. – 8 нояб." },
];

describe("PeriodPicker", () => {
  it("chips are links that apply at once; the chosen dates are written beside them", () => {
    render(<PeriodPicker label="Прошедшие:" chips={chips} active="3" dates="1 сент. – 8 нояб." />);
    const three = screen.getByRole("link", { name: "3 мес." });
    expect(three.getAttribute("href")).toBe("/x?months=3");
    expect(three.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "1 мес." }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Прошедшие:")).toBeTruthy();
    expect(screen.getByText("1 сент. – 8 нояб.")).toBeTruthy();
    // No «Показать» button: nothing to submit.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("own dates: a small form that keeps the page's other parameters, open when chosen", () => {
    const { container } = render(
      <PeriodPicker
        chips={chips}
        active={null}
        custom={{
          label: "Свои даты…",
          apply: "Применить",
          fromLabel: "С",
          toLabel: "По",
          type: "month",
          from: "2026-08",
          to: "2026-10",
          action: "/connect",
          params: { view: "manager" },
        }}
        step={{ prev: "/x?p", next: "/x?n", prevLabel: "Назад", nextLabel: "Вперёд" }}
      />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/connect");
    expect((form.querySelector('input[name="view"]') as HTMLInputElement).value).toBe("manager");
    expect((screen.getByLabelText("С") as HTMLInputElement).value).toBe("2026-08");
    expect(screen.getByRole("link", { name: "Назад" }).getAttribute("href")).toBe("/x?p");
    expect(screen.getByRole("button", { name: "Применить" })).toBeTruthy();
  });
});
