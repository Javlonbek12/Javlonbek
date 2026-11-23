import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectSales,
  detectFormat,
  detectKind,
  parseRow,
  parseWorkbook,
  saleLines,
  skuKey,
  type OrderRecord,
  type SaleDayRecord,
  type SaleRecord,
} from "./parse";
import {
  checkOrder,
  checkOrders,
  indexSales,
  PACKS_PER_BLOCK,
  salesCounts,
  salesSummary,
  unsoldOrders,
  type SalesRange,
} from "./sales";
import { analyzeVisits, tsmDetail, tsmRows, visitSections } from "./visits";

// Synthetic data only: TSM_TST_* codes, stores 9000xx, SKU-TEST names.
const DAY = "2026-11-02";
const RANGE: SalesRange = { from: "2026-11-01", to: "2026-11-10" };
const STATUS_A = "Точка не ответила";
const STATUS_B = "Доставлено — ожидает подтверждения точки";

const order = (id: string, skus: Record<string, number>, extra: Partial<OrderRecord> = {}) =>
  ({
    id,
    storeCode: "900001",
    storeName: "Тестовая точка 1",
    city: "Тестоград",
    channel: null,
    at: `${DAY}T10:00`,
    day: DAY,
    month: "2026-11",
    person: "TSM_TST_1 - Тест TSM 1",
    status: STATUS_A,
    express: false,
    payment: null,
    sourceCheck: null,
    storeAnswer: null,
    storeAnswerAt: null,
    agent: null,
    agentAnswer: null,
    deliveredAt: null,
    outcome: null,
    daysToDeliver: null,
    positions: Object.keys(skus).length,
    adjusted: false,
    packs: Object.values(skus).reduce((a, b) => a + b, 0),
    sum: 100000,
    skus,
    ...extra,
  }) satisfies OrderRecord;

const sale = (day: string, sku: string, blocks: number, storeCode = "900001"): SaleRecord => ({
  id: `${storeCode}|${day}|${skuKey(sku)}`,
  storeCode,
  storeName: `Тестовая точка ${storeCode}`,
  city: "Тестовая организация",
  channel: "Retail",
  at: `${day}T00:00`,
  day,
  month: day.slice(0, 7),
  person: null,
  sku,
  blocks,
});

const index = (sales: SaleRecord[], range: SalesRange = RANGE) => indexSales(sales, range)!;

describe("Sales report", () => {
  const headers = [
    "Клиент",
    "ИД клиента",
    "Организация",
    "ХЮ:(TSM;DR) Основной канал / POS channel",
    "Дата доставки",
    "ТМЦ",
    "Количество продажи",
  ];

  it("is recognised by its columns and read row by row", () => {
    expect(detectFormat(headers)).toBe("SALE");
    expect(detectKind(headers)).toBe("SALE");
    expect(
      parseRow("SALE", headers, [
        "Тестовая точка 1",
        "900001",
        "Тестовая организация",
        "Retail",
        "03.11.2026",
        "ESSE Change 1",
        5,
      ]),
    ).toEqual({
      kind: "SALE",
      record: {
        id: "900001|2026-11-03|esse change 1",
        storeCode: "900001",
        storeName: "Тестовая точка 1",
        city: "Тестовая организация",
        channel: "Retail",
        at: "2026-11-03T00:00",
        day: "2026-11-03",
        month: "2026-11",
        person: null,
        sku: "ESSE Change 1",
        blocks: 5,
      },
    });
    // Without a store, a day, a product or a quantity it is not a sale.
    expect(
      parseRow("SALE", headers, [
        "Тестовая точка 1",
        "900001",
        null,
        null,
        "03.11.2026",
        "X",
        null,
      ]),
    ).toBeNull();
  });

  it("matches product names without case and repeated spaces", () => {
    expect(skuKey("Esse Change 1")).toBe(skuKey("ESSE  Change 1"));
    expect(skuKey("Blooming Violet On")).toBe(skuKey("Blooming Violet ON"));
    expect(skuKey("SKU-TEST-001")).not.toBe(skuKey("SKU-TEST-002"));
    const check = checkOrder(
      order("#T-1", { "Esse Change 1": 10, "Blooming Violet ON": 10 }),
      index([sale(DAY, "ESSE Change 1", 1), sale(DAY, "Blooming Violet On", 1)]),
    );
    expect(check.lines.map((l) => l.sold)).toEqual([10, 10]);
    expect(check.result).toBe("all");
  });
});

