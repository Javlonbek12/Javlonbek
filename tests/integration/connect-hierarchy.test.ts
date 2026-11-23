import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { flattenTree } from "@/modules/connect/hierarchy";
import { connectPptx } from "@/modules/connect/pptx";
import {
  buildConnectReport,
  leadScope,
  loadConnectAccess,
  parseConnectQuery,
} from "@/modules/connect/report";
import {
  connectDataDate,
  connectLoaded,
  importConnectFiles,
  linkConnectPerson,
  linkConnectPosition,
} from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// Connect v3: the CRM's employee info (who reports to whom) and its sales report next to the
// Connect workbook. Synthetic data only: positions «BDM 99» / «BUM TEST», TSM_TST_* codes,
// «Тест …» people, stores 9000xx, SKU-TEST products.

type Row = (string | number | null)[];
const TODAY = "2026-11-09";
const PERIOD = { from: "2026-11-02", to: "2026-11-08" };
const NO_ANSWER = "Точка не ответила";
const DELIVERED = "Доставлено — ожидает подтверждения точки";

const book = async (sheets: { name: string; rows: Row[] }[]) => {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const EMP_HEADERS = [
  "ИД",
  "Название",
  "Пользователь",
  "Рабочие зоны",
  "Роли",
  "Руководитель",
  "Дата создания",
  "Статус",
];
const pos = (id: number, title: string, user: string, zones: string, roles: string, boss: string) =>
  [id, title, user, zones, roles, boss, "01.10.2026 09:00:00", "Активный"] as Row;
// BUM TEST has no row of its own; the distributor's supervisor has no TSM under him.
const employees = () =>
  book([
    {
      name: "Sheet",
      rows: [
        EMP_HEADERS,
        pos(900101, "BDM 99", "Тест Руководитель", "TSM_TST_1, TSM_TST_2", "KT&G BDM", "BUM TEST"),
        pos(900102, "TSM_TST_1", "Тест TSM 1", "Тестовая зона 1", "Мерчендайзер", "BDM 99"),
        pos(900103, "TSM_TST_2", "Тест TSM 2", "Тестовая зона 2", "Мерчендайзер", "bdm  99"),
        pos(
          900104,
          "Supervisor 1 (Тест дистрибьютор)",
          "Тест Супервайзер",
          "DR 99",
          "Супервайзер",
          "Director (Тест дистрибьютор)",
        ),
      ],
    },
  ]);

const SALES_HEADERS = [
  "Клиент",
  "ИД клиента",
  "Организация",
  "ХЮ:(TSM;DR) Основной канал / POS channel",
  "Дата доставки",
  "ТМЦ",
  "Количество продажи",
];
const sale = (client: number, day: string, sku: string, blocks: number): Row => [
  `Тестовая точка ${client}`,
  String(client),
  "Тестовая организация",
  "Retail",
  day,
  sku,
  blocks,
];
// Smart Up's own export has the lines of the report's filters above the header and a totals row
// at the end (`asExported`); a sheet with the header in row 1 is read the same.
const sales = (rows: Row[], asExported = false) =>
  book([
    {
      name: "Конструктор отчётов по продажам",
      rows: asExported
        ? [
            ["Дата доставки:  02.11.2026-05.11.2026"],
            ["Организация: Тестовая организация"],
            [],
            SALES_HEADERS,
            ...rows,
            [...SALES_HEADERS.slice(0, -1).map(() => "ИТОГО"), 1000],
          ]
        : [SALES_HEADERS, ...rows],
    },
  ]);
// A sale as it was stored before 23.11.2026: a row per store, day and product.
const oldSale = (importId: string, client: number, day: string, sku: string, blocks: number) => {
  const columns = {
    storeCode: String(client),
    storeName: `Тестовая точка ${client}`,
    city: "Тестовая организация",
    channel: "Retail",
    day,
    month: day.slice(0, 7),
    person: null,
  };
  const id = `${client}|${day}|${sku.toLowerCase()}`;
  return {
    kind: "SALE" as const,
    externalId: id,
    ...columns,
    data: { id, ...columns, at: `${day}T00:00`, sku, blocks },
    importId,
  };
};
// What the cross-check says with the sales of 2–5 Nov (#TEST-2's window, 3–6 Nov, is not covered
// yet), and with the sales of 6 Nov too.
const CHECK_TO_5_NOV = {
  orders: 3,
  checked: 2,
  notClosed: 1,
  anySold: 1,
  allSold: 1,
  lines: 2,
  linesSold: 1,
  packsOrdered: 30,
  packsSold: 20,
  packsSoldRaw: 20,
};
const CHECK_TO_6_NOV = {
  to: "2026-11-06",
  checked: 3,
  notClosed: 0,
  anySold: 2,
  allSold: 1,
  lines: 4,
  linesSold: 2,
  packsOrdered: 45,
  packsSold: 15,
  packsSoldRaw: 20,
};

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
];
const SKUS = ["SKU-TEST-001", "SKU-TEST-002"];
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
const su = (code: string, client: number, id: number, day: string): Row => [
  "Тестоград",
  "Тестовая зона",
  code,
  client,
  `Тестовая точка ${client}`,
  id,
  day,
  day,
  "10:00:00",
  "10:20:00",
];
const order = (
  no: string,
  client: number,
  day: string,
  code: string,
  status: string,
  skus: (number | null)[],
): Row => [
  no,
  `Тестовая точка ${client}`,
  client,
  "Тестоград",
  `${day} 10:30`,
  "2026-11",
  "Отправлен",
  status,
  `${code} - Тест ${code}`,
  null,
  skus.filter(Boolean).length,
  skus.reduce<number>((a, b) => a + (b ?? 0), 0),
  100000,
  ...skus,
];
// TSM_TST_3 is in no position of the employee info.
const connect = () =>
  book([
    {
      name: "Visit Detailization (Smart up)",
      rows: [
        SU_HEADERS,
        su("TSM_TST_1", 900001, 7001, "02.11.2026"),
        su("TSM_TST_2", 900005, 7002, "03.11.2026"),
        su("TSM_TST_3", 900007, 7003, "02.11.2026"),
      ],
    },
    {
      name: "OOS orders (Connect Bot)",
      rows: [
        ORDER_HEADERS,
        order("#TEST-1", 900001, "02.11.2026", "TSM_TST_1", NO_ANSWER, [20, null]),
        order("#TEST-2", 900005, "03.11.2026", "TSM_TST_2", DELIVERED, [10, 5]),
        order("#TEST-3", 900007, "02.11.2026", "TSM_TST_3", NO_ANSWER, [null, 10]),
      ],
    },
  ]);

