import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RouteCode, RouteRecord } from "@/modules/connect/parse";
import type { ConnectQuery } from "@/modules/connect/report";
import { analyzeRoutes, type StaffFilter } from "@/modules/connect/routes";
import type { RoutesBlock } from "@/modules/connect/routes-report";

import { RoutesSection } from "./routes-section";

// Synthetic data only: TSM_TST_* / DR_TST_* zones, stores 9000xx.
const route = (zone: string, store: number, days: Record<string, RouteCode>): RouteRecord => ({
  id: `2026-11|${zone}|${store}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at: "",
  day: "2026-11-15",
  month: "2026-11",
  person: zone,
  staff: zone,
  days,
});
const ROUTES = [
  route("TSM_TST_1", 900001, { "02": "P", "09": "P", "10": "X", "11": "X" }),
  route("DR_TST_1", 900001, { "02": "PD", "09": "PD", "10": "P", "11": "P" }),
  route("DR_TST_1", 900002, { "09": "P", "10": "P", "11": "P" }),
];

const block = (
  level: ConnectQuery["view"],
  staff: StaffFilter = "all",
  person: string | null = null,
): RoutesBlock => {
  const analysis = analyzeRoutes(ROUTES, {
    from: "2026-11-09",
    to: "2026-11-15",
    staff,
    scope: person ? new Set([person]) : null,
  });
  return {
    level,
    staff,
    dataDate: "2026-11-15",
    query: {
      view: level,
      preset: null,
      from: "2026-11-09",
      to: "2026-11-15",
      person,
      staff: staff === "all" ? undefined : staff,
    },
    analysis,
    zone: person ? analysis.zones[0]! : null,
    visitDays: ["2026-11-09", "2026-11-10", "2026-11-11"],
    sales: null,
  };
};

describe("RoutesSection", () => {
  it("shows nothing without routes", () => {
    const { container } = render(<RoutesSection block={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows leadership the totals, the days, the matrix and the organizations", () => {
    render(<RoutesSection block={block("exec")} />);
    expect(screen.getByRole("heading", { name: "Маршруты и дисциплина" })).toBeInTheDocument();
    expect(screen.getByText(/Данные маршрутов по 15 нояб/)).toBeInTheDocument();
    // The switch keeps the level and the period.
    const staff = screen.getByRole("navigation", { name: "Чьи маршруты" });
    expect(
      within(staff)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]),
    ).toEqual([
      ["Все", "/connect?view=exec&from=2026-11-09&to=2026-11-15", "true"],
      ["TSM", "/connect?view=exec&from=2026-11-09&to=2026-11-15&staff=TSM", null],
      ["DR", "/connect?view=exec&from=2026-11-09&to=2026-11-15&staff=DR", null],
    ]);
    expect(screen.getAllByText("Посещаемость").length).toBeGreaterThan(0);
    expect(screen.getByText("Hit rate DR")).toBeInTheDocument();
    expect(screen.getByText("По дням")).toBeInTheDocument();
    expect(screen.getByText("День недели к такому же дню")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Матрица DR: посещаемость × hit rate" }),
    ).toBeInTheDocument();
    // A point per DR zone, with what it stands for.
    expect(screen.getByRole("img", { name: "Матрица DR: посещаемость × hit rate" })).toContainHTML(
      "DR_TST_1: Посещаемость 100%, Hit rate 16,7%",
    );
    expect(screen.getByRole("heading", { name: "TSM: посещаемость по зонам" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Зоны по организациям" })).toBeInTheDocument();
    expect(screen.getByText(/Детализации визитов Smart Up за 9–11 нояб/)).toBeInTheDocument();
  });

  it("shows the zones × days calendars coloured against the targets, the worst zones first", () => {
    render(<RoutesSection block={block("exec")} />);
    const grid = (title: string) => {
      const card = screen.getByRole("heading", { name: title }).closest('[data-slot="card"]')!;
      const [head, ...rows] = within(card as HTMLElement).getAllByRole("row");
      return {
        days: within(head!)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
        rows: rows.map((row) =>
          within(row)
            .getAllByRole("cell")
            .map((td) => [td.textContent, /bg-(emerald|amber|red)/.exec(td.className)?.[1] ?? ""]),
        ),
      };
    };
    // The TSM's week: the 9th made, the 10th and 11th missed — one of three planned visits.
    const tsm = grid("Календарь посещаемости TSM");
    expect(tsm.days.slice(1, -1)).toEqual(["пн9", "вт10", "ср11"]);
    expect(tsm.rows).toHaveLength(1);
    expect(tsm.rows[0]!.slice(0, 3)).toEqual([
      ["1", "emerald"],
      ["0", "red"],
      ["0", "red"],
    ]);
    expect(tsm.rows[0]![3]![0]).toContain("33,3%");
    expect(tsm.rows[0]![3]![0]).toContain("1 / 3");
    // The rep's week by hit rate: one order of two visits on the 9th, none after.
    const dr = grid("Календарь hit rate DR");
    expect(dr.rows[0]!.slice(0, 3)).toEqual([
      ["1", "red"],
      ["0", "red"],
      ["0", "red"],
    ]);
    expect(dr.rows[0]![3]![0]).toContain("16,7%");
    expect(screen.getByText("цель 95% выполнена")).toBeInTheDocument();
    expect(screen.getByText("цель 90% выполнена")).toBeInTheDocument();
  });

  it("leaves the DRs' numbers out for the TSMs alone", () => {
    render(<RoutesSection block={block("exec", "TSM")} />);
    expect(screen.queryByText("Hit rate DR")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Матрица DR/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "TSM: посещаемость по зонам" })).toBeInTheDocument();
  });

  it("shows a manager the zones with the change and the two lists", () => {
    render(<RoutesSection block={block("manager")} />);
    expect(screen.getByRole("heading", { name: "Зоны" })).toBeInTheDocument();
    // A zone opens its own list; the change against the week before is next to the rate.
    expect(
      screen.getAllByRole("link", { name: "TSM_TST_1" }).map((a) => a.getAttribute("href")),
    ).toContain("/connect?view=executor&from=2026-11-09&to=2026-11-15&person=TSM_TST_1");
    expect(screen.getAllByText("▼ 66,7 п.п.").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Пропущены 2 раза подряд и больше" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "DR: 3 визита и больше без заказа" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Матрица DR/ })).not.toBeInTheDocument();
  });

  it("shows an executor their zone and its stores", () => {
    render(<RoutesSection block={block("executor", "all", "DR_TST_1")} />);
    expect(screen.getByRole("heading", { name: "Маршрут DR_TST_1" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Чьи маршруты" })).not.toBeInTheDocument();
    expect(screen.getByText("Точки DR без заказа")).toBeInTheDocument();
    expect(screen.getByText(/DR: 3 визита и больше без заказа · 1/)).toBeInTheDocument();
    expect(screen.getAllByText("Тест магазин 900002").length).toBeGreaterThan(0);
  });
});
