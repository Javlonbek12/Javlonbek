import { describe, expect, it } from "vitest";

import {
  connectKpis,
  isTestStore,
  ismBlock,
  orderStage,
  paymentIssues,
  paymentStage,
  type Dataset,
} from "./analytics";
import {
  detectFormat,
  detectKind,
  parseDateTime,
  parseRow,
  parseTime,
  personCode,
  type OosRecord,
  type PaymentRecord,
  type VisitRecord,
} from "./parse";
import {
  connectPeriod,
  leadScope,
  linkedCodes,
  linkOf,
  parseConnectQuery,
  scopeConnectQuery,
} from "./report";

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

  it("the ISM block: money by stage, what waits for whom, one person's requests", () => {
    const payments = [
      payment("10"),
      payment("11", { paid: null, bdmDecision: "В ожидании", at: "2026-10-01T09:00" }),
      payment("12", {
        paid: "Документ не подписан в Didox",
        checklist: 50,
        checks: [{ q: "Тестовый пункт", ok: false }],
      }),
    ];
    const block = ismBlock(payments, "2026-10-21");
    expect(block).toMatchObject({
      requests: 3,
      contractSum: 3_000_000,
      paidSum: 1_000_000,
      waiting: 1,
      waitingSum: 1_000_000,
      checklist: 83,
    });
    expect(block.waitingList).toMatchObject([{ id: "11", stage: "waitingBdm", days: 20 }]);
    expect(block.stages.find((s) => s.id === "blocked")).toMatchObject({ value: 1 });
    expect(paymentIssues(payments).map((p) => [p.id, p.stage, p.failed])).toEqual([
      ["12", "blocked", ["Тестовый пункт"]],
      ["11", "waitingBdm", []],
    ]);
  });

  it("counts a visit scored 0% in the reports page's visit score", () => {
    const visit = (id: string, percent: number | null): VisitRecord => ({
      ...base(id),
      template: "Аудит",
      status: "Выполнено",
      percent,
      creator: null,
      doneAt: null,
      taskStatus: null,
      problems: 0,
      problemList: [],
      photos: 0,
      answers: [],
    });
    const d: Dataset = {
      oos: [],
      orders: [],
      payments: [],
      visits: [visit("1", 100), visit("2", 0), visit("3", null)],
    };
    expect(connectKpis(d).visitScore).toBe(50);
  });
});