describe("Sales after an auto-stock order", () => {
  it("counts the order day up to day + 3, not day + 4 or the day before", () => {
    const sales = index([
      sale("2026-11-01", "SKU-TEST-001", 1),
      sale("2026-11-06", "SKU-TEST-002", 1),
      sale("2026-11-05", "SKU-TEST-003", 1),
      sale(DAY, "SKU-TEST-004", 1),
    ]);
    const check = checkOrder(
      order("#T-1", {
        "SKU-TEST-001": 10,
        "SKU-TEST-002": 10,
        "SKU-TEST-003": 10,
        "SKU-TEST-004": 10,
      }),
      sales,
    );
    expect(check.until).toBe("2026-11-05");
    expect(check.lines.map((l) => [l.sku, l.sold > 0])).toEqual([
      ["SKU-TEST-001", false],
      ["SKU-TEST-002", false],
      ["SKU-TEST-003", true],
      ["SKU-TEST-004", true],
    ]);
    expect(check.result).toBe("partial");
  });

  it("only the same store; blocks are 10 packs; packs capped at what was ordered", () => {
    expect(PACKS_PER_BLOCK).toBe(10);
    const sales = index([
      sale(DAY, "SKU-TEST-001", 3),
      sale("2026-11-03", "SKU-TEST-001", 2),
      sale(DAY, "SKU-TEST-002", 1),
      // Another store: not this order's.
      sale(DAY, "SKU-TEST-003", 9, "900002"),
    ]);
    const check = checkOrder(
      order("#T-1", { "SKU-TEST-001": 20, "SKU-TEST-002": 30, "SKU-TEST-003": 10 }),
      sales,
    );
    expect(check.lines).toEqual([
      { sku: "SKU-TEST-001", ordered: 20, sold: 50, covered: 20 },
      { sku: "SKU-TEST-002", ordered: 30, sold: 10, covered: 10 },
      { sku: "SKU-TEST-003", ordered: 10, sold: 0, covered: 0 },
    ]);
    expect(salesCounts([check])).toMatchObject({
      checked: 1,
      anySold: 1,
      allSold: 0,
      lines: 3,
      linesSold: 2,
      packsOrdered: 60,
      packsSold: 30,
      packsSoldRaw: 60,
    });
  });

  it("an order whose window the sales don't cover stays out of the shares", () => {
    const sales = index([sale(DAY, "SKU-TEST-001", 1)], { from: DAY, to: "2026-11-05" });
    // Day + 3 = the last sales day: covered.
    expect(checkOrder(order("#T-1", { "SKU-TEST-001": 10 }), sales).closed).toBe(true);
    // Day + 3 after the last sales day: not covered yet.
    expect(
      checkOrder(order("#T-2", { "SKU-TEST-001": 10 }, { day: "2026-11-03" }), sales).closed,
    ).toBe(false);
    // Before the first sales day: not covered either.
    expect(
      checkOrder(order("#T-3", { "SKU-TEST-001": 10 }, { day: "2026-11-01" }), sales).closed,
    ).toBe(false);
    const checks = checkOrders(
      [
        order("#T-1", { "SKU-TEST-001": 10 }),
        order("#T-2", { "SKU-TEST-001": 10 }, { day: "2026-11-03" }),
      ],
      sales,
    );
    expect(salesCounts(checks)).toMatchObject({
      orders: 2,
      checked: 1,
      notClosed: 1,
      anySold: 1,
      lines: 1,
      linesSold: 1,
      packsOrdered: 10,
    });
  });

  it("every delivery status on its own; express orders and orders without products are not checked", () => {
    const sales = index([sale(DAY, "SKU-TEST-001", 1)]);
    const checks = checkOrders(
      [
        order("#T-1", { "SKU-TEST-001": 10 }),
        order("#T-2", { "SKU-TEST-002": 10 }),
        order("#T-3", { "SKU-TEST-001": 10, "SKU-TEST-002": 10 }, { status: STATUS_B }),
        order("#T-4", { "SKU-TEST-001": 10 }, { express: true }),
        order("#T-5", {}),
      ],
      sales,
    );
    expect(checks.map((c) => [c.order.id, c.result])).toEqual([
      ["#T-1", "all"],
      ["#T-2", "none"],
      ["#T-3", "partial"],
    ]);
    const summary = salesSummary(checks, sales);
    expect(summary).toMatchObject({
      orders: 3,
      checked: 3,
      anySold: 2,
      allSold: 1,
      anyRate: 67,
      allRate: 33,
      lines: 4,
      linesSold: 2,
      linesRate: 50,
      from: RANGE.from,
      to: RANGE.to,
    });
    expect(summary.byStatus.map((s) => [s.status, s.orders, s.anySold, s.allSold])).toEqual([
      [STATUS_A, 2, 1, 1],
      [STATUS_B, 1, 1, 0],
    ]);
    expect(summary.topUnsold).toEqual([{ sku: "SKU-TEST-002", ordered: 2, unsold: 2, rate: 100 }]);
    expect(unsoldOrders(checks)).toMatchObject([
      { id: "#T-2", day: DAY, status: STATUS_A, skus: ["SKU-TEST-002"] },
    ]);
  });

  it("goes into the orders section, each TSM's row and the TSM's list", () => {
    const orders = [
      order("#T-1", { "SKU-TEST-001": 10 }),
      order("#T-2", { "SKU-TEST-002": 10 }, { person: "TSM_TST_2 - Тест TSM 2" }),
    ];
    const data = {
      suVisits: [],
      mv: [],
      oos: [],
      orders,
      people: [],
      sales: [sale(DAY, "SKU-TEST-001", 2)],
      salesRange: RANGE,
    };
    const a = analyzeVisits(data);
    expect(visitSections(a).oos.sales).toMatchObject({ checked: 2, anySold: 1, anyRate: 50 });
    expect(
      tsmRows(a, ["TSM_TST_1", "TSM_TST_2"]).map((r) => [r.code, r.salesRate, r.sales.packsSold]),
    ).toEqual([
      ["TSM_TST_1", 100, 10],
      ["TSM_TST_2", 0, 0],
    ]);
    expect(tsmDetail(a, "TSM_TST_2").unsold.map((o) => o.id)).toEqual(["#T-2"]);
    // Without sales loaded there is no cross-check.
    expect(visitSections(analyzeVisits({ ...data, sales: [], salesRange: null })).oos.sales).toBe(
      null,
    );
  });
});

