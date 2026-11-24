import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { IdleStore, ZoneSales, ZoneSalesRow } from "@/modules/connect/zone-sales";

import { changeTone, ZoneSalesSection } from "./zone-sales";

// Synthetic data only: DR_TST_* / TSM_TST_* zones.
const row = (zone: string, kind: "DR" | "TSM", extra: Partial<ZoneSalesRow>): ZoneSalesRow => ({
  zone,
  kind,
  person: `Тест ${zone}`,
  organization: "Тестоград",
  blocks: 120,
  sum: 2_500_000,
  days: 14,
  before: 3_000_000,
  change: -16.7,
  clients: 40,
  buying: 30,
  coverage: 75,
  hitRate: kind === "DR" ? 86.1 : null,
  attendance: 92,
  ...extra,
});
const SALES: ZoneSales = {
  total: { blocks: 5000, sum: 120_000_000, before: 150_000_000, change: -20 },
  outside: { blocks: 900, sum: 30_000_000, share: 25, staff: 3 },
  clients: 80,
  buying: 60,
  rows: [
    row("TSM_TST_1", "TSM", { change: 4.2 }),
    row("DR_TST_1", "DR", {}),
    row("DR_TST_2", "DR", { change: -3, hitRate: 95 }),
    row("DR_TST_3", "DR", { change: null, before: 0, coverage: null, clients: 0, buying: 0 }),
  ],
  idle: [],
  legacy: false,
};
const TARGETS = { attendance: 95, hitRate: 90 };
const show = (extra: Partial<Parameters<typeof ZoneSalesSection>[0]> = {}) =>
  render(
    <ZoneSalesSection
      sales={SALES}
      level="exec"
      targets={TARGETS}
      previous="11 окт. – 1 нояб."
      {...extra}
    />,
  );
const rowsOf = (title: string) => {
  const table = screen.getByRole("heading", { name: title }).parentElement!.querySelector("table")!;
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("cell"));
};

