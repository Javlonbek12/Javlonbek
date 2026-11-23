import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { attentionList } from "@/modules/connect/attention";
import type { OosRecord, OosStatus, RouteRecord } from "@/modules/connect/parse";
import { analyzeRecovery, followUps } from "@/modules/connect/recovery";
import { salesCounts } from "@/modules/connect/sales";

import { AttentionSection } from "./attention";
import { FollowUpBlock, RecoveryBlock } from "./recovery-section";
import { Trend } from "./trend";

// Synthetic data only: TSM_TST_* / DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST n.

const WEEK = { from: "2026-11-09", to: "2026-11-15" };
let nextId = 1;
const check = (store: number, at: string, out: number[]): OosRecord => ({
  id: String(nextId++),
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: null,
  channel: null,
  at,
  day: at.slice(0, 10),
  month: at.slice(0, 7),
  person: "TSM_TST_1 - Тест Первый",
  missing: out.length,
  low: 0,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus: Object.fromEntries(out.map((n) => [`SKU-TEST ${n}`, "OUT" as OosStatus])),
});
const CHECKS = [
  check(900001, "2026-11-03T10:00", [1, 2, 3]),
  check(900001, "2026-11-10T10:00", [2, 3, 4]),
];
const ROUTES: RouteRecord[] = [
  {
    id: "2026-11|DR_TST_1|900001",
    storeCode: "900001",
    storeName: "Тест магазин 900001",
    city: null,
    channel: null,
    at: "",
    day: "2026-11-14",
    month: "2026-11",
    person: "DR_TST_1",
    staff: null,
    days: { "11": "PD" },
  },
];
const baseHref = (base: string) => `/connect?view=exec${base === "month" ? "&base=month" : ""}`;

describe("RecoveryBlock", () => {
  it("shows the share, the tables and the stores, with the switch of the baseline", () => {
    render(<RecoveryBlock data={analyzeRecovery(CHECKS, WEEK)} baseHref={baseHref} />);
    expect(screen.getByRole("heading", { name: "Восстановление наличия" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "С чем сравнивать" });
    const [prev, month] = within(nav).getAllByRole("link");
    expect(prev).toHaveTextContent("К предыдущей проверке");
    expect(prev).toHaveAttribute("aria-current", "true");
    expect(prev).toHaveAttribute("href", "/connect?view=exec#recovery");
    expect(month).toHaveTextContent("К началу месяца");
    expect(month).not.toHaveAttribute("aria-current");
    expect(month).toHaveAttribute("href", "/connect?view=exec&base=month#recovery");
    // One of three back.
    expect(screen.getAllByText("33%").length).toBeGreaterThan(0);
    expect(screen.getByText("1 из 3 товаров")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "По сотрудникам" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "По товарам" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Точки, где товара всё ещё нет · 1" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("SKU-TEST 2, SKU-TEST 3").length).toBeGreaterThan(0);
  });

  it("gives an executor only their own numbers and stores", () => {
    render(<RecoveryBlock own data={analyzeRecovery(CHECKS, WEEK)} baseHref={baseHref} />);
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "По сотрудникам" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "По товарам" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Точки, где товара всё ещё нет/ })).toBeVisible();
  });

  it("says so when there is nothing to compare with, and keeps the switch", () => {
    render(
      <RecoveryBlock
        data={analyzeRecovery(CHECKS.slice(1), { ...WEEK, baseline: "month" })}
        baseHref={baseHref}
      />,
    );
    expect(
      screen.getByText("Нет точек, у которых есть более ранняя проверка для сравнения."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К началу месяца" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("FollowUpBlock", () => {
  it("shows the share of checks followed by a rep's order, by zone and by TSM", () => {
    render(<FollowUpBlock data={followUps(CHECKS, ROUTES, WEEK)} />);
    expect(
      screen.getByRole("heading", { name: "Заказ дистрибьютора после OOS (3 дня)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Данные маршрутов по 14 нояб.")).toBeInTheDocument();
    expect(screen.getByText("1 из 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "По зонам DR" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "По ТСМ" })).toBeInTheDocument();
    expect(screen.getAllByText("DR_TST_1").length).toBeGreaterThan(0);
  });
});

describe("AttentionSection", () => {
  const rows = attentionList({
    rows: [
      {
        code: "TSM_TST_1",
        name: "Тест Первый",
        visited: 50,
        connectRate: 54,
        sales: salesCounts([]),
      },
    ],
  }).map((row) => ({ ...row, canOpen: true }));

  it("lists who needs attention with the reasons and a link to their list", () => {
    render(<AttentionSection rows={rows} personHref={(code) => `/connect?person=${code}`} />);
    expect(screen.getByText("Требует внимания · 1")).toBeInTheDocument();
    expect(screen.getAllByText("Connect на 54% визитов (из 50)").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/connect?person=TSM_TST_1");
    // The attendance rule is named only when the route analysis gives the number.
    expect(screen.queryByText(/посещено меньше 85% плана/)).not.toBeInTheDocument();
  });

  it("does not link a TSM the viewer may not open, and names the attendance rule when used", () => {
    render(
      <AttentionSection
        attendance
        rows={rows.map((row) => ({ ...row, canOpen: false }))}
        personHref={(code) => `/connect?person=${code}`}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/посещено меньше 85% плана/)).toBeInTheDocument();
  });

  it("says that everything is within the norm when nobody is listed", () => {
    render(<AttentionSection rows={[]} personHref={() => "/connect"} />);
    expect(screen.getByText("Требует внимания")).toBeInTheDocument();
    expect(screen.getByText("Все показатели в норме.")).toBeInTheDocument();
  });
});

describe("Trend", () => {
  it("shows the change in percentage points: green when better, red when worse", () => {
    const { container, rerender } = render(<Trend change={{ delta: 2, was: 78 }} />);
    expect(container).toHaveTextContent("▲ 2 п.п.");
    expect(container.firstChild).toHaveClass("text-emerald-700");
    expect(container.firstChild).toHaveAttribute("title", "было 78%");
    rerender(<Trend change={{ delta: -3, was: 80 }} />);
    expect(container).toHaveTextContent("▼ 3 п.п.");
    expect(container.firstChild).toHaveClass("text-red-600");
    // Fewer stores with an OOS is better.
    rerender(<Trend change={{ delta: -3, was: 80 }} lowerIsBetter />);
    expect(container.firstChild).toHaveClass("text-emerald-700");
    rerender(<Trend change={{ delta: 0, was: 80 }} />);
    expect(container).toHaveTextContent("0 п.п.");
    expect(container.firstChild).toHaveClass("text-muted-foreground");
    rerender(<Trend change={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
