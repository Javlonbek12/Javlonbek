import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withExportLocale } from "@/lib/i18n/server";
import {
  buildConnectReport,
  connectHref,
  leadScope,
  loadConnectAccess,
  parseConnectQuery,
  scopeConnectQuery,
} from "@/modules/connect/report";
import { DEFAULT_RULES } from "@/modules/connect/rules";
import {
  importConnectFiles,
  linkConnectPerson,
  linkConnectPosition,
  loadConnectRules,
  saveConnectRules,
} from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// «Маршруты и дисциплина»: Smart Up's route analysis uploaded with the employee info, the client
// base and the bot's records, then read on the three levels. Synthetic data only: TSM_TST_* /
// DR_TST_* zones, «Тест …» people, stores 9000xx.

type Row = (string | number | null)[];
const TODAY = "2026-11-16";
const WEEK = { from: "2026-11-09", to: "2026-11-15" };
const PERSON = "TSM_TST_1 - Тест Первый";

const book = async (sheets: { name: string; rows: Row[] }[], created?: Date) => {
  const wb = new ExcelJS.Workbook();
  if (created) wb.created = created;
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const pos = (id: number, title: string, user: string, roles: string, boss: string | null): Row => [
  id,
  title,
  user,
  null,
  roles,
  boss,
  "01.10.2026 09:00:00",
  "Активный",
];
// BDM 99 → two TSMs; the distributor's supervisor → two sales reps.
const employees = () =>
  book([
    {
      name: "Sheet",
      rows: [
        [
          "ИД",
          "Название",
          "Пользователь",
          "Рабочие зоны",
          "Роли",
          "Руководитель",
          "Дата создания",
          "Статус",
        ],
        pos(900101, "BDM 99", "Тест Руководитель", "KT&G BDM", null),
        pos(900102, "TSM_TST_1", "Тест Первый", "Мерчендайзер", "BDM 99"),
        pos(900103, "TSM_TST_2", "Тест Второй", "Мерчендайзер", "BDM 99"),
        pos(900104, "Supervisor TST", "Тест Супервайзер", "Супервайзер", null),
        pos(900105, "DR_TST_1", "Тест Агент 1", "Торговый представитель", "Supervisor TST"),
        pos(900106, "DR_TST_2", "Тест Агент 2", "Торговый представитель", "Supervisor TST"),
      ],
    },
  ]);

// The days of the sheet (no Sundays) and a row per client of a zone and employee.
const DAYS = [2, 3, 9, 10, 11, 16];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const client = (
  zone: string,
  store: number,
  codes: Record<number, string>,
  staff = zone,
  organization = "Тестоград",
): Row => [
  null,
  organization,
  zone,
  staff,
  store,
  `Тест магазин ${store}`,
  null,
  null,
  ...DAYS.map((d) => codes[d] ?? null),
];
const routes = () =>
  book(
    [
      {
        name: "Анализ маршрута",
        rows: [
          [],
          ["Предстоящий плановый визит:", null, null, "O"],
          ["Невыполненный плановый визит:", null, null, "X"],
          [],
          [
            "Номер заказа",
            "Организация",
            "Рабочая зона",
            "Штат",
            "ИД клиента",
            "Клиент",
            "Характеристика клиента",
            "Итог за неделю",
            ...DAYS.map((d) => WEEKDAYS[new Date(Date.UTC(2026, 10, d)).getUTCDay()]!),
          ],
          [null, null, null, null, null, null, null, "1 неделя", ...DAYS],
          client("TSM_TST_1", 900001, { 2: "P", 9: "P", 10: "X", 11: "P" }),
          // The BDM came along on the 9th: a row of its own for the same client.
          client("TSM_TST_1", 900001, { 9: "U" }, "BDM 99"),
          client("TSM_TST_1", 900002, { 9: "X", 11: "X" }),
          client("TSM_TST_2", 900003, { 9: "P", 10: "P" }),
          client("DR_TST_1", 900001, { 2: "PD", 9: "PD", 10: "P", 11: "UD" }),
          client("DR_TST_1", 900004, { 9: "P", 10: "P", 11: "P" }),
          client("DR_TST_2", 900005, { 9: "PD", 10: "PD", 16: "O" }, "DR_TST_2", "Тестобад"),
          ["Итоговое количество визитов в день:", null, null, null, "Итого", null, null, 1],
        ],
      },
    ],
    // Made on 16 November, 18:00 in Tashkent.
    new Date("2026-11-16T13:00:00Z"),
  );

const clients = () =>
  book([
    {
      name: "Клиенты",
      rows: [
        [
          "ИД",
          "Название",
          "Организации",
          "GPS координаты",
          "KT&G Grade NEW",
          "(TSM) Коммуникация / Key Visual",
          "Promotion / промоакция",
          "Сумма контракта / Contract budget",
          "BDM KTNG",
          "Responsible DR",
          "Тип оборудования 1 |Backwall / POG",
          "NEW Launch promotion",
          "(TSM;DR) Основной канал / POS channel",
          "Responsible TSM",
          "Регион",
          "Статус",
          "ИНН",
        ],
        [
          900002,
          "Тест магазин 900002",
          "Тестоград",
          null,
          "XL",
          null,
          null,
          null,
          null,
          null,
          "Display TST",
          null,
          "Розница (Retail)",
          "TSM_TST_1",
          "Тестовый район",
          "Активный",
          null,
        ],
        [
          900004,
          "Тест магазин 900004",
          "Тестоград",
          null,
          "M",
          null,
          null,
          null,
          null,
          "DR_TST_1",
          null,
          null,
          "Розница (Retail)",
          null,
          "Тестовый район",
          "Активный",
          null,
        ],
      ],
    },
  ]);

// The bot: a Market Visit and a stock check at store 900001 on the 9th, late in the evening.
const bot = () =>
  book([
    {
      name: "Market Visit (Connect Bot)",
      rows: [
        [
          "ID visit",
          "Client",
          "Client ID",
          "Region",
          "Status",
          "Employee who completed the questionnaire",
          "Date of start",
          "Month",
          "Problematic Answers",
          "Frequent Problematic Questions",
          "Фото 1",
          "Шаблон",
          "Торговая точка открыта?",
        ],
        [
          501,
          "Тест магазин 900001",
          900001,
          "Тестоград",
          "Выполнено",
          PERSON,
          "09.11.2026 23:00",
          "2026-11",
          0,
          null,
          "https://example.test/photo.jpg",
          "Тестовая анкета",
          "Да",
        ],
      ],
    },
    {
      name: "OOS check (Connect Bot)",
      rows: [
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
        ],
        [
          601,
          "Тест магазин 900001",
          900001,
          "Тестоград",
          "09.11.2026 23:10",
          "2026-11",
          PERSON,
          0,
          0,
          "Нет",
          null,
          null,
          null,
          "В наличии",
        ],
      ],
    },
  ]);