describe("«Продажи по зонам»", () => {
  it("is not there without sales or without zones", () => {
    expect(show({ sales: null }).container).toBeEmptyDOMElement();
    expect(show({ sales: { ...SALES, rows: [] } }).container).toBeEmptyDOMElement();
  });

  it("shows the leadership the totals: the money, the change, the stores, what is outside", () => {
    show();
    expect(screen.getByRole("heading", { name: "Продажи по зонам" })).toBeInTheDocument();
    expect(
      screen.getByText(/к предыдущему периоду такой же длины \(11 окт\. – 1 нояб\.\)/),
    ).toBeVisible();
    expect(screen.getByText("120 млн сум")).toBeInTheDocument();
    expect(screen.getByText("5 000 блоков · все продажи из отчёта")).toBeInTheDocument();
    // A fall of a tenth and more is red.
    expect(screen.getByText("▼ 20%")).toHaveClass("text-red-600");
    expect(screen.getByText("было 150 млн сум")).toBeInTheDocument();
    expect(screen.getByText("60 из 80 · без продаж: 20")).toBeInTheDocument();
    expect(
      screen.getByText("30 млн сум · продавцов без маршрута в анализе: 3"),
    ).toBeInTheDocument();
  });

  it("puts a rep's hit rate and a TSM's attendance next to their sales, coloured", () => {
    show();
    const reps = rowsOf("Торговые представители (DR)");
    expect(reps.map((cells) => cells[0]!.textContent)).toEqual([
      "DR_TST_1Тест DR_TST_1",
      "DR_TST_2Тест DR_TST_2",
      "DR_TST_3Тест DR_TST_3",
    ]);
    // Zone, organization, sold, change, blocks, deliveries, stores with a sale, hit rate.
    expect(reps[0]!.slice(2).map((td) => td.textContent)).toEqual([
      "2,5 млн сум",
      "▼ 16,7%",
      "120",
      "14",
      "75% 30 из 40",
      "86,1%",
    ]);
    const tone = (td: HTMLElement) => /bg-(emerald|amber|red)/.exec(td.innerHTML)?.[1] ?? null;
    // −16.7% is far, −3% close; 86.1% of a 90% target is close, 95% reaches it.
    expect([tone(reps[0]![3]!), tone(reps[0]![7]!)]).toEqual(["red", "amber"]);
    expect([tone(reps[1]![3]!), tone(reps[1]![7]!)]).toEqual(["amber", "emerald"]);
    // Nothing to compare with, no route in the period: dashes, no colour.
    expect([reps[2]![3]!.textContent, reps[2]![6]!.textContent, tone(reps[2]![3]!)]).toEqual([
      "—",
      "—",
      null,
    ]);
    const tsm = rowsOf("TSM — продажи их точкам");
    expect(tsm[0]!.slice(3).map((td) => td.textContent)).toEqual([
      "▲ 4,2%",
      "120",
      "14",
      "75% 30 из 40",
      "92%",
    ]);
    expect([tone(tsm[0]![3]!), tone(tsm[0]![7]!)]).toEqual(["emerald", "amber"]);
  });

  it("links a zone on the managers' level; an executor has their row without the totals", () => {
    const manager = show({ level: "manager", href: (zone) => `/connect?person=${zone}` });
    // (The table and, for a phone, the cards: the link is in both.)
    expect(screen.getAllByRole("link", { name: /DR_TST_1/ })[0]).toHaveAttribute(
      "href",
      "/connect?person=DR_TST_1",
    );
    // «Продано вне маршрутов» is the leadership's.
    expect(screen.queryByText("Продано вне маршрутов")).toBeNull();
    expect(screen.getByText("Продано за период")).toBeInTheDocument();
    manager.unmount();
    show({ level: "executor", sales: { ...SALES, rows: [SALES.rows[1]!] } });
    expect(screen.queryByText("Продано за период")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(rowsOf("Торговые представители (DR)")).toHaveLength(1);
  });

  it("says when some of the period's sales were stored without the rep and the money", () => {
    show({ sales: { ...SALES, legacy: true } });
    expect(screen.getByText(/Загрузите отчёт продаж за эти дни ещё раз/)).toBeInTheDocument();
  });

  it("colours a change: a tenth down and more is far, any fall close, the rest good", () => {
    expect([-100, -10, -9.9, -0.1, 0, 12, null].map(changeTone)).toEqual([
      "bad",
      "bad",
      "warn",
      "warn",
      "good",
      "good",
      null,
    ]);
  });

  it("lists the route stores without a sale, an order with no delivery highlighted", () => {
    const idle = (storeCode: string, extra: Partial<IdleStore>): IdleStore => ({
      storeCode,
      store: `Тест магазин ${storeCode}`,
      zone: "DR_TST_1",
      kind: "DR",
      person: "Тест DR_TST_1",
      organization: "Тестоград",
      grade: null,
      equipment: null,
      visits: 0,
      orders: 0,
      lastSale: null,
      ...extra,
    });
    // Nothing to list: no heading.
    show();
    expect(screen.queryByText(/Точки маршрута без продаж/)).toBeNull();
    document.body.innerHTML = "";

    show({
      sales: {
        ...SALES,
        idle: [
          idle("900001", { grade: "XL", visits: 4, orders: 2, lastSale: "2026-10-20" }),
          idle("900002", { visits: 3 }),
          // The same store on another rep's route: one store, two rows.
          idle("900002", { zone: "DR_TST_2", person: "Тест DR_TST_2" }),
        ],
      },
      href: (zone) => `/connect?person=${zone}`,
    });
    const heading = screen.getByRole("heading", { name: "Точки маршрута без продаж · 2" });
    const rows = within(heading.parentElement!.querySelector("table")!)
      .getAllByRole("row")
      .slice(1);
    expect(
      rows.map((tr) =>
        within(tr)
          .getAllByRole("cell")
          .map((td) => td.textContent),
      ),
    ).toEqual([
      [
        "Тест магазин 900001900001",
        "DR_TST_1Тест DR_TST_1",
        "Тестоград",
        "XL",
        "4",
        "2",
        "20 окт.",
      ],
      ["Тест магазин 900002900002", "DR_TST_1Тест DR_TST_1", "Тестоград", "—", "3", "0", "не было"],
      ["Тест магазин 900002900002", "DR_TST_2Тест DR_TST_2", "Тестоград", "—", "0", "0", "не было"],
    ]);
    // An order marked on the route and no delivery is the one highlighted.
    expect(within(rows[0]!).getByText("2").className).toMatch(/bg-amber/);
    expect(rows[0]!.className).toMatch(/amber/);
    expect(rows[1]!.className).not.toMatch(/red|amber/);
    expect(
      screen.getByText(
        "С отмеченным заказом: 1 · без визитов за период: 0 · не покупали и раньше (в загруженных продажах): 1",
      ),
    ).toBeInTheDocument();
    // The zone opens that person's page.
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/connect?person=DR_TST_1");
  });
});