// Smart Up's «Конструктор отчётов по продажам» as it comes: the lines of the filters it was made
// with (each merged over four cells), the header under them and a totals row at the end.
const REPORT_HEADERS = [
  "Организация",
  "Клиент",
  "ИД клиента",
  "Адрес",
  "Регион",
  "ТМЦ",
  "Штат",
  "ХЮ:Responsible TSM",
  "ИД заказа",
  "Дата доставки",
  "Количество продажи",
  "Сумма без скидки/наценки",
];
type Value = ExcelJS.CellValue;
// «Регион» and the TSM are empty: such cells are not in the file at all.
const reportRow = (
  client: string | number,
  day: Value,
  sku: string,
  blocks: number | null,
  name: Value = `Тест точка ${client}`,
): Value[] => [
  "Тестовая организация",
  name,
  client,
  "Тест адрес",
  null,
  sku,
  "TSM_TST_1",
  null,
  "T-1",
  day,
  blocks,
  1000,
];
const reportSheet = (wb: ExcelJS.Workbook, rows: Value[][]) => {
  const ws = wb.addWorksheet("Конструктор отчётов по продажам");
  ws.addRow(["Дата доставки:  03.11.2026-04.11.2026"]);
  ws.addRow(["Организация: Тестовая организация"]);
  ws.mergeCells("A1:D1");
  ws.mergeCells("A2:D2");
  ws.addRow([]);
  ws.addRow(REPORT_HEADERS);
  for (const row of rows) ws.addRow(row);
  ws.addRow(REPORT_HEADERS.map((_, i) => (i < 10 ? "ИТОГО" : 10)));
  return ws;
};
const bufferOf = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());
const storeDay = (storeCode: string, day: string, skus: Record<string, number>): SaleDayRecord => ({
  id: `${storeCode}|${day}`,
  storeCode,
  storeName: `Тест точка ${storeCode}`,
  city: "Тестовая организация",
  // This report has no channel column.
  channel: null,
  at: `${day}T00:00`,
  day,
  month: day.slice(0, 7),
  person: null,
  skus,
});