describe("New exports: Smart Up and the bot in English", () => {
  it("recognises each sheet by its header row", () => {
    expect(detectFormat(["Visit ID", "Visit Plan Date", "Fact Visit Date", "Client ID"])).toBe(
      "SU_VISIT",
    );
    expect(detectFormat(["Employee", "Name of Employee", "Planned Visits"])).toBe("SU_PERSON");
    expect(detectFormat(["ID visit", "Шаблон"])).toBe("VISIT_EN");
    expect(detectFormat(["ID Check", "OOS issue"])).toBe("OOS_EN");
    expect(detectFormat(["Order Number", "Amount (UZS)"])).toBe("ORDER_EN");
    expect(detectKind(["ID visit", "Шаблон"])).toBe("VISIT");
    expect(detectKind(["ID Check", "OOS issue"])).toBe("OOS");
  });

  it("codes, times", () => {
    expect(personCode("TSM_TST_1 - Тест TSM 1")).toBe("TSM_TST_1");
    expect(personCode("Тест KA / TSM 2 - Тест TSM 2")).toBe("Тест KA / TSM 2");
    expect(personCode("TSM_TST_1")).toBe("TSM_TST_1");
    expect(personCode(null)).toBeNull();
    expect(parseTime("09:05:48")).toBe("09:05");
    expect(parseTime("1899-12-30 11:52")).toBe("11:52");
    expect(parseTime(0.5)).toBe("12:00");
    expect(parseTime(null)).toBeNull();
  });

  it("a Smart Up visit: planned or not, made or not", () => {
    const headers = [
      "Organization",
      "Working Zone",
      "Employee",
      "Client ID",
      "Client",
      "Visit ID",
      "Visit Plan Date",
      "Fact Visit Date",
      "Start of visit time",
      "Finish the visit time",
      "Installed Backwall type",
      "Visit Comment",
    ];
    const made = parseRow("SU_VISIT", headers, [
      "Тестоград",
      "TSM_TST_1",
      "TSM_TST_1",
      900001,
      "Тестовая точка 1",
      7001,
      "02.11.2026",
      "03.11.2026",
      "10:00:15",
      "10:20:59",
      null,
      null,
    ]);
    expect(made).toMatchObject({
      kind: "SU_VISIT",
      record: {
        id: "7001",
        storeCode: "900001",
        person: "TSM_TST_1",
        city: "TSM_TST_1",
        day: "2026-11-03",
        planned: true,
        planDay: "2026-11-02",
        factDay: "2026-11-03",
        start: "10:00",
        finish: "10:20",
        organization: "Тестоград",
      },
    });
    const plan = parseRow("SU_VISIT", headers, [
      "Тестоград",
      "TSM_TST_1",
      "TSM_TST_1",
      900002,
      "Тестовая точка 2",
      null,
      "02.11.2026",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(plan?.record).toMatchObject({
      id: "plan|TSM_TST_1|900002|2026-11-02",
      day: "2026-11-02",
      factDay: null,
      start: null,
    });
    const unplanned = parseRow("SU_VISIT", headers, [
      null,
      null,
      "TSM_TST_1",
      900003,
      null,
      7003,
      null,
      "04.11.2026",
      "12:00:00",
      "12:10:00",
      null,
      "Тестовый комментарий",
    ]);
    expect(unplanned?.record).toMatchObject({ planned: false, day: "2026-11-04" });
  });

  it("a Market Visit questionnaire: the answers, the questions left blank, the problems", () => {
    const headers = [
      "ID visit",
      "Client",
      "Client ID",
      "Region",
      "Status",
      "Completion Rate of questions",
      "Employee who received task",
      "Employee who completed the questionnaire",
      "Date of start",
      "Month",
      "Date of completion",
      "Problematic Answers",
      "Frequent Problematic Questions",
      "Фото 1",
      "Шаблон",
      "1.1 Тестовый вопрос",
      "Торговая точка открыта?",
      "Тестовый вопрос 1",
    ];
    const row = parseRow("VISIT_EN", headers, [
      501,
      "Тестовая точка 1",
      900001,
      "Тестоград",
      "Выполнено",
      50,
      null,
      "TSM_TST_1 - Тест TSM 1",
      "02.11.2026 10:05",
      "2026-11",
      "02.11.2026 10:09",
      1,
      "Тестовый вопрос 1; ",
      "https://example.test/photo.jpg",
      "Тестовая анкета",
      null,
      "Да",
      "Нет",
    ]);
    expect(row).toMatchObject({
      kind: "VISIT",
      record: {
        id: "501",
        storeCode: "900001",
        city: "Тестоград",
        at: "2026-11-02T10:05",
        person: "TSM_TST_1 - Тест TSM 1",
        percent: 50,
        problemList: ["Тестовый вопрос 1"],
        photos: 1,
        answers: [
          { q: "Торговая точка открыта?", a: "Да" },
          { q: "Тестовый вопрос 1", a: "Нет" },
        ],
        unanswered: ["1.1 Тестовый вопрос"],
      },
    });
  });

  it("a stock check and an order in English", () => {
    const check = parseRow(
      "OOS_EN",
      [
        "ID Check",
        "Client",
        "Client ID",
        "Region",
        "Date of check",
        "Month",
        "Employee who completed the OOS",
        "OOS issue",
        "Not enough issue",
        "Order Created",
        "Created Order Number",
        "Order Status",
        "Delivery status",
        "SKU-TEST-001",
        "SKU-TEST-002",
      ],
      [
        601,
        "Тестовая точка 1",
        900001,
        "Тестоград",
        "02.11.2026 10:10",
        "2026-11",
        "TSM_TST_1 - Тест TSM 1",
        1,
        0,
        "Да",
        "#TEST-1",
        "Отправлен",
        "Точка не ответила",
        "Нет в наличии",
        "В наличии",
      ],
    );
    expect(check?.record).toMatchObject({
      id: "601",
      missing: 1,
      orderCreated: true,
      orderNo: "#TEST-1",
      delivery: "Точка не ответила",
      skus: { "SKU-TEST-001": "OUT" },
    });
    const order = parseRow(
      "ORDER_EN",
      [
        "Order Number",
        "Client",
        "Client ID",
        "Region",
        "Date of creation",
        "Month",
        "Order Status",
        "Delivery Status",
        "Created by",
        "ID check base",
        "Order assortment count",
        "Total order (packs)",
        "Amount (UZS)",
        "SKU-TEST-001",
        "SKU-TEST-002",
      ],
      [
        "#TEST-1",
        "Тестовая точка 1",
        900001,
        "Тестоград",
        "02.11.2026 10:12",
        "2026-11",
        "Отправлен",
        "Точка выбрала дату — ожидает агента",
        "TSM_TST_1 - Тест TSM 1",
        601,
        1,
        20,
        400000,
        20,
        null,
      ],
    );
    expect(order?.record).toMatchObject({
      id: "#TEST-1",
      status: "Точка выбрала дату — ожидает агента",
      sourceCheck: "601",
      positions: 1,
      packs: 20,
      sum: 400000,
      skus: { "SKU-TEST-001": 20 },
    });
  });
});

describe("The page query, the period and who sees which TSM", () => {
  it("reads the query: employees only get the executor level; own dates win over a chip", () => {
    expect(parseConnectQuery({ view: "manager", preset: "month" }, true)).toEqual({
      view: "manager",
      preset: "month",
      from: null,
      to: null,
      person: null,
    });
    expect(
      parseConnectQuery({ from: "2026-11-08", to: "2026-11-02", preset: "week" }, true),
    ).toMatchObject({ preset: null, from: "2026-11-02", to: "2026-11-08" });
    expect(parseConnectQuery({ view: "exec", from: "bad", to: "2026-11-02" }, false)).toMatchObject(
      { view: "executor", from: null, to: null },
    );
    // A bot name means its code.
    expect(parseConnectQuery({ person: "TSM_TST_1 - Тест TSM 1" }, true).person).toBe("TSM_TST_1");
  });

  it("the period: own dates, a chip, or the week of the latest data", () => {
    const today = "2026-11-09";
    expect(
      connectPeriod({ preset: null, from: "2026-11-02", to: "2026-11-04" }, today, null),
    ).toEqual({ from: "2026-11-02", to: "2026-11-04", preset: null });
    expect(connectPeriod({ preset: "lastMonth", from: null, to: null }, today, null)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      preset: "lastMonth",
    });
    const none = { preset: null, from: null, to: null };
    // Data up to Sunday 8 Nov, today Monday 9 Nov: last week.
    expect(connectPeriod(none, today, "2026-11-08")).toEqual({
      from: "2026-11-02",
      to: "2026-11-08",
      preset: "lastWeek",
    });
    expect(connectPeriod(none, today, "2026-11-09")).toMatchObject({ preset: "week" });
    expect(connectPeriod(none, today, "2026-10-21")).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
      preset: null,
    });
    expect(connectPeriod(none, today, null)).toMatchObject({ preset: "week" });
  });

  it("links by code, old links by the bot's full name keep working", () => {
    const links = { "TSM_TST_1 - Тест TSM 1": "u1", TSM_TST_2: "u2", TSM_TST_3: "u1" };
    expect(linkedCodes(links, new Set(["u1"]))).toEqual(["TSM_TST_1", "TSM_TST_3"]);
    expect(linkOf(links, "TSM_TST_1")).toBe("u1");
    expect(linkOf(links, "TSM_TST_9")).toBeNull();
    const query = parseConnectQuery({ view: "executor", person: "TSM_TST_2" }, false);
    // No links yet: works as before. With links: only one's own codes.
    expect(scopeConnectQuery(query, false, {}, "u1").own).toBeNull();
    expect(scopeConnectQuery(query, false, links, "u1")).toMatchObject({
      own: ["TSM_TST_1", "TSM_TST_3"],
      query: { view: "executor", person: "TSM_TST_1" },
    });
    expect(scopeConnectQuery(query, false, links, "u9")).toMatchObject({
      own: [],
      query: { person: null },
    });
  });

  it("managers see the TSMs linked to their team (by the org chart), the owner every one", () => {
    const links = { TSM_TST_1: "member", TSM_TST_2: "manager", TSM_TST_3: "stranger" };
    expect(leadScope({ id: "owner", role: "OWNER" }, links)).toBeNull();
    const team = leadScope(
      {
        id: "manager",
        role: "MANAGER",
        access: { taskScope: "team", teamIds: ["member"], modules: [] },
      },
      links,
    );
    expect([...team!]).toEqual(["TSM_TST_1", "TSM_TST_2"]);
    const all = leadScope(
      { id: "manager", role: "MANAGER", access: { taskScope: "all", teamIds: [], modules: [] } },
      links,
    );
    // Every linked TSM; one linked to nobody is not in any list but the owner's.
    expect([...all!]).toEqual(["TSM_TST_1", "TSM_TST_2", "TSM_TST_3"]);
    expect([
      ...leadScope(
        { id: "lonely", role: "MANAGER", access: { taskScope: "team", teamIds: [], modules: [] } },
        links,
      )!,
    ]).toEqual([]);
  });
});
