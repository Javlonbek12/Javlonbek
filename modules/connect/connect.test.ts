import { describe, expect, it } from "vitest";

import {
  executiveView,
  executorView,
  isTestStore,
  managerView,
  orderStage,
  paymentStage,
  type Dataset,
} from "./analytics";
import { detectKind, parseDateTime, parseRow, type OosRecord, type PaymentRecord } from "./parse";
import { parseConnectQuery, periodMonths } from "./report";

const base = (id: string, extra: Partial<OosRecord> = {}) => ({
  id,
  storeCode: `T-${id}`,
  storeName: `Тестовая точка ${id}`,
  city: "Тестоград",
  channel: "Retail",
  at: "2026-10-01T10:00",
  day: "2026-10-01",
  month: "2026-10",
  person: "TSM_TEST_1 - Тестовый сотрудник 1",
  ...extra,
});

const check = (id: string, extra: Partial<OosRecord> = {}): OosRecord => ({
  ...base(id),
  missing: 0,
  low: 0,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus: {},
  ...extra,
});

const payment = (id: string, extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
  ...base(id),
  checklist: 100,
  roi: "positive",
  tsmDecision: "Оплатить полную сумму",
  contractSum: 1_000_000,
  toPay: null,
  bdmDecision: "Подтверждено",
  bdm: null,
  bdmAt: null,
  bumDecision: "Подтверждено",
  bum: null,
  bumAt: null,
  paid: "Оплачено",
  checks: [],
  ...extra,
});

