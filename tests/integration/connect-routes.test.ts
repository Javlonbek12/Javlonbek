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
import {
  importConnectFiles,
  linkConnectPerson,
  linkConnectPosition,
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

describe("Connect: routes and discipline", () => {
  beforeEach(resetDb);

  it("keeps a row per employee of a zone's client", async () => {
    await setup();
    const rows = await db.connectRecord.findMany({
      where: { kind: "ROUTE", storeCode: "900001", person: "TSM_TST_1" },
      select: { externalId: true },
    });
    expect(rows.map((r) => r.externalId).sort()).toEqual([
      "2026-11|TSM_TST_1|900001",
      "2026-11|TSM_TST_1|900001|BDM 99",
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
      // The BDM's joint visit.
      unplanned: 1,
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
});