describe("Sales workbook", () => {
  afterEach(() => vi.restoreAllMocks());

  const ROWS = [
    // A name in rich text (two runs of a shared string).
    reportRow("900001", "03.11.2026", "SKU-TEST 1", 2, {
      richText: [{ text: "Тест " }, { font: { bold: true }, text: "точка 900001" }],
    }),
    // The same store, day and product (in another spelling): summed.
    reportRow("900001", "03.11.2026", "sku-test  1", 3),
    reportRow("900001", "03.11.2026", "SKU-TEST 2", 1),
    reportRow(900002, "04.11.2026", "SKU-TEST 1", 4),
    // Without a quantity: skipped.
    reportRow("900003", "04.11.2026", "SKU-TEST 1", null),
  ];
  const DAYS = [
    storeDay("900001", "2026-11-03", { "SKU-TEST 1": 5, "SKU-TEST 2": 1 }),
    storeDay("900002", "2026-11-04", { "SKU-TEST 1": 4 }),
  ];
  const SHEET = {
    kind: "SALE",
    skipped: 1,
    rows: DAYS.map((record) => ({ kind: "SALE", record })),
  };
  const POSITIONS = [
    ["ИД", "Название", "Пользователь", "Рабочие зоны", "Роли", "Руководитель"],
    [900101, "BDM 99", "Тест Руководитель", "TSM_TST_1", "KT&G BDM", "BUM TEST"],
  ];

  it("is read by the light reader into store-days: filter lines above, totals out", async () => {
    const wb = new ExcelJS.Workbook();
    reportSheet(wb, ROWS);
    const buffer = await bufferOf(wb);
    const exceljs = vi.spyOn(ExcelJS, "Workbook");
    expect(await parseWorkbook(buffer)).toEqual([SHEET]);
    expect(exceljs).not.toHaveBeenCalled();
  });

  it("gives the same store-days through exceljs, when another export is in the workbook", async () => {
    const wb = new ExcelJS.Workbook();
    reportSheet(wb, ROWS);
    wb.addWorksheet("Sheet").addRows(POSITIONS);
    const buffer = await bufferOf(wb);
    const exceljs = vi.spyOn(ExcelJS, "Workbook");
    const sheets = await parseWorkbook(buffer);
    expect(exceljs).toHaveBeenCalledTimes(1);
    expect(sheets.map((s) => s.kind)).toEqual(["SALE", "SU_POSITION"]);
    expect(sheets[0]).toEqual(SHEET);
  });

  it("leaves a sheet it could read differently to exceljs: real dates, merged cells", async () => {
    // A date cell is a number with a date format: the light reader does not read formats.
    let wb = new ExcelJS.Workbook();
    reportSheet(wb, [reportRow("900001", new Date(Date.UTC(2026, 10, 3)), "SKU-TEST 1", 2)]);
    let buffer = await bufferOf(wb);
    let exceljs = vi.spyOn(ExcelJS, "Workbook");
    expect((await parseWorkbook(buffer))[0]!.rows.map((r) => r.record)).toEqual([
      storeDay("900001", "2026-11-03", { "SKU-TEST 1": 2 }),
    ]);
    expect(exceljs).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();

    // A name merged over the store's two rows is the name of both.
    wb = new ExcelJS.Workbook();
    reportSheet(wb, [
      reportRow("900001", "03.11.2026", "SKU-TEST 1", 2, "Тест общая точка"),
      reportRow("900001", "04.11.2026", "SKU-TEST 1", 1, null),
    ]).mergeCells("B5:B6");
    buffer = await bufferOf(wb);
    exceljs = vi.spyOn(ExcelJS, "Workbook");
    expect(
      (await parseWorkbook(buffer))[0]!.rows.map((r) => [r.record.id, r.record.storeName]),
    ).toEqual([
      ["900001|2026-11-03", "Тест общая точка"],
      ["900001|2026-11-04", "Тест общая точка"],
    ]);
    expect(exceljs).toHaveBeenCalledTimes(1);
  });
});