describe("Connect exports", () => {
  it("recognises each export by its columns", () => {
    expect(detectKind(["ID проверки", "Нет в наличии, поз."])).toBe("OOS");
    expect(detectKind(["Номер заказа", "Тип заказа"])).toBe("ORDER");
    expect(detectKind(["ID заявки", "Магазин"])).toBe("PAYMENT");
    expect(detectKind(["ID проверки", "Статус проверки", "Шаблон"])).toBe("VISIT");
    expect(detectKind(["Что-то другое"])).toBeNull();
  });

  it("reads dates the way the bot writes them", () => {
    expect(parseDateTime("09.02.2026 21:22")).toBe("2026-02-09T21:22");
    expect(parseDateTime("9.3.2026")).toBe("2026-03-09T00:00");
    expect(parseDateTime("2026-10-05 08:01")).toBe("2026-10-05T08:01");
    expect(parseDateTime("вчера")).toBeNull();
  });

  it("parses a stock check: products that were not in stock, nothing else", () => {
    const headers = [
      "ID проверки",
      "Магазин",
      "Код точки",
      "Город",
      "Канал",
      "Дата проверки",
      "Месяц",
      "Проверил",
      "Нет в наличии, поз.",
      "Недостаточно, поз.",
      "Заказ создан",
      "Номер заказа",
      "Статус заказа",
      "Статус доставки",
      "SKU-TEST-001",
      "SKU-TEST-002",
      "SKU-TEST-003",
      "Позиции вне колонок, шт.",
    ];
    const row = parseRow("OOS", headers, [
      7,
      "Тестовая точка",
      123,
      "Тестоград",
      "Не указан канал",
      "01.10.2026 10:00",
      "2026-10",
      "TSM_TEST_1 - Тестовый сотрудник 1",
      1,
      1,
      "Да",
      "#KTG-1",
      "Отправлен",
      "Точка не ответила",
      "Нет в наличии",
      "В наличии",
      "Недостаточно",
      null,
    ]);
    expect(row?.kind).toBe("OOS");
    const record = row!.record as OosRecord;
    expect(record).toMatchObject({
      id: "7",
      storeCode: "123",
      channel: null,
      day: "2026-10-01",
      missing: 1,
      low: 1,
      orderCreated: true,
      skus: { "SKU-TEST-001": "OUT", "SKU-TEST-003": "LOW" },
    });
    // A row without a date is skipped.
    expect(parseRow("OOS", headers, [8, "Тестовая", 1])).toBeNull();
  });

  it("leaves the bot's test stores out", () => {
    expect(isTestStore("[TEST] Тестовая торговая точка", "1")).toBe(true);
    expect(isTestStore("Trade_test", "1")).toBe(true);
    expect(isTestStore("KT&G office", "1")).toBe(true);
    expect(isTestStore("Магазин", "9999999999")).toBe(true);
    expect(isTestStore('"Тестовый магазин" MChJ', "123")).toBe(false);
  });

  it("puts orders and payments into stages", () => {
    expect(orderStage({ status: "Точка не ответила", outcome: null, storeAnswer: null })).toBe(
      "noAnswer",
    );
    expect(
      orderStage({ status: "Доставлено и подтверждено точкой", outcome: null, storeAnswer: null }),
    ).toBe("delivered");
    expect(
      orderStage({ status: "Точка отказалась от заказа", outcome: null, storeAnswer: null }),
    ).toBe("refused");
    expect(
      orderStage({ status: "Агент принял — готовит доставку", outcome: null, storeAnswer: null }),
    ).toBe("inProgress");
    expect(paymentStage(payment("1"))).toBe("paid");
    expect(paymentStage(payment("2", { paid: "Счёт-фактура не подтверждена" }))).toBe("blocked");
    expect(paymentStage(payment("3", { paid: null, bdmDecision: "В ожидании" }))).toBe(
      "waitingBdm",
    );
    expect(paymentStage(payment("4", { paid: null, bumDecision: "В ожидании" }))).toBe(
      "waitingBum",
    );
    expect(paymentStage(payment("5", { paid: null, bdmDecision: "Отклонено" }))).toBe("rejected");
    expect(paymentStage(payment("6", { paid: null }))).toBe("approved");
  });

  it("builds the three levels from the same data", () => {
    const d: Dataset = {
      oos: [
        check("1", { missing: 2, orderCreated: true, skus: { "SKU-TEST-001": "OUT" } }),
        check("2", { missing: 1, skus: { "SKU-TEST-001": "OUT", "SKU-TEST-002": "LOW" } }),
        check("3"),
        check("4", { person: "TSM_TEST_2 - Тестовый сотрудник 2", city: "Другой город" }),
      ],
      orders: [
        {
          ...base("#KTG-1"),
          status: "Точка не ответила",
          express: false,
          payment: null,
          sourceCheck: "1",
          storeAnswer: null,
          storeAnswerAt: null,
          agent: null,
          agentAnswer: null,
          deliveredAt: null,
          outcome: null,
          daysToDeliver: null,
          positions: 1,
          adjusted: false,
          packs: 2,
          sum: 30_000,
          skus: { "SKU-TEST-001": 2 },
        },
      ],
      payments: [
        payment("10"),
        payment("11", { paid: null, bdmDecision: "В ожидании", at: "2026-10-01T09:00" }),
        payment("12", {
          paid: "Документ не подписан в Didox",
          checklist: 50,
          checks: [{ q: "Тестовый пункт", ok: false }],
        }),
      ],
      visits: [],
    };

    const e = executiveView(d, ["2026-10"]);
    expect(e.kpis).toMatchObject({
      checks: 4,
      gapRate: 50,
      conversion: 50,
      orders: 1,
      noAnswerRate: 100,
      requests: 3,
      contractSum: 3_000_000,
      paidSum: 1_000_000,
      waiting: 1,
      waitingSum: 1_000_000,
      blocked: 1,
    });
    expect(e.funnel.map((s) => s.value)).toEqual([4, 2, 1, 0, 0]);
    expect(e.topSkus[0]).toMatchObject({ sku: "SKU-TEST-001", total: 2, rate: 50 });
    expect(e.insights.map((i) => i.key)).toContain("noAnswer");

    const m = managerView(d, "2026-10-21");
    expect(m.cities.map((c) => c.city)).toEqual(["Тестоград", "Другой город"]);
    expect(m.waitingPayments).toMatchObject([{ id: "11", stage: "waitingBdm", days: 20 }]);
    expect(m.stuckOrders).toHaveLength(1);
    expect(m.people[0]?.person).toBe("TSM_TEST_1 - Тестовый сотрудник 1");

    const x = executorView(d, "TSM_TEST_1 - Тестовый сотрудник 1", "2026-10-21");
    // Store 2 had gaps and no order; store 1 got an order.
    expect(x.gapsWithoutOrder.map((g) => g.id)).toEqual(["2"]);
    expect(x.gapsWithoutOrder[0]?.skus).toEqual(["SKU-TEST-001", "SKU-TEST-002"]);
    expect(x.openOrders).toHaveLength(1);
    expect(x.paymentIssues.map((p) => p.stage)).toEqual(["blocked", "waitingBdm"]);
    expect(x.paymentIssues[0]?.failed).toEqual(["Тестовый пункт"]);
    expect(executorView(d, "TSM_TEST_2 - Тестовый сотрудник 2", "2026-10-21").openCount).toBe(0);
  });

  it("reads the page query: employees only get the executor level", () => {
    expect(parseConnectQuery({ view: "manager", from: "2026-10", to: "2026-05" }, true)).toEqual({
      view: "manager",
      filter: { from: "2026-05", to: "2026-10", city: undefined, channel: undefined },
      person: null,
    });
    expect(parseConnectQuery({ view: "exec", from: "bad" }, false).view).toBe("executor");
    expect(parseConnectQuery({ view: "exec", from: "bad" }, false).filter.from).toBeUndefined();
    expect(periodMonths(["2026-04", "2026-05", "2026-06"], { from: "2026-05" })).toEqual([
      "2026-05",
      "2026-06",
    ]);
  });
});
