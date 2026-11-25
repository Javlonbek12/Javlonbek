import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { indexPathSales, oosPath, pathChains, repRoutes } from "@/modules/connect/oos-path";
import type {
  OosRecord,
  OosStatus,
  OrderRecord,
  RouteRecord,
  SaleDayRecord,
} from "@/modules/connect/parse";

import { OosPathSection } from "./oos-path";
import { SECTION_ATTRIBUTE } from "./section-anchor";

// Synthetic data only: TSM_TST_* / DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST n.

const check = (
  id: number,
  store: number,
  day: string,
  code: string,
  out: number[],
  delivery: string | null = null,
): OosRecord => ({
  id: String(id),
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: null,
  channel: null,
  at: `${day}T10:00`,
  day,
  month: day.slice(0, 7),
  person: `${code} - Тест ${code}`,
  missing: out.length,
  low: 0,
  orderCreated: delivery !== null,
  orderNo: delivery === null ? null : `#TEST-${id}`,
  delivery,
  skus: Object.fromEntries(out.map((n) => [`SKU-TEST ${n}`, "OUT" as OosStatus])),
});
const route = (zone: string, store: number): RouteRecord => ({
  id: `2026-11|${zone}|${store}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: null,
  channel: null,
  at: "",
  day: "2026-11-14",
  month: "2026-11",
  person: zone,
  staff: zone,
  days: { "10": "P" },
});
const sale = (store: number, day: string, skus: Record<string, number>): SaleDayRecord => ({
  id: `${store}|${day}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: null,
  channel: null,
  at: `${day}T00:00`,
  day,
  month: day.slice(0, 7),
  person: null,
  skus,
});

const CHECKS = [
  // Delivered, and Smart Up shows another product only.
  check(1, 900001, "2026-11-10", "TSM_TST_1", [1, 2, 3, 4, 5], "Доставлено и подтверждено точкой"),
  // No order, and the product was sold all the same.
  check(2, 900002, "2026-11-10", "TSM_TST_1", [1]),
  // The store chose a date; the rep has not answered.
  check(3, 900003, "2026-11-11", "TSM_TST_2", [1], "Точка выбрала дату — ожидает агента"),
  // No order and no sale.
  check(4, 900004, "2026-11-11", "TSM_TST_2", [1]),
  // A status the bot did not have before.
  check(5, 900005, "2026-11-11", "TSM_TST_2", [1], "Тестовый новый статус"),
];
const ROUTES = [route("DR_TST_1", 900001), route("DR_TST_1", 900003), route("DR_TST_2", 900002)];
const SALES = [
  sale(900001, "2026-11-11", { "SKU-TEST 9": 1 }),
  sale(900002, "2026-11-12", { "SKU-TEST 1": 1 }),
];
const RANGE = { from: "2026-11-01", to: "2026-11-20" };
const ORDERS: OrderRecord[] = [];

const build = (scope: Set<string> | null = null, sales = true) =>
  oosPath(pathChains({ oos: CHECKS, orders: ORDERS, reps: repRoutes(ROUTES), scope }), {
    sales: sales ? indexPathSales(SALES, RANGE) : null,
    regions: new Map([
      ["tsm tst 1", "Тест регион 1"],
      ["tsm tst 2", "Тест регион 2"],
    ]),
    scope,
  });
const heading = (name: string | RegExp) => screen.queryByRole("heading", { name });