describe("Stored sales", () => {
  const flat = [
    sale("2026-11-03", "SKU-TEST-001", 2),
    sale("2026-11-03", "SKU-TEST-002", 1),
    sale("2026-11-04", "SKU-TEST-001", 3, "900002"),
  ];

  it("a row stored before 23.11.2026 (one per line) is read as it is", () => {
    expect(flat.flatMap((row) => saleLines(row))).toEqual(flat);
  });

  it("a store's day expands to the same lines, and to the same cross-check", () => {
    const sales = collectSales();
    for (const row of flat) sales.add(row);
    const days = sales.days();
    expect(sales.lines).toBe(3);
    expect(days.map((d) => [d.id, d.skus])).toEqual([
      ["900001|2026-11-03", { "SKU-TEST-001": 2, "SKU-TEST-002": 1 }],
      ["900002|2026-11-04", { "SKU-TEST-001": 3 }],
    ]);
    expect(days.flatMap((d) => saleLines(d))).toEqual(flat);
    // As it comes back from the database's JSON.
    const stored = JSON.parse(JSON.stringify(days)) as SaleDayRecord[];
    expect(stored.flatMap((d) => saleLines(d))).toEqual(flat);
    const o = order("#T-1", { "SKU-TEST-001": 10, "SKU-TEST-002": 20, "SKU-TEST-003": 5 });
    const check = checkOrder(o, index(stored.flatMap((d) => saleLines(d))));
    expect(check).toEqual(checkOrder(o, index(flat)));
    expect(check.lines.map((l) => l.sold)).toEqual([20, 10, 0]);
  });

  it("sums the same store, day and product, in rows and in store-days alike", () => {
    const sales = collectSales();
    sales.add(sale(DAY, "SKU-TEST 1", 2));
    sales.add(sale(DAY, "sku-test  1", 3));
    sales.add(sale("2026-11-03", "SKU-TEST 1", 1));
    const again = collectSales();
    for (const day of sales.days()) again.add(day);
    again.add(sale(DAY, "SKU-TEST 2", 4));
    again.add(sale(DAY, "Sku-Test 1", 1));
    expect(again.lines).toBe(3);
    expect(again.days().map((d) => [d.id, d.skus])).toEqual([
      [`900001|${DAY}`, { "SKU-TEST 1": 6, "SKU-TEST 2": 4 }],
      ["900001|2026-11-03", { "SKU-TEST 1": 1 }],
    ]);
  });
});