const managers = (scope: Set<string> | null = null) =>
  buildConnectReport(parseConnectQuery({ view: "manager", ...PERIOD }, true), TODAY, scope);

describe("Connect analytics: the employee hierarchy and the sales cross-check", () => {
  beforeEach(resetDb);

  it("uploads the three files, builds the managers' tree and checks sales after orders", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const results = await importConnectFiles(owner, [
      { name: "connect.xlsx", buffer: await connect() },
      { name: "employees.xlsx", buffer: await employees() },
      {
        name: "sales.xlsx",
        buffer: await sales(
          [
            sale(900009, "02.11.2026", "SKU-TEST-001", 1),
            sale(900009, "02.11.2026", "SKU-TEST-002", 3),
            // The same store, day and product twice (the name in another case): summed.
            sale(900001, "03.11.2026", "sku-test-001", 1),
            sale(900001, "03.11.2026", "SKU-TEST-001", 1),
            sale(900002, "05.11.2026", "SKU-TEST-002", 1),
          ],
          true,
        ),
      },
    ]);
    expect(results.map((r) => r.sheets.map((s) => [s.kind, s.created, s.replaced]))).toEqual([
      [
        ["SU_VISIT", 3, 0],
        ["ORDER", 3, null],
      ],
      [["SU_POSITION", 4, 0]],
      // Four lines (a store, a day, a product) …
      [["SALE", 4, 0]],
    ]);
    // … stored a store's day per row, with the day's products inside.
    const stored = await db.connectRecord.findMany({
      where: { kind: "SALE" },
      orderBy: { day: "asc" },
    });
    expect(stored.map((r) => [r.externalId, r.storeCode, r.day, r.month])).toEqual([
      ["900009|2026-11-02", "900009", "2026-11-02", "2026-11"],
      ["900001|2026-11-03", "900001", "2026-11-03", "2026-11"],
      ["900002|2026-11-05", "900002", "2026-11-05", "2026-11"],
    ]);
    expect(stored[0]).toMatchObject({ storeName: "Тестовая точка 900009", channel: "Retail" });
    expect(stored[0]!.data).toEqual({
      id: "900009|2026-11-02",
      storeCode: "900009",
      storeName: "Тестовая точка 900009",
      city: "Тестовая организация",
      channel: "Retail",
      at: "2026-11-02T00:00",
      day: "2026-11-02",
      month: "2026-11",
      person: null,
      skus: { "SKU-TEST-001": 1, "SKU-TEST-002": 3 },
    });
    expect(stored[1]!.data).toMatchObject({ skus: { "SKU-TEST-001": 2 } });
    expect(results[2]!.sheets[0]).toMatchObject({ from: "2026-11-02", to: "2026-11-05" });
    // Sales and positions don't move the data date.
    expect(await connectDataDate()).toBe("2026-11-03");
    expect(
      (await connectLoaded()).filter((l) => ["SU_POSITION", "SALE"].includes(l.kind)),
    ).toMatchObject(
      expect.arrayContaining([
        { kind: "SU_POSITION", count: 4, from: null, to: null, at: expect.any(Date) },
        // Counted in lines, as the report has them.
        { kind: "SALE", count: 4, from: "2026-11-02", to: "2026-11-05", at: expect.any(Date) },
      ]),
    );

    // The tree: BUM TEST (no row) → BDM 99 → two TSMs; the distributor's branch idle; TSM 3
    // outside the hierarchy.
    let report = await managers();
    expect(report.salesDate).toBe("2026-11-05");
    const tree = report.manager!.tree!;
    expect(flattenTree(tree.roots).map((n) => [n.title, n.depth, n.tsms])).toEqual([
      ["BUM TEST", 0, 2],
      ["BDM 99", 1, 2],
      ["TSM_TST_1", 2, 1],
      ["TSM_TST_2", 2, 1],
    ]);
    expect(tree.roots[0]!.people).toEqual([]);
    expect(tree.roots[0]!.children[0]!.people).toEqual([
      { name: "Тест Руководитель", roles: ["KT&G BDM"] },
    ]);
    expect(tree.roots[0]!.totals).toMatchObject({ planned: 2, visited: 2, orders: 2 });
    expect(tree.idle.map((n) => n.title)).toEqual(["Director (Тест дистрибьютор)"]);
    expect(tree.outside.map((r) => r.code)).toEqual(["TSM_TST_3"]);

    // Sales: #TEST-2's window (3–6 Nov) is not covered by sales up to 5 Nov.
    expect(report.manager!.sections.oos.sales).toMatchObject(CHECK_TO_5_NOV);

    // Sales of 6 Nov: #TEST-2's window closes, its second product sold (10 packs for 5 ordered).
    const [more] = await importConnectFiles(owner, [
      {
        name: "sales-6.xlsx",
        buffer: await sales([sale(900005, "06.11.2026", "SKU-TEST-002", 1)]),
      },
    ]);
    expect(more!.sheets).toMatchObject([
      { kind: "SALE", created: 1, replaced: 0, from: "2026-11-06" },
    ]);
    // A new export of 3 Nov replaces that day only.
    const [again] = await importConnectFiles(owner, [
      {
        name: "sales-3.xlsx",
        buffer: await sales([sale(900001, "03.11.2026", "SKU-TEST-001", 1)]),
      },
    ]);
    expect(again!.sheets).toMatchObject([{ kind: "SALE", created: 1, replaced: 1 }]);
    expect(await db.connectRecord.count({ where: { kind: "SALE" } })).toBe(4);

    report = await managers();
    const s = report.manager!.sections.oos.sales!;
    expect(s).toMatchObject(CHECK_TO_6_NOV);
    expect(s.byStatus.map((b) => [b.status, b.orders, b.anySold])).toEqual([
      [NO_ANSWER, 2, 1],
      [DELIVERED, 1, 1],
    ]);
    expect(s.topUnsold.map((u) => [u.sku, u.unsold, u.ordered])).toEqual([
      ["SKU-TEST-001", 1, 2],
      ["SKU-TEST-002", 1, 2],
    ]);
    const bdm = report.manager!.tree!.roots[0]!.children[0]!;
    expect(bdm.totals!.sales).toMatchObject({ checked: 2, anySold: 2, allSold: 1 });
    expect(bdm.totals!.salesRate).toBe(100);

    // The TSM outside the hierarchy: their order with nothing sold.
    const third = await buildConnectReport(
      parseConnectQuery({ view: "executor", person: "TSM_TST_3", ...PERIOD }, true),
      TODAY,
    );
    expect(third.executor!.detail.unsold).toMatchObject([
      { id: "#TEST-3", day: "2026-11-02", status: NO_ANSWER, skus: ["SKU-TEST-002"] },
    ]);

    // Downloads: the tree and the cross-check in Excel; PowerPoint builds.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await connectXlsx(report, TODAY)) as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(
      expect.arrayContaining(["Иерархия", "Продажи после заказа", "Продажи по статусам"]),
    );
    const treeSheet = wb.getWorksheet("Иерархия")!;
    expect(treeSheet.getRow(2).getCell(1).value).toBe("BUM TEST");
    expect(treeSheet.getRow(3).getCell(1).alignment?.indent).toBe(1);
    const exec = new ExcelJS.Workbook();
    await exec.xlsx.load((await connectXlsx(third, TODAY)) as unknown as ArrayBuffer);
    expect(exec.getWorksheet("Заказы без продаж")!.getRow(2).getCell(1).value).toBe("#TEST-3");
    expect((await connectPptx(report, TODAY)).subarray(0, 2).toString()).toBe("PK");

    // A new employee info replaces the whole hierarchy: TSM 3 now has a position.
    const [snapshot] = await importConnectFiles(owner, [
      {
        name: "employees-2.xlsx",
        buffer: await book([
          {
            name: "Sheet",
            rows: [
              EMP_HEADERS,
              pos(900101, "BDM 99", "Тест Руководитель", "", "KT&G BDM", "BUM TEST"),
              pos(900102, "TSM_TST_1", "Тест TSM 1", "", "Мерчендайзер", "BDM 99"),
              pos(900105, "Senior TEST", "Тест Старший", "TSM_TST_3", "KT&G BDM", "BUM TEST"),
            ],
          },
        ]),
      },
    ]);
    expect(snapshot!.sheets).toMatchObject([{ kind: "SU_POSITION", created: 3, replaced: 4 }]);
    const after = (await managers()).manager!.tree!;
    expect(flattenTree(after.roots).map((n) => n.title)).toEqual([
      "BUM TEST",
      "BDM 99",
      "TSM_TST_1",
      "Senior TEST",
    ]);
    // TSM 3 by the zones of Senior TEST; TSM 2 has no position any more.
    expect(after.roots[0]!.children[1]!.own.map((r) => r.code)).toEqual(["TSM_TST_3"]);
    expect(after.outside.map((r) => r.code)).toEqual(["TSM_TST_2"]);
    expect(after.idle).toEqual([]);
  });

  it("reads the sales stored a row per line before 23.11.2026, until an upload replaces their days", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [{ name: "connect.xlsx", buffer: await connect() }]);
    const log = await db.connectImport.create({
      data: { fileName: "old-sales.xlsx", kinds: "SALE", created: 3, updated: 0, skipped: 0 },
    });
    await db.connectRecord.createMany({
      data: [
        oldSale(log.id, 900009, "2026-11-02", "SKU-TEST-001", 1),
        oldSale(log.id, 900001, "2026-11-03", "SKU-TEST-001", 2),
        oldSale(log.id, 900002, "2026-11-05", "SKU-TEST-002", 1),
      ],
    });
    // The same cross-check as with these sales uploaded today.
    let report = await managers();
    expect(report.salesDate).toBe("2026-11-05");
    expect(report.manager!.sections.oos.sales).toMatchObject(CHECK_TO_5_NOV);
    expect((await connectLoaded()).find((l) => l.kind === "SALE")).toMatchObject({
      count: 3,
      from: "2026-11-02",
      to: "2026-11-05",
    });

    // A report of 3–6 Nov replaces the old rows of its days (two lines); 2 Nov stays as it was.
    const [next] = await importConnectFiles(owner, [
      {
        name: "sales-3-6.xlsx",
        buffer: await sales(
          [
            sale(900001, "03.11.2026", "SKU-TEST-001", 1),
            sale(900005, "06.11.2026", "SKU-TEST-002", 1),
          ],
          true,
        ),
      },
    ]);
    expect(next!.sheets).toMatchObject([
      { kind: "SALE", created: 2, replaced: 2, skipped: 0, from: "2026-11-03", to: "2026-11-06" },
    ]);
    const stored = await db.connectRecord.findMany({
      where: { kind: "SALE" },
      orderBy: { day: "asc" },
    });
    expect(stored.map((r) => r.externalId)).toEqual([
      "900009|2026-11-02|sku-test-001",
      "900001|2026-11-03",
      "900005|2026-11-06",
    ]);
    expect((await connectLoaded()).find((l) => l.kind === "SALE")).toMatchObject({ count: 3 });
    // Old and new rows are read together.
    report = await managers();
    expect(report.manager!.sections.oos.sales).toMatchObject(CHECK_TO_6_NOV);

    // The same report again replaces its own two lines.
    const [again] = await importConnectFiles(owner, [
      {
        name: "sales-3-6.xlsx",
        buffer: await sales([
          sale(900001, "03.11.2026", "SKU-TEST-001", 1),
          sale(900005, "06.11.2026", "SKU-TEST-002", 1),
        ]),
      },
    ]);
    expect(again!.sheets).toMatchObject([{ kind: "SALE", created: 2, replaced: 2 }]);
    expect(await db.connectRecord.count({ where: { kind: "SALE" } })).toBe(3);
  });

  it("a person linked to a position sees the TSMs under it, together with their team's links", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    await db.user.update({ where: { id: member.id }, data: { managerId: manager.id } });
    await importConnectFiles(owner, [
      { name: "connect.xlsx", buffer: await connect() },
      { name: "employees.xlsx", buffer: await employees() },
    ]);
    const lead = await withAccess(await db.user.findUniqueOrThrow({ where: { id: manager.id } }));

    // Nothing linked: nothing to see.
    let access = await loadConnectAccess();
    expect([...leadScope(lead, access.people, access.positions)!]).toEqual([]);

    // BDM 99 → the manager (titles compared without case); TSM 3 → their team member.
    await linkConnectPosition(owner, "bdm 99", manager.id);
    await linkConnectPerson(owner, "TSM_TST_3", member.id);
    access = await loadConnectAccess();
    expect(access.positions.links).toEqual({ "bdm 99": manager.id });
    const scope = leadScope(lead, access.people, access.positions)!;
    const report = await managers(scope);
    expect(report.manager!.people.map((p) => p.code).sort()).toEqual([
      "TSM_TST_1",
      "TSM_TST_2",
      "TSM_TST_3",
    ]);
    expect(flattenTree(report.manager!.tree!.roots).map((n) => n.title)).toEqual([
      "BUM TEST",
      "BDM 99",
      "TSM_TST_1",
      "TSM_TST_2",
    ]);
    // The distributor's branch is not theirs.
    expect(report.manager!.tree!.idle).toEqual([]);
    expect(report.manager!.tree!.outside.map((r) => r.code)).toEqual(["TSM_TST_3"]);

    // Unlinking the position takes its TSMs away again.
    await linkConnectPosition(owner, "BDM 99", null);
    access = await loadConnectAccess();
    expect([...leadScope(lead, access.people, access.positions)!]).toEqual(["TSM_TST_3"]);
    await expect(
      linkConnectPosition(await withAccess(member), "BDM 99", member.id),
    ).rejects.toThrow("forbidden");
  });
});