describe("OosPathSection", () => {
  it("shows leadership the funnel, the mismatches and who stands behind them", () => {
    const { container } = render(<OosPathSection data={build()} level="exec" />);
    expect(heading("Путь OOS: от проверки до продажи")).toBeInTheDocument();
    // The chip of the page's list of sections is short.
    expect(container.firstElementChild).toHaveAttribute(SECTION_ATTRIBUTE, "Путь OOS");

    // The six stages in order, each with its number.
    const stages = within(screen.getAllByRole("list")[0]!).getAllByRole("listitem");
    expect(stages.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1\. Найден OOS5/),
      expect.stringMatching(/^2\. Заказ создан360% от предыдущего шагаБез заказа: 2/),
      expect.stringMatching(/^3\. Точка выбрала дату267% от предыдущего шагаТочка не приняла: 1/),
      expect.stringMatching(/^4\. DR принял150% от предыдущего шагаDR не ответил: 1/),
      expect.stringMatching(/^5\. Доставлено1100% от предыдущего шагаподтверждено точкой: 1/),
      expect.stringMatching(
        /^6\. Продано в Smart Up00% от предыдущего шагаДоставлено без продажи: 1/,
      ),
    ]);
    // The steps are the bot's, the sale is Smart Up's.
    expect(stages.slice(0, 5).every((li) => within(li).queryByText("Connect-бот"))).toBe(true);
    expect(within(stages[5]!).getByText("Smart Up")).toBeInTheDocument();
    expect(within(stages[5]!).queryByText("Connect-бот")).not.toBeInTheDocument();
    // An unknown status is shown, not dropped.
    expect(within(stages[2]!).getByText(/статус не распознан 1/)).toBeInTheDocument();
    expect(screen.getAllByText("Статус не распознан").length).toBeGreaterThan(0);
    // Delivered and not sold is red; sold without an order is marked as well.
    expect(screen.getByText("Доставлено без продажи: 1")).toHaveClass("text-red-600");
    expect(stages[5]).toHaveClass("border-red-400");
    expect(
      screen.getByText(
        "В боте «Доставлено», а в Smart Up нет продажи этих товаров: 1 из 1 доставок.",
      ),
    ).toHaveClass("border-l-red-500");
    expect(screen.getByText(/товар всё равно продан: 1\./)).toHaveClass("border-l-amber-400");
    expect(screen.getByText("1 из 5 проверок")).toBeInTheDocument();
    expect(screen.getByText("Данные продаж по 20 нояб.")).toBeInTheDocument();

    expect(heading("На каком шаге остановились и что продано")).toBeInTheDocument();
    expect(heading("Путь OOS по регионам")).toBeInTheDocument();
    expect(heading("Путь OOS по ТСМ")).toBeInTheDocument();
    expect(heading("Путь OOS по зонам DR")).toBeInTheDocument();
    // No employee info: no table by manager; the chains are in the file.
    expect(heading("Путь OOS по руководителям")).not.toBeInTheDocument();
    expect(heading(/Что проверить/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The stores on no rep's route are one row.
    expect(screen.getAllByText("DR не определён").length).toBeGreaterThan(0);
  });

  it("gives a manager links to their people and the chains to act on", () => {
    render(
      <OosPathSection
        data={build()}
        level="manager"
        href={(code) => `/connect?view=executor&person=${code}`}
      />,
    );
    expect(heading("Путь OOS по регионам")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /TSM_TST_2/ })[0]).toHaveAttribute(
      "href",
      "/connect?view=executor&person=TSM_TST_2",
    );
    expect(screen.getAllByRole("link", { name: "DR_TST_1" })[0]).toHaveAttribute(
      "href",
      "/connect?view=executor&person=DR_TST_1",
    );
    expect(heading("Что проверить · 3")).toBeInTheDocument();
    // The table and the phone's cards both hold the rows.
    const [first] = screen.getAllByText("Тест магазин 900001");
    const row = within(first!.closest("li, tr") as HTMLElement);
    expect(row.getByText("Доставлено, продажи нет")).toHaveClass("bg-red-500/20");
    expect(row.getByText("5 тов.")).toBeInTheDocument();
    // The first four products, then how many more.
    expect(
      row.getByText("SKU-TEST 1, SKU-TEST 2, SKU-TEST 3, SKU-TEST 4 и ещё 1"),
    ).toBeInTheDocument();
    expect(row.getByText("#TEST-1")).toBeInTheDocument();
    expect(row.getByText("Не проданы (точке продали другое)")).toBeInTheDocument();
    expect(screen.getAllByText("DR не ответил").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Нет заказа и нет продажи").length).toBeGreaterThan(0);
  });

  it("shows an executor their own funnel and chains", () => {
    render(<OosPathSection data={build(new Set(["TSM_TST_2"]))} level="executor" />);
    expect(screen.getByText("Без заказа: 1")).toBeInTheDocument();
    expect(heading("Что проверить · 2")).toBeInTheDocument();
    expect(heading("Путь OOS по ТСМ")).not.toBeInTheDocument();
    expect(heading("Путь OOS по зонам DR")).not.toBeInTheDocument();
    expect(heading("На каком шаге остановились и что продано")).not.toBeInTheDocument();
    // Their own page: the code is not repeated in every row.
    expect(screen.queryByText("TSM_TST_2")).not.toBeInTheDocument();
  });

  it("shows the steps alone without sales, and says so", () => {
    render(<OosPathSection data={build(null, false)} level="manager" />);
    expect(
      screen.getByText("Продажи Smart Up не загружены: видны только шаги из Connect-бота."),
    ).toBeInTheDocument();
    expect(within(screen.getAllByRole("list")[0]!).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText(/Продано в Smart Up/)).not.toBeInTheDocument();
    expect(screen.queryByText("Продано за 3 дня")).not.toBeInTheDocument();
    // Waiting for the rep is known from the bot alone.
    expect(heading("Что проверить · 1")).toBeInTheDocument();
  });

  it("says when no check found a product out", () => {
    render(<OosPathSection data={oosPath([], { sales: null })} level="exec" />);
    expect(
      screen.getByText("За период нет проверок, в которых нашли отсутствующий товар."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
