import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { connectPptx } from "@/modules/connect/pptx";
import {
  buildConnectReport,
  leadScope,
  parseConnectQuery,
  scopeConnectQuery,
} from "@/modules/connect/report";
import {
  connectDataDate,
  connectPeopleLinks,
  importConnectFiles,
  linkConnectPerson,
} from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// Smart Up visits × Connect Bot: the owner's combined workbook (synthetic: TSM_TST_* codes,
// «Тест TSM» names, stores 9000xx) with all six sheets, uploaded and analysed.

type Row = (string | number | null)[];
const TODAY = "2026-11-09";
const TSM1 = "TSM_TST_1";
const TSM2 = "TSM_TST_2";
const PERSON1 = `${TSM1} - Тест TSM 1`;
const PERSON2 = `${TSM2} - Тест TSM 2`;

const SU_HEADERS = [
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
const TOTALS_HEADERS = [
  "Organization",
  "Working Zone",
  "Working Zone",
  "Working Zone",
  "Employee",
  "Employee",
  "Name of Employee",
  "Planned Visits",
  "Fact visits",
  "Completion rate %",
  "Unplanned visits",
  "Not visited stores",
];
const QUESTIONS = [
  "1.1 Тестовый вопрос перед визитом",
  "Торговая точка открыта?",
  "Тестовый вопрос 1",
  "Какой тип оборудования KT&G установлен в торговой точке?",
  "Подсветка оборудования KT&G включена?",
  "Тестовый вопрос 2",
];
const MV_HEADERS = [
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
  "Assigned task status",
  "Closed task",
  "Assigned Task Deadline",
  "Problematic Answers",
  "Frequent Problematic Questions",
  "Фото 1",
  "Шаблон",
  ...QUESTIONS,
];
const SKUS = ["SKU-TEST-001", "SKU-TEST-002"];
const OOS_HEADERS = [
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
  ...SKUS,
];
const ORDER_HEADERS = [
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
  ...SKUS,
];

const su = (
  employee: string,
  client: number,
  visitId: number | null,
  plan: string | null,
  fact: string | null,
  start: string | null = null,
  finish: string | null = null,
  comment: string | null = null,
): Row => [
  "Тестоград",
  employee,
  employee,
  client,
  `Тестовая точка ${client}`,
  visitId,
  plan,
  fact,
  start,
  finish,
  null,
  comment,
];

// answers: one per question after «Шаблон»; question 1.1 is always blank.
const mvRow = (
  id: number,
  client: number,
  person: string,
  start: string,
  answers: (string | null)[],
  photo: boolean,
  problems: string | null = null,
): Row => [
  id,
  client === 900099 ? "[TEST] Тестовая торговая точка" : `Тестовая точка ${client}`,
  client,
  "Тестоград",
  "Выполнено",
  80,
  null,
  person,
  start,
  "2026-11",
  start,
  null,
  null,
  null,
  problems ? 1 : 0,
  problems,
  photo ? "https://example.test/photo.jpg" : null,
  "Тестовая анкета",
  null,
  ...answers,
];
// Answers after the store status: question 1, equipment, its light, question 2.
const FULL = ["Да", "Тестовое оборудование", "Да", "Да"];

const sheetsOf = async (sheets: { name: string; rows: Row[] }[]) => {
  const book = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = book.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
};

const combined = () =>
  sheetsOf([
    {
      name: "Settings",
      rows: [["Тестовые настройки"], [], ["Timing tolerance (minutes)", 15]],
    },
    {
      name: "Total Visit info (Smart up)",
      rows: [
        TOTALS_HEADERS,
        // Smart Up writes the header twice (merged cells).
        TOTALS_HEADERS,
        [
          "Тестоград",
          "Тестовая зона 1",
          "Тестовая зона 1",
          "Тестовая зона 1",
          TSM1,
          TSM1,
          "Тест TSM 1",
          3,
          2,
          66.67,
          1,
          1,
        ],
        [
          "Тестоград",
          "Тестовая зона 2",
          "Тестовая зона 2",
          "Тестовая зона 2",
          TSM2,
          TSM2,
          "Тест TSM 2",
          1,
          1,
          100,
          0,
          0,
        ],
        ["Итого", "Итого", "Итого", "Итого", "Итого", "Итого", null, 4, 3, null, 1, 1],
      ],
    },
    {
      name: "Visit Detailization (Smart up)",
      rows: [
        SU_HEADERS,
        // TSM 1: store 1 — all in Connect; store 2 — MV by TSM 2, no OOS; store 3 planned, not
        // visited; store 4 — an unplanned visit without Connect.
        su(TSM1, 900001, 7001, "02.11.2026", "02.11.2026", "10:00:00", "10:20:00"),
        su(TSM1, 900002, 7002, "02.11.2026", "02.11.2026", "11:00:00", "11:10:00"),
        su(TSM1, 900003, null, "03.11.2026", null),
        su(TSM1, 900004, 7004, null, "03.11.2026", "12:00:00", "12:10:00"),
        // TSM 2: store 5 was closed (the MV says so): no OOS needed.
        su(TSM2, 900005, 7005, "03.11.2026", "03.11.2026", "09:00:00", "09:30:00"),
      ],
    },
    {
      name: "Market Visit (Connect Bot)",
      rows: [
        MV_HEADERS,
        mvRow(501, 900001, PERSON1, "02.11.2026 10:05", ["Да", ...FULL], true),
        // A copy of the same store-day, less complete.
        mvRow(502, 900001, PERSON1, "02.11.2026 10:06", ["Да", "Да", null, null, null], true),
        mvRow(503, 900002, PERSON2, "02.11.2026 11:05", ["Да", ...FULL], true, "Тестовый вопрос 2"),
        // 15 minutes after the visit's end: still during the visit.
        mvRow(504, 900005, PERSON2, "03.11.2026 09:45", ["Нет", null, null, null, null], false),
        // A test store: left out.
        mvRow(505, 900099, PERSON1, "02.11.2026 15:00", ["Да", ...FULL], true),
      ],
    },
    {
      name: "OOS check (Connect Bot)",
      rows: [
        OOS_HEADERS,
        [
          601,
          "Тестовая точка 900001",
          900001,
          "Тестоград",
          "02.11.2026 10:10",
          "2026-11",
          PERSON1,
          1,
          0,
          "Да",
          "#TEST-1",
          "Отправлен",
          "Точка не ответила",
          "Нет в наличии",
          "В наличии",
        ],
      ],
    },
    {
      name: "OOS orders (Connect Bot)",
      rows: [
        ORDER_HEADERS,
        [
          "#TEST-1",
          "Тестовая точка 900001",
          900001,
          "Тестоград",
          "02.11.2026 10:12",
          "2026-11",
          "Отправлен",
          "Точка не ответила",
          PERSON1,
          601,
          1,
          20,
          400000,
          20,
          null,
        ],
        [
          "#TEST-2",
          "Тестовая точка 900005",
          900005,
          "Тестоград",
          "03.11.2026 09:50",
          "2026-11",
          "Отправлен",
          "Доставлено — ожидает подтверждения точки",
          PERSON2,
          null,
          2,
          15,
          300000,
          10,
          5,
        ],
      ],
    },
  ]);

describe("Connect analytics: Smart Up visits × Connect Bot", () => {
  beforeEach(resetDb);

  it("uploads the combined workbook and counts visits, OOS, orders and Market Visit", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const [result] = await importConnectFiles(owner, [
      { name: "report.xlsx", buffer: await combined() },
    ]);
    expect(result!.sheets.map((s) => [s.kind, s.created, s.from, s.to, s.test])).toEqual([
      ["SU_PERSON", 2, null, null, 0],
      ["SU_VISIT", 5, "2026-11-02", "2026-11-03", 0],
      ["VISIT", 5, "2026-11-02", "2026-11-03", 1],
      ["OOS", 1, "2026-11-02", "2026-11-02", 0],
      ["ORDER", 2, "2026-11-02", "2026-11-03", 0],
    ]);
    expect(result!.sheets.find((s) => s.kind === "SU_VISIT")?.replaced).toBe(0);
    // The repeated header and the «Итого» row of the totals are neither data nor skipped rows.
    expect(result!.sheets.map((s) => s.skipped)).toEqual([0, 0, 0, 0, 0]);
    expect(await connectDataDate()).toBe("2026-11-03");

    // Nothing chosen: the latest week with data (2–8 Nov) is «last week» on 9 Nov.
    const report = await buildConnectReport(parseConnectQuery({}, true), TODAY);
    expect(report.period).toEqual({ from: "2026-11-02", to: "2026-11-08", preset: "lastWeek" });
    const s = report.exec!.sections;
    expect(s.visits).toMatchObject({
      planned: 4,
      visited: 3,
      notVisited: 1,
      unplanned: 1,
      withMv: 3,
      withOos: 1,
      otherEmployee: 1,
      closed: 1,
      mvDuplicateDays: 1,
      mvCopiesRemoved: 1,
      status: { ok: 2, noMv: 0, noOos: 1, notInTime: 0, otherEmployee: 0 },
    });
    expect(s.oos).toMatchObject({ checked: 1, withGap: 1, ledToOrder: 1, orders: 2, packs: 35 });
    expect(s.oos.byStatus.map((b) => b.status)).toEqual([
      "Доставлено — ожидает подтверждения точки",
      "Точка не ответила",
    ]);
    expect(s.mv).toMatchObject({
      unique: 3,
      results: { full: 2, closed: 1, partial: 0, noPhoto: 0, skipped: 0 },
      fullRate: 100,
    });
    expect(report.exec!.regions).toMatchObject([{ region: "Тестоград", people: 2, planned: 4 }]);
    expect(report.people.map((p) => [p.code, p.name, p.zone])).toEqual([
      [TSM1, "Тест TSM 1", "Тестовая зона 1"],
      [TSM2, "Тест TSM 2", "Тестовая зона 2"],
    ]);

    // One TSM's list: the visit to see to, the plan not visited, the duplicate, the order.
    const one = await buildConnectReport(
      parseConnectQuery({ view: "executor", person: TSM1 }, true),
      TODAY,
    );
    expect(one.executor!.detail.attention).toMatchObject([
      {
        storeCode: "900002",
        smartUp: "11:00–11:10",
        mvAt: "11:05",
        oosAt: null,
        issues: ["noOos", "otherEmployee"],
        by: PERSON2,
      },
    ]);
    expect(one.executor!.detail.notVisited.map((n) => n.store)).toEqual(["Тестовая точка 900003"]);
    expect(one.executor!.detail.duplicates).toMatchObject([{ mv: 2, oos: 0 }]);
    expect(one.executor!.detail.orders).toMatchObject([
      { id: "#TEST-1", status: "Точка не ответила" },
    ]);

    // A later Smart Up export of 3 Nov: the plan of store 3 became a visit. It replaces 3 Nov
    // only; 2 Nov stays as it was.
    const later = await sheetsOf([
      {
        name: "Детализация",
        rows: [
          SU_HEADERS,
          su(TSM1, 900003, 7003, "03.11.2026", "03.11.2026", "14:00:00", "14:10:00"),
          su(TSM1, 900004, 7004, null, "03.11.2026", "12:00:00", "12:10:00"),
          su(TSM2, 900005, 7005, "03.11.2026", "03.11.2026", "09:00:00", "09:30:00"),
        ],
      },
    ]);
    const [replaced] = await importConnectFiles(owner, [{ name: "su.xlsx", buffer: later }]);
    expect(replaced!.sheets).toMatchObject([
      { kind: "SU_VISIT", created: 3, replaced: 3, from: "2026-11-03", to: "2026-11-03" },
    ]);
    expect(await db.connectRecord.count({ where: { kind: "SU_VISIT" } })).toBe(5);
    const after = await buildConnectReport(parseConnectQuery({}, true), TODAY);
    expect(after.exec!.sections.visits).toMatchObject({ planned: 4, visited: 4, notVisited: 0 });

    // Every level downloads as Excel and PowerPoint.
    for (const view of ["exec", "manager", "executor"]) {
      const r = await buildConnectReport(parseConnectQuery({ view, person: TSM1 }, true), TODAY);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((await connectXlsx(r, TODAY)) as unknown as ArrayBuffer);
      expect(book.worksheets.length).toBeGreaterThan(3);
      expect((await connectPptx(r, TODAY)).subarray(0, 2).toString()).toBe("PK");
    }
  });

  it("managers see the TSMs of their team, employees their own list", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    await db.user.update({ where: { id: member.id }, data: { managerId: manager.id } });
    await importConnectFiles(owner, [{ name: "report.xlsx", buffer: await combined() }]);

    // Nothing linked: a manager sees no TSM, the owner every one.
    const lead = await withAccess(await db.user.findUniqueOrThrow({ where: { id: manager.id } }));
    expect([...leadScope(lead, await connectPeopleLinks())!]).toEqual([]);
    expect(leadScope(owner, await connectPeopleLinks())).toBeNull();

    await linkConnectPerson(owner, TSM1, member.id);
    await linkConnectPerson(owner, PERSON2, owner.id);
    const links = await connectPeopleLinks();
    expect(links).toEqual({ [TSM1]: member.id, [TSM2]: owner.id });
    const scope = leadScope(lead, links);
    expect([...scope!]).toEqual([TSM1]);
    const managers = await buildConnectReport(
      parseConnectQuery({ view: "manager" }, true),
      TODAY,
      scope,
    );
    expect(managers.manager!.people.map((p) => p.code)).toEqual([TSM1]);
    // Their visits only, but the MV TSM 2 made at their store still shows as «another employee».
    expect(managers.manager!.sections.visits).toMatchObject({
      planned: 3,
      visited: 2,
      otherEmployee: 1,
    });
    // A TSM outside the team can't be opened.
    const outside = await buildConnectReport(
      parseConnectQuery({ view: "executor", person: TSM2 }, true),
      TODAY,
      scope,
    );
    expect(outside.executor).toBeNull();

    // The employee linked to TSM 1 gets only their list.
    const mine = scopeConnectQuery(
      parseConnectQuery({ view: "exec", person: TSM2 }, false),
      false,
      links,
      member.id,
    );
    expect(mine).toMatchObject({ own: [TSM1], query: { view: "executor", person: TSM1 } });
    const report = await buildConnectReport(mine.query, TODAY, new Set(mine.own));
    expect(report.executor?.row).toMatchObject({ code: TSM1, planned: 3 });
  });
});