// Smart Up's visit detail for the 9th alone: one visit of TSM_TST_1, in the morning.
const detail = () =>
  book([
    {
      name: "Visit Detailization (Smart up)",
      rows: [
        [
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
          "Visit Comment",
        ],
        [
          "Тестоград",
          "TSM_TST_1",
          "TSM_TST_1",
          900001,
          "Тест магазин 900001",
          7001,
          "09.11.2026",
          "09.11.2026",
          "10:00:00",
          "10:20:00",
          null,
        ],
      ],
    },
  ]);

async function setup() {
  const owner = await withAccess(await createTestUser("OWNER"));
  await importConnectFiles(owner, [
    { name: "employees.xlsx", buffer: await employees() },
    { name: "route.xlsx", buffer: await routes() },
    { name: "clients.xlsx", buffer: await clients() },
    { name: "bot.xlsx", buffer: await bot() },
  ]);
  return owner;
}

const query = (extra: Record<string, string> = {}) =>
  parseConnectQuery({ ...WEEK, ...extra }, true);

// Smart Up's sales report as it comes: filter lines above the header, a totals row below.
const sale = (store: number, day: string, staff: string, tsm: string, sum: number): Row => [
  "Тестоград",
  `Тест магазин ${store}`,
  store,
  "Тест адрес",
  null,
  "SKU-TEST 1",
  staff,
  tsm,
  "T-1",
  day,
  sum / 1000,
  sum,
];
const HEAD = [
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
const salesBook = (rows: Row[]) =>
  book([
    {
      name: "Конструктор отчётов по продажам",
      rows: [
        ["Дата доставки:  02.11.2026-15.11.2026"],
        HEAD,
        ...rows,
        HEAD.map((_, i) => (i < 10 ? "ИТОГО" : 0)),
      ],
    },
  ]);

describe("Connect: routes and discipline", () => {
  beforeEach(resetDb);

  it("keeps a row per employee of a zone's client", async () => {
    await setup();
    const rows = await db.connectRecord.findMany({
      where: {
        kind: "ROUTE",
        storeCode: "900001",
        externalId: { startsWith: "2026-11|TSM_TST_1|" },
      },
      select: { externalId: true, person: true },
    });
    // The TSM's own row and the BDM's, who came along: the BDM's is not the zone's route.
    expect(rows.map((r) => [r.externalId, r.person]).sort()).toEqual([
      ["2026-11|TSM_TST_1|BDM 99|900001", "BDM 99"],
      ["2026-11|TSM_TST_1|TSM_TST_1|900001", "TSM_TST_1"],
    ]);
  });

  it("shows leadership the whole picture, by staff", async () => {
    await setup();
    const report = await buildConnectReport(query({ view: "exec" }), TODAY);
    const block = report.exec!.routes!;
    expect(block).toMatchObject({ level: "exec", staff: "all", dataDate: "2026-11-16" });
    const a = block.analysis;
    expect(a.totals.TSM).toMatchObject({
      zones: 2,
      clients: 3,
      planned: 7,
      visited: 4,
      missed: 3,
      // The BDM's joint visit is not the zone's route.
      unplanned: 0,
      attendance: 57.1,
      hitRate: null,
    });
    expect(a.totals.DR).toMatchObject({
      zones: 2,
      clients: 3,
      planned: 7,
      visited: 7,
      visits: 8,
      orders: 4,
      attendance: 100,
      hitRate: 50,
      noOrder: 1,
      // 1 order of 1 visit the week before.
      hitRateDelta: -50,
    });
    expect(a.days.map((d) => d.day)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(a.weekdays.weeks).toEqual(["2026-11-09"]);
    expect(a.matrix).toEqual({
      average: { attendance: 100, hitRate: 50 },
      classes: { ok: 1, one: 1, both: 0 },
    });
    expect(a.organizations.map((o) => [o.kind, o.organization, o.zones, o.class])).toEqual([
      ["TSM", "Тестоград", 2, null],
      ["DR", "Тестоград", 1, "one"],
      ["DR", "Тестобад", 1, "ok"],
    ]);
    expect(a.ranking.map((z) => [z.zone, z.person, z.attendance])).toEqual([
      ["TSM_TST_1", "Тест Первый", 40],
      ["TSM_TST_2", "Тест Второй", 100],
    ]);
    // The lists carry the client base's grade and equipment.
    expect(a.missed).toMatchObject([
      { zone: "TSM_TST_1", storeCode: "900002", misses: 2, grade: "XL", equipment: "Display TST" },
    ]);
    expect(a.noOrder).toMatchObject([
      { zone: "DR_TST_1", storeCode: "900004", visits: 3, grade: "M" },
    ]);

    // «DR» alone; the switch is a link that keeps the level and the period.
    const dr = await buildConnectReport(query({ view: "exec", staff: "dr" }), TODAY);
    const drBlock = dr.exec!.routes!;
    expect(drBlock.staff).toBe("DR");
    expect(drBlock.analysis.zones.map((z) => z.zone)).toEqual(["DR_TST_1", "DR_TST_2"]);
    expect(drBlock.analysis.ranking).toEqual([]);
    expect(connectHref("/connect", drBlock.query)).toBe(
      "/connect?view=exec&from=2026-11-09&to=2026-11-15&staff=DR",
    );
    expect(connectHref("/connect", drBlock.query, { staff: null })).toBe(
      "/connect?view=exec&from=2026-11-09&to=2026-11-15",
    );
    expect(parseConnectQuery({ staff: "office" }, true).staff).toBeUndefined();

    // A period without routes: no block, the rest as before.
    const before = await buildConnectReport(
      parseConnectQuery({ view: "exec", from: "2026-10-05", to: "2026-10-11" }, true),
      TODAY,
    );
    expect(before.exec!.routes).toBeNull();
    expect(before.empty).toBe(true);
  });

  it("counts against the owner's norms once saved; only the owner saves them", async () => {
    const owner = await setup();
    const manager = await withAccess(await createTestUser("MANAGER"));
    const classes = async () => {
      const report = await buildConnectReport(query({ view: "exec" }), TODAY);
      const a = report.exec!.routes!.analysis;
      return {
        targets: a.targets,
        classes: a.matrix!.classes,
        rates: a.zones.filter((z) => z.kind === "DR").map((z) => [z.attendance, z.hitRate]),
        rules: report.insights!.rules,
      };
    };
    // The standard norms until the owner saves their own.
    expect(await loadConnectRules()).toEqual(DEFAULT_RULES);
    const standard = await classes();
    expect(standard.targets).toEqual({ attendance: 95, hitRate: 90 });
    expect(standard.classes).toEqual({ ok: 1, one: 1, both: 0 });
    expect(standard.rules).toEqual(DEFAULT_RULES);
    // Two DR zones, both visit everything; one takes an order on a third of its visits.
    expect(standard.rates).toEqual([
      [100, 33.3],
      [100, 100],
    ]);

    await expect(
      saveConnectRules(manager, { ...DEFAULT_RULES, hitRate: 30 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await loadConnectRules()).toEqual(DEFAULT_RULES);

    await saveConnectRules(owner, { ...DEFAULT_RULES, hitRate: 30, visited: 30 });
    expect(await loadConnectRules()).toEqual({ ...DEFAULT_RULES, hitRate: 30, visited: 30 });
    const own = await classes();
    expect(own.targets).toEqual({ attendance: 95, hitRate: 30 });
    expect(own.rules).toMatchObject({ hitRate: 30, visited: 30 });
    // The same visits and orders, another line: 33.3% now reaches the target of 30%.
    expect(own.rates).toEqual(standard.rates);
    expect(own.classes).toEqual({ ok: 2, one: 0, both: 0 });

    // Something unreadable saved is the standard, not an error.
    await db.systemState.update({ where: { key: "connect.rules" }, data: { value: "{broken" } });
    expect(await loadConnectRules()).toEqual(DEFAULT_RULES);
    // Back to the standard ones.
    await saveConnectRules(owner, { ...DEFAULT_RULES, hitRate: 30 });
    await saveConnectRules(owner, null);
    expect(await loadConnectRules()).toEqual(DEFAULT_RULES);
    expect(await db.systemState.count({ where: { key: "connect.rules" } })).toBe(0);
    expect((await classes()).classes).toEqual(standard.classes);
  });

  it("puts the sales report next to the zones: a rep's own sales, a TSM's stores", async () => {
    const owner = await setup();
    // No sales loaded: no block.
    expect(
      (await buildConnectReport(query({ view: "exec" }), TODAY)).exec!.routes!.sales,
    ).toBeNull();

    await importConnectFiles(owner, [
      {
        name: "sales.xlsx",
        buffer: await salesBook([
          // The week before: DR_TST_1 sold 40 000.
          sale(900001, "03.11.2026", "DR_TST_1", "TSM_TST_1", 40000),
          // The week shown: 30 000 to the TSM's store, 10 000 to a store that is nobody's.
          sale(900001, "09.11.2026", "DR_TST_1", "TSM_TST_1", 30000),
          sale(900004, "10.11.2026", "DR_TST_1", "Другие", 10000),
          // An operator with no route sold to the other rep's store.
          sale(900005, "11.11.2026", "Operator 9 (Тест)", "TSM_TST_2", 20000),
        ]),
      },
    ]);

    const exec = await buildConnectReport(query({ view: "exec" }), TODAY);
    const sales = exec.exec!.routes!.sales!;
    expect(sales.legacy).toBe(false);
    expect(sales.total).toEqual({ blocks: 60, sum: 60000, before: 40000, change: 50 });
    // The operator's 20 000 of the 60 000 are not any route's.
    expect(sales.outside).toEqual({ blocks: 20, sum: 20000, share: 33.3, staff: 1 });
    // The reps' three route stores of the week all had a sale.
    expect(sales).toMatchObject({ clients: 3, buying: 3 });
    const rows = Object.fromEntries(sales.rows.map((r) => [r.zone, r]));
    expect(rows["DR_TST_1"]).toMatchObject({
      kind: "DR",
      sum: 40000,
      before: 40000,
      change: 0,
      days: 2,
      clients: 2,
      buying: 2,
      coverage: 100,
      hitRate: 33.3,
    });
    // DR_TST_2 sold nothing themselves; their store bought from the operator.
    expect(rows["DR_TST_2"]).toMatchObject({ sum: 0, change: null, clients: 1, buying: 1 });
    // A TSM has the sales to the stores they are responsible for, whoever sold.
    expect(rows["TSM_TST_1"]).toMatchObject({
      kind: "TSM",
      sum: 30000,
      before: 40000,
      change: -25,
    });
    expect(rows["TSM_TST_2"]).toMatchObject({ sum: 20000, change: null });

    // The Excel file has every shown zone on a sheet of its own.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await connectXlsx(exec, TODAY)) as unknown as ArrayBuffer);
    const sheet = wb
      .getWorksheet("Продажи по зонам")!
      .getSheetValues()
      .filter(Boolean)
      .map((row) => (row as ExcelJS.CellValue[]).slice(1));
    expect(sheet[0]!.slice(0, 7)).toEqual([
      "Зона",
      "Группа",
      "Сотрудник",
      "Организация",
      "Продано",
      "Изменение, %",
      "Блоков",
    ]);
    // Zone, group, …, sold, change, blocks, deliveries, route stores, with a sale, %, hit rate.
    const line = sheet.find((row) => row[0] === "DR_TST_1")!;
    expect([line[1], ...line.slice(4, 12)]).toEqual(["DR", 40000, 0, 40, 2, 2, 2, 100, 33.3]);

    // The reps alone, and one rep's own page.
    const dr = await buildConnectReport(query({ view: "exec", staff: "dr" }), TODAY);
    expect(dr.exec!.routes!.sales!.rows.map((r) => r.kind)).toEqual(["DR", "DR"]);
    const own = await buildConnectReport(query({ view: "executor", person: "DR_TST_1" }), TODAY);
    expect(own.executor!.routes!.sales!.rows.map((r) => [r.zone, r.sum])).toEqual([
      ["DR_TST_1", 40000],
    ]);

    // Days stored before the rep and the money were read count for nothing and say so.
    await db.connectRecord.updateMany({
      where: { kind: "SALE", day: "2026-11-09" },
      data: { data: { id: "900001|2026-11-09", storeCode: "900001", skus: { "SKU-TEST 1": 30 } } },
    });
    const old = (await buildConnectReport(query({ view: "exec" }), TODAY)).exec!.routes!.sales!;
    expect(old.legacy).toBe(true);
    expect(old.total.sum).toBe(30000);
  });

  it("lists the route stores nobody sold to in the period, the biggest first", async () => {
    const owner = await setup();
    await importConnectFiles(owner, [
      {
        name: "sales.xlsx",
        buffer: await salesBook([
          // The week shown: one store of DR_TST_1's two bought; the other bought the week before.
          sale(900001, "09.11.2026", "DR_TST_1", "TSM_TST_1", 30000),
          sale(900004, "03.11.2026", "DR_TST_1", "Другие", 10000),
        ]),
      },
    ]);

    const exec = await buildConnectReport(query({ view: "exec" }), TODAY);
    const sales = exec.exec!.routes!.sales!;
    expect(sales).toMatchObject({ clients: 3, buying: 1 });
    // The reps' stores: the graded one first; the ungraded one had two orders marked on the
    // route (the day to come does not count) and has never bought.
    expect(sales.idle).toEqual([
      {
        zone: "DR_TST_1",
        kind: "DR",
        person: "Тест Агент 1",
        storeCode: "900004",
        store: "Тест магазин 900004",
        organization: "Тестоград",
        grade: "M",
        equipment: null,
        visits: 3,
        orders: 0,
        lastSale: "2026-11-03",
      },
      {
        zone: "DR_TST_2",
        kind: "DR",
        person: "Тест Агент 2",
        storeCode: "900005",
        store: "Тест магазин 900005",
        organization: "Тестобад",
        grade: null,
        equipment: null,
        visits: 2,
        orders: 2,
        lastSale: null,
      },
    ]);

    // The Excel file has the whole list.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await connectXlsx(exec, TODAY)) as unknown as ArrayBuffer);
    const sheet = wb
      .getWorksheet("Точки без продаж")!
      .getSheetValues()
      .filter(Boolean)
      .map((row) => (row as ExcelJS.CellValue[]).slice(1));
    expect(sheet[0]).toEqual([
      "Зона",
      "Сотрудник",
      "Организация",
      "ИД клиента",
      "Точка",
      "Грейд",
      "Оборудование",
      "Визитов",
      "С заказом",
      "Последняя продажа",
    ]);
    expect(sheet.slice(1).map((row) => [row[0], row[3], row[7], row[8], row[9]])).toEqual([
      ["DR_TST_1", "900004", 3, 0, "2026-11-03"],
      ["DR_TST_2", "900005", 2, 2, undefined],
    ]);

    // A rep's own page has their stores only.
    const own = await buildConnectReport(query({ view: "executor", person: "DR_TST_2" }), TODAY);
    expect(own.executor!.routes!.sales!.idle.map((s) => s.storeCode)).toEqual(["900005"]);
    // With the TSMs alone it is their own routes: the store that was not visited too.
    const tsm = await buildConnectReport(query({ view: "exec", staff: "tsm" }), TODAY);
    expect(
      tsm.exec!.routes!.sales!.idle.map((s) => [s.zone, s.storeCode, s.visits, s.grade]),
    ).toEqual([
      ["TSM_TST_1", "900002", 0, "XL"],
      ["TSM_TST_2", "900003", 2, null],
    ]);
  });

  it("takes the TSMs' visits from the routes when no visit detail is loaded", async () => {
    await setup();
    const report = await buildConnectReport(query({ view: "exec" }), TODAY);
    expect(report.exec!.routes!.visitDays).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    const v = report.exec!.sections.visits;
    expect(v).toMatchObject({
      // TSM_TST_1: 900001 on the 9th–11th, 900002 on the 9th and 11th; TSM_TST_2: two visits.
      planned: 7,
      visited: 4,
      notVisited: 3,
      unplanned: 0,
      // The Market Visit and the check of the 9th count, whatever their time.
      withConnect: 1,
      allGood: 1,
      timed: 0,
    });
    expect(v.status.notInTime).toBe(0);
    // The DRs can be chosen on the executors' level; the cards stay the TSMs'.
    expect(report.people.map((p) => p.code).sort()).toEqual([
      "DR_TST_1",
      "DR_TST_2",
      "TSM_TST_1",
      "TSM_TST_2",
    ]);
    const cards = await buildConnectReport(query({ view: "executor" }), TODAY);
    expect(cards.executors!.map((r) => r.code).sort()).toEqual(["TSM_TST_1", "TSM_TST_2"]);
  });

  it("keeps a day's visit detail when there is one", async () => {
    const owner = await setup();
    await importConnectFiles(owner, [{ name: "detail.xlsx", buffer: await detail() }]);
    const report = await buildConnectReport(query({ view: "exec" }), TODAY);
    // The 9th is the detail's (one visit); the 10th and 11th come from the routes.
    expect(report.exec!.routes!.visitDays).toEqual(["2026-11-10", "2026-11-11"]);
    const v = report.exec!.sections.visits;
    expect(v).toMatchObject({ planned: 5, visited: 3, withConnect: 1, timed: 1, inTime: 0 });
    // 23:00 is long after the visit of 10:00–10:20.
    expect(v.status.notInTime).toBe(1);
    // The route analysis itself is not touched by it.
    expect(report.exec!.routes!.analysis.totals.TSM.planned).toBe(7);
  });

  it("shows a manager their zones with the change, and the stores to act on", async () => {
    const owner = await setup();
    const manager = await createTestUser("MANAGER");
    const lead = await withAccess(await db.user.findUniqueOrThrow({ where: { id: manager.id } }));
    await linkConnectPosition(owner, "BDM 99", manager.id);
    let access = await loadConnectAccess();
    let scope = leadScope(lead, access.people, access.positions);
    let report = await buildConnectReport(query({ view: "manager" }), TODAY, scope, {
      hierarchy: access.positions.hierarchy,
    });
    let a = report.manager!.routes!.analysis;
    expect(a.zones).toMatchObject([
      {
        zone: "TSM_TST_1",
        kind: "TSM",
        person: "Тест Первый",
        manager: "BDM 99",
        managerPerson: "Тест Руководитель",
        attendance: 40,
        // 1 of 1 the week before.
        attendanceDelta: -60,
      },
      { zone: "TSM_TST_2", attendance: 100, attendanceDelta: null },
    ]);
    expect(a.totals.DR.zones).toBe(0);
    expect(a.missed.map((s) => s.storeCode)).toEqual(["900002"]);
    expect(a.noOrder).toEqual([]);

    // The distributor's supervisor sees the reps under them.
    await linkConnectPosition(owner, "BDM 99", null);
    await linkConnectPosition(owner, "Supervisor TST", manager.id);
    access = await loadConnectAccess();
    scope = leadScope(lead, access.people, access.positions);
    report = await buildConnectReport(query({ view: "manager" }), TODAY, scope, {
      hierarchy: access.positions.hierarchy,
    });
    a = report.manager!.routes!.analysis;
    expect(a.zones.map((z) => [z.zone, z.hitRate, z.hitRateDelta, z.class])).toEqual([
      ["DR_TST_1", 33.3, -66.7, "one"],
      ["DR_TST_2", 100, null, "ok"],
    ]);
    expect(a.missed).toEqual([]);
    expect(a.noOrder.map((s) => s.storeCode)).toEqual(["900004"]);
    // Leadership's level stays the whole picture.
    const exec = await buildConnectReport(query({ view: "exec" }), TODAY, scope);
    expect(exec.exec!.routes!.analysis.zones).toHaveLength(4);
  });

  it("shows an executor their own zone", async () => {
    const owner = await setup();
    const tsm = await buildConnectReport(query({ view: "executor", person: "TSM_TST_1" }), TODAY);
    expect(tsm.executor!.routes).toMatchObject({
      level: "executor",
      staff: "all",
      zone: { zone: "TSM_TST_1", kind: "TSM", planned: 5, visited: 2, attendance: 40 },
    });
    expect(tsm.executor!.routes!.analysis.missed.map((s) => s.storeCode)).toEqual(["900002"]);
    // The visits of the list come from the routes too.
    expect(tsm.executor!.row).toMatchObject({ planned: 5, visited: 2, withConnect: 1, timed: 0 });

    // A sales rep linked to their code sees their route (and nothing of Connect Bot).
    const rep = await createTestUser("MEMBER");
    await linkConnectPerson(owner, "DR_TST_1", rep.id);
    const access = await loadConnectAccess();
    const { query: scoped, own } = scopeConnectQuery(
      parseConnectQuery({ ...WEEK, staff: "TSM" }, false),
      false,
      access.people,
      rep.id,
      access.positions,
    );
    expect(own).toEqual(["DR_TST_1"]);
    const mine = await buildConnectReport(scoped, TODAY, new Set(own), {
      hierarchy: access.positions.hierarchy,
      own: true,
    });
    expect(mine.query.person).toBe("DR_TST_1");
    expect(mine.executor!.row).toMatchObject({ code: "DR_TST_1", planned: 0 });
    // The staff switch is not for this level.
    expect(mine.executor!.routes).toMatchObject({
      staff: "all",
      zone: { kind: "DR", person: "Тест Агент 1", visits: 6, orders: 2, hitRate: 33.3 },
    });
    expect(mine.executor!.routes!.analysis.noOrder.map((s) => s.storeCode)).toEqual(["900004"]);
    expect(mine.people.map((p) => p.code)).toEqual(["DR_TST_1"]);
  });

  it("adds the routes' sheets to the Excel file in Russian, English and Korean", async () => {
    await setup();
    const report = await buildConnectReport(query({ view: "manager" }), TODAY);
    const read = async (buffer: Buffer) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      return {
        names: wb.worksheets.map((ws) => ws.name),
        rows: (name: string) =>
          wb
            .getWorksheet(name)!
            .getSheetValues()
            .filter(Boolean)
            .map((row) => (row as ExcelJS.CellValue[]).slice(1)),
      };
    };
    const ru = await read(await connectXlsx(report, TODAY));
    expect(ru.names).toEqual(
      expect.arrayContaining(["Маршруты", "Пропущенные визиты", "DR без заказа"]),
    );
    const zones = ru.rows("Маршруты");
    expect(zones[0]!.slice(0, 5)).toEqual([
      "Зона",
      "Группа",
      "Сотрудник",
      "Руководитель",
      "Организация",
    ]);
    // Zone, group, person, manager, organization, stores, plan, visited, attendance, change.
    expect(zones[1]!.slice(0, 10)).toEqual([
      "TSM_TST_1",
      "TSM",
      "Тест Первый",
      "BDM 99 · Тест Руководитель",
      "Тестоград",
      2,
      5,
      2,
      40,
      -60,
    ]);
    expect(zones).toHaveLength(5);
    // The missed list in full: zone … store, misses, days, last visit, grade, equipment.
    expect(ru.rows("Пропущенные визиты")[1]).toEqual([
      "TSM_TST_1",
      "TSM",
      "Тест Первый",
      "Тестоград",
      "900002",
      "Тест магазин 900002",
      2,
      "2026-11-09, 2026-11-11",
      undefined,
      "XL",
      "Display TST",
    ]);
    expect(ru.rows("DR без заказа")[1]!.slice(0, 6)).toEqual([
      "DR_TST_1",
      "Тест Агент 1",
      "Тестоград",
      "900004",
      "Тест магазин 900004",
      3,
    ]);

    const en = await read(await withExportLocale("en", () => connectXlsx(report, TODAY)));
    expect(en.names).toEqual(expect.arrayContaining(["Routes", "Missed visits", "DR no order"]));
    expect(en.rows("Routes")[0]!.slice(0, 3)).toEqual(["Zone", "Group", "Employee"]);
    expect(en.rows("Routes").at(-1)!.at(-1)).toBe("Both targets reached");
    const ko = await read(await withExportLocale("ko", () => connectXlsx(report, TODAY)));
    expect(ko.names).toEqual(expect.arrayContaining(["루트", "미방문", "DR 주문 없음"]));
    expect(ko.rows("루트")[0]!.slice(0, 3)).toEqual(["구역", "그룹", "직원"]);

    // Only the TSMs: no sheet of the DRs' stores.
    const tsm = await buildConnectReport(query({ view: "manager", staff: "TSM" }), TODAY);
    expect((await read(await connectXlsx(tsm, TODAY))).names).not.toContain("DR без заказа");
  });

  it("makes the Excel file look like the page: the norms' colours, the sources, the cover", async () => {
    const owner = await setup();
    await importConnectFiles(owner, [
      {
        name: "sales.xlsx",
        buffer: await salesBook([
          sale(900001, "03.11.2026", "DR_TST_1", "TSM_TST_1", 40000),
          sale(900001, "09.11.2026", "DR_TST_1", "TSM_TST_1", 30000),
          sale(900004, "10.11.2026", "DR_TST_1", "Другие", 10000),
          sale(900005, "11.11.2026", "Operator 9 (Тест)", "TSM_TST_2", 20000),
        ]),
      },
    ]);
    const RED = "FFFED5D7";
    const AMBER = "FFFFEEBF";
    const GREEN = "FFD9F5EB";
    const fillOf = (cell: ExcelJS.Cell) =>
      cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined;
    const open = async (lang: "ru" | "en" | "ko" = "ru") => {
      const wb = new ExcelJS.Workbook();
      await withExportLocale(lang, async () => {
        const report = await buildConnectReport(query({ view: "exec" }), TODAY);
        await wb.xlsx.load((await connectXlsx(report, TODAY)) as unknown as ArrayBuffer);
      });
      // A row of a sheet by its first cell.
      const row = (sheet: string, first: string) => {
        let found: ExcelJS.Row | undefined;
        wb.getWorksheet(sheet)!.eachRow((r) => {
          if (!found && r.getCell(1).text === first) found = r;
        });
        return found!;
      };
      // The cover's texts and the sheets its links open.
      const cover = wb.worksheets[0]!;
      const texts: string[] = [];
      const links: string[] = [];
      cover.eachRow((r) =>
        r.eachCell((cell) => {
          if (cell.isMerged && cell.master !== cell) return;
          texts.push(cell.text);
          if (cell.hyperlink) links.push(cell.hyperlink.replace(/^#'(.*)'!A1$/, "$1"));
        }),
      );
      return { wb, row, cover, texts, links };
    };

    // The standard norms: attendance 95%, hit rate 90%, planned visits made 85%.
    const ru = await open();
    const zones = ru.wb.getWorksheet("Маршруты")!;
    // The header as on the page, in place when the sheet is scrolled; the table can be filtered.
    expect(zones.getRow(1).getCell(9).value).toBe("Посещаемость, %");
    expect(zones.getRow(1).getCell(9).font).toMatchObject({ bold: true });
    expect(fillOf(zones.getRow(1).getCell(9))).toBe("FFF0F3F7");
    expect(zones.getRow(1).getCell(9).alignment).toMatchObject({
      horizontal: "right",
      vertical: "middle",
      wrapText: true,
    });
    expect(zones.views[0]).toMatchObject({ state: "frozen", ySplit: 1, xSplit: 1 });
    expect(zones.autoFilter).toBe("A1:T5");
    // A share under its target is red, one at the target green; the value is the number it was.
    const first = ru.row("Маршруты", "TSM_TST_1");
    expect([first.getCell(9).value, first.getCell(9).numFmt]).toEqual([40, '0.0"%"']);
    expect(fillOf(first.getCell(9))).toBe(RED);
    expect(fillOf(ru.row("Маршруты", "TSM_TST_2").getCell(9))).toBe(GREEN);
    const rep = ru.row("Маршруты", "DR_TST_1");
    expect([rep.getCell(17).value, fillOf(rep.getCell(17))]).toEqual([33.3, RED]);
    expect(fillOf(ru.row("Маршруты", "DR_TST_2").getCell(17))).toBe(GREEN);
    // The change against the week before: an arrow by the number format, a fall in red.
    expect(first.getCell(10).value).toBe(-60);
    expect(first.getCell(10).numFmt).toBe('"▲ "0.0" п.п.";"▼ "0.0" п.п.";0.0" п.п."');
    expect(first.getCell(10).font?.color?.argb).toBe("FFE7000B");
    expect(rep.getCell(10).font?.color?.argb).toBeUndefined();
    // The rows the page marks: the TSM far under the target, the rep with one target missed
    // (its class is written in the same colour); a zone that reaches its targets has no mark.
    expect(fillOf(first.getCell(1))).toBe(RED);
    expect(fillOf(rep.getCell(1))).toBe(AMBER);
    expect([rep.getCell(20).value, rep.getCell(20).font?.color?.argb]).toEqual([
      "Одна ниже цели",
      "FFBB4D00",
    ]);
    expect(fillOf(ru.row("Маршруты", "DR_TST_2").getCell(1))).toBeUndefined();

    // «Продажи по зонам»: the change keeps its number and shows the arrow; a fall of a tenth and
    // more is red (and marks the row), no fall green.
    const fall = ru.row("Продажи по зонам", "TSM_TST_1");
    expect([fall.getCell(6).value, fall.getCell(6).numFmt]).toEqual([
      -25,
      '"▲ "0.0"%";"▼ "0.0"%";0.0"%"',
    ]);
    expect([fillOf(fall.getCell(6)), fillOf(fall.getCell(1))]).toEqual([RED, RED]);
    const flat = ru.row("Продажи по зонам", "DR_TST_1");
    expect([flat.getCell(6).value, fillOf(flat.getCell(6))]).toEqual([0, GREEN]);
    expect(fillOf(flat.getCell(1))).toBeUndefined();
    expect(fall.getCell(5).numFmt).toBe("#,##0");

    // Whose data a sheet is: Smart Up violet, the Connect bot sky, both compared slate.
    const tab = (name: string) => ru.wb.getWorksheet(name)!.properties.tabColor?.argb;
    expect(tab("Маршруты")).toBe("FF8E51FF");
    expect(tab("Продажи по зонам")).toBe("FF8E51FF");
    expect(tab("OOS и заказы")).toBe("FF00A6F4");
    expect(tab("Market Visit")).toBe("FF00A6F4");
    expect(tab("Визиты и Connect")).toBe("FF62748E");
    expect(tab("Сводка")).toBeUndefined();
    // A list of numbers has no filter.
    expect(ru.wb.getWorksheet("Визиты и Connect")!.autoFilter).toBeUndefined();

    // The cover is the first sheet: the title, the level's numbers in the page's colours, what
    // the file is, the norms in force with what each colour means, the sheets.
    expect(ru.wb.worksheets[0]!.name).toBe("Сводка");
    expect(ru.cover.getCell("A1").value).toBe("Аналитика Connect — Руководство: 9–15 нояб.");
    expect([ru.cover.getCell("A2").value, ru.cover.getCell("B2").value]).toEqual([
      "Показатель",
      "Значение",
    ]);
    // 4 of the 7 planned visits made: under the line of 85%.
    const plan = ru.row("Сводка", "План визитов выполнен, %");
    expect([plan.getCell(2).value, plan.getCell(2).numFmt]).toEqual([57, '0.0"%"']);
    expect(fillOf(plan.getCell(2))).toBe(RED);
    expect(plan.getCell(4).value).toBe("4 из 7 визитов");
    expect(ru.texts).toEqual(
      expect.arrayContaining([
        "О файле",
        "Руководство",
        "все сотрудники",
        "9–15 нояб.",
        "2–8 нояб. — предыдущий период такой же длины",
        "Нормы и цвета",
        "Зелёный — норма выполнена",
        "Жёлтый — близко к норме",
        "Красный — далеко от нормы",
        "Что ещё выделено цветом",
        "Листы",
        "Маршруты по зонам: посещаемость, hit rate и их изменение к предыдущему периоду.",
      ]),
    );
    expect(ru.texts.some((text) => text.includes("Данные маршрутов по 16 нояб."))).toBe(true);
    const norm = (label: string) =>
      [2, 3, 4, 5].map((c) => ru.row("Сводка", label).getCell(c).value);
    expect(norm("Посещаемость — цель")).toEqual([
      "95%",
      "от 95%",
      "от 80,75%, но меньше 95%",
      "меньше 80,75%",
    ]);
    expect(norm("Посещено плановых визитов — меньше")).toEqual([
      "85%",
      "от 92,5%",
      "от 85%, но меньше 92,5%",
      "меньше 85%",
    ]);
    expect(
      [3, 4, 5].map((c) => fillOf(ru.row("Сводка", "Посещаемость — цель").getCell(c))),
    ).toEqual([GREEN, AMBER, RED]);
    // Every other sheet is listed once, in the file's order; its name opens it.
    const names = ru.wb.worksheets.slice(1).map((ws) => ws.name);
    expect(ru.links).toEqual(names);
    const listed = ru.row("Сводка", "Маршруты");
    expect(listed.getCell(1).value).toMatchObject({ hyperlink: "#'Маршруты'!A1" });
    expect([listed.getCell(5).value, fillOf(listed.getCell(5))]).toEqual(["Smart Up", "FFF4EEFF"]);
    expect(ru.row("Сводка", "OOS и заказы").getCell(5).value).toBe("Connect-бот");
    expect(ru.row("Сводка", "Визиты и Connect").getCell(5).value).toBe("Connect-бот + Smart Up");

    // The owner changes the norms: the same numbers, other colours — in the sheets and on the
    // cover, as on the page.
    await saveConnectRules(owner, { ...DEFAULT_RULES, attendance: 40, hitRate: 35, visited: 30 });
    const own = await open();
    const again = own.row("Маршруты", "TSM_TST_1");
    expect([again.getCell(9).value, fillOf(again.getCell(9))]).toEqual([40, GREEN]);
    expect(fillOf(again.getCell(1))).toBeUndefined();
    // 33.3% is close to a target of 35%.
    expect(fillOf(own.row("Маршруты", "DR_TST_1").getCell(17))).toBe(AMBER);
    // 57% is above the line of 30% now, in its lower half.
    expect(fillOf(own.row("Сводка", "План визитов выполнен, %").getCell(2))).toBe(AMBER);
    expect(
      [2, 3, 4, 5].map((c) => own.row("Сводка", "Посещаемость — цель").getCell(c).value),
    ).toEqual(["40%", "от 40%", "от 34%, но меньше 40%", "меньше 34%"]);
    // The change of sales has no norm of the owner's: it stays as it was.
    expect(fillOf(own.row("Продажи по зонам", "TSM_TST_1").getCell(6))).toBe(RED);
    await saveConnectRules(owner, null);

    // English and Korean: the same file, the cover in its language, every link to a sheet.
    for (const [lang, sheet, norms] of [
      ["en", "Summary", "Norms and colours"],
      ["ko", "요약", "기준과 색"],
    ] as const) {
      const file = await open(lang);
      expect(file.wb.worksheets[0]!.name).toBe(sheet);
      expect(file.texts).toContain(norms);
      expect(file.links).toEqual(file.wb.worksheets.slice(1).map((ws) => ws.name));
      expect(file.links.length).toBeGreaterThan(10);
    }
    // One TSM's own file in Korean: «not visited» of the plan and of the route are two sheets.
    const single = new ExcelJS.Workbook();
    await withExportLocale("ko", async () => {
      const one = await buildConnectReport(query({ view: "executor", person: "TSM_TST_1" }), TODAY);
      await single.xlsx.load((await connectXlsx(one, TODAY)) as unknown as ArrayBuffer);
    });
    expect(single.worksheets.map((ws) => ws.name)).toEqual(
      expect.arrayContaining(["요약", "계획 미방문", "미방문"]),
    );
  });
});
