import { render, screen, within } from "@testing-library/react";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { ExecView } from "@/components/connect/exec-view";
import { ExecutorView } from "@/components/connect/executor-view";
import { ManagerView } from "@/components/connect/manager-view";
import { withExportLocale } from "@/lib/i18n/server";
import { buildConnectReport, connectHref, parseConnectQuery } from "@/modules/connect/report";
import { importConnectFiles } from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { withAccess } from "@/modules/core/access/actor";
import { fillOf, readBook } from "@/tests/helpers/connect-page";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// «Путь OOS: от проверки до продажи», through uploads and the report: the bot's checks and orders,
// Smart Up's sales, routes, client base and employee info. Synthetic data only: TSM_TST_* /
// DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST n products.

type Row = (string | number | null)[];
const TODAY = "2026-11-16";
const WEEK = { from: "2026-11-09", to: "2026-11-15" };
const TSM1 = "TSM_TST_1";
const TSM2 = "TSM_TST_2";
const DR1 = "DR_TST_1";
const DR2 = "DR_TST_2";
const SKUS = Array.from({ length: 5 }, (_, i) => `SKU-TEST ${i + 1}`);

const book = async (rows: Row[], created?: Date) => {
  const wb = new ExcelJS.Workbook();
  if (created) wb.created = created;
  const ws = wb.addWorksheet("Тест");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

// A stock check: `out` are the numbers of the products that are out; `order` is what the check's
// own row says about its order (its number and where the delivery stands).
const check = (
  id: number,
  client: number,
  at: string,
  code: string,
  out: number[],
  order: [string, string] | null = null,
  low: number[] = [],
): Row => [
  id,
  `Тест магазин ${client}`,
  client,
  "Тестоград",
  at,
  "2026-11",
  `${code} - Тест ${code}`,
  out.length,
  low.length,
  order ? "Да" : "Нет",
  order?.[0] ?? null,
  order ? "Отправлен" : null,
  order?.[1] ?? null,
  ...SKUS.map((_, i) =>
    out.includes(i + 1) ? "Нет в наличии" : low.includes(i + 1) ? "Недостаточно" : "В наличии",
  ),
];
const DELIVERED = "Доставлено — ожидает подтверждения точки";
const CHOSE = "Точка выбрала дату — ожидает агента";
const SILENT = "Точка не ответила";

const checks = () =>
  book([
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
      ...SKUS,
    ],
    // Store 1: two products out, the order is delivered — and Smart Up shows another product only.
    check(601, 900001, "10.11.2026 10:00", TSM1, [1, 2], ["#TEST-1", DELIVERED]),
    // Store 2: no order, yet the product was sold two days later.
    check(602, 900002, "10.11.2026 11:00", TSM1, [1]),
    // Store 3: the store chose a date, the rep has not answered.
    check(603, 900003, "11.11.2026 10:00", TSM2, [1], ["#TEST-3", CHOSE]),
    // Store 4: no order and no sale; on no rep's route and without a rep in the client base.
    check(604, 900004, "11.11.2026 11:00", TSM2, [1, 2]),
    // Store 5: checked on the 14th — its three days end after the sales do (the 15th).
    check(605, 900005, "14.11.2026 10:00", TSM2, [1], ["#TEST-5", SILENT]),
    // Store 6: «Недостаточно» alone starts no chain.
    check(606, 900006, "11.11.2026 12:00", TSM2, [], null, [1]),
  ]);

const order = (no: string, client: number, at: string, code: string, status: string, id: number) =>
  [
    no,
    `Тест магазин ${client}`,
    client,
    "Тестоград",
    at,
    "2026-11",
    "Отправлен",
    status,
    `${code} - Тест ${code}`,
    id,
    1,
    10,
    200000,
    10,
    ...SKUS.slice(1).map(() => null),
  ] as Row;
const orders = () =>
  book([
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
      ...SKUS,
    ],
    order("#TEST-1", 900001, "10.11.2026 10:05", TSM1, DELIVERED, 601),
    order("#TEST-3", 900003, "11.11.2026 10:05", TSM2, CHOSE, 603),
    order("#TEST-5", 900005, "14.11.2026 10:05", TSM2, SILENT, 605),
  ]);

const sale = (client: number, day: string, sku: string, blocks: number): Row => [
  `Тест магазин ${client}`,
  String(client),
  "Тестоград",
  "Retail",
  day,
  sku,
  blocks,
];
// Smart Up's sales of 9–15 Nov.
const sales = () =>
  book([
    [
      "Клиент",
      "ИД клиента",
      "Организация",
      "ХЮ:(TSM;DR) Основной канал / POS channel",
      "Дата доставки",
      "ТМЦ",
      "Количество продажи",
    ],
    sale(900009, "09.11.2026", "SKU-TEST 1", 1),
    sale(900001, "11.11.2026", "SKU-TEST 5", 2),
    // The report writes the name another way.
    sale(900002, "12.11.2026", "sku-test  1", 1),
    sale(900009, "15.11.2026", "SKU-TEST 1", 1),
  ]);

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
const employees = () =>
  book([
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
    pos(900101, "BDM 99", "Тест Руководитель", "KT&G BDM", "BUM TEST"),
    pos(900102, TSM1, "Тест Первый", "Мерчендайзер", "BDM 99"),
    pos(900103, TSM2, "Тест Второй", "Мерчендайзер", "BDM 99"),
    pos(900104, "Supervisor TST", "Тест Супервайзер", "Супервайзер", null),
    pos(900105, DR1, "Тест Агент 1", "Торговый представитель", "Supervisor TST"),
    pos(900106, DR2, "Тест Агент 2", "Торговый представитель", "Supervisor TST"),
  ]);

// The route analysis of 9–14 Nov: a code under each day.
const route = (zone: string, client: number, organization: string, days: (string | null)[]) =>
  [null, organization, zone, zone, client, `Тест магазин ${client}`, null, null, ...days, 0] as Row;
const routes = () =>
  book(
    [
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
        "Пн",
        "Вт",
        "Ср",
        "Чт",
        "Пт",
        "Сб",
        "Количество визитов",
      ],
      [null, null, null, null, null, null, null, "2 неделя", 9, 10, 11, 12, 13, 14, "U"],
      // The first rep's stores: 1, 3 and 5.
      route(DR1, 900001, "Тестоград", [null, "P", null, "PD", null, null]),
      route(DR1, 900003, "Тестобад", [null, null, "P", null, null, null]),
      route(DR1, 900005, "Тестобад", [null, null, null, null, null, "P"]),
      // The TSMs' own routes are not the distributor's.
      route(TSM1, 900001, "Тестоград", [null, "P", null, null, null, null]),
      route(TSM1, 900002, "Тестоград", [null, "P", null, null, null, null]),
      route(TSM2, 900003, "Тестобад", [null, null, "P", null, null, null]),
      route(TSM2, 900004, "Тестобад", [null, null, "P", null, null, null]),
    ],
    new Date("2026-11-14T13:00:00Z"),
  );

// Smart Up's client base: store 2 is on no route, and the base names its rep.
const clients = () =>
  book([
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
      "M",
      null,
      null,
      null,
      null,
      DR2,
      null,
      null,
      "Розница (Retail)",
      TSM1,
      "Тестовый район",
      "Активный",
      null,
    ],
  ]);

async function upload(files: Record<string, () => Promise<Buffer>>) {
  const owner = await withAccess(await createTestUser("OWNER"));
  const list = [];
  for (const [name, make] of Object.entries(files))
    list.push({ name: `${name}.xlsx`, buffer: await make() });
  await importConnectFiles(owner, list);
}
const ALL = { checks, orders, sales, employees, routes, clients };

const report = (query: Record<string, string>, scope: Set<string> | null = null) =>
  buildConnectReport(parseConnectQuery({ ...WEEK, ...query }, true), TODAY, scope);
const pathOf = async (query: Record<string, string>, scope: Set<string> | null = null) =>
  (await report(query, scope)).insights!.oosPath;

describe("Connect analytics: the path of an OOS from the check to the sale", () => {
  beforeEach(resetDb);

  it("follows every check with an OOS through the bot's steps to Smart Up's sales", async () => {
    await upload(ALL);
    const p = await pathOf({ view: "exec" });
    expect(p.sales).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(p.totals).toMatchObject({
      checks: 5,
      stores: 5,
      tsms: 2,
      orders: 3,
      noOrder: 2,
      noOrderRate: 40,
      storeSilent: 1,
      agentWaiting: 1,
      agentAccepted: 0,
      delivered: 1,
      confirmed: 0,
      other: 0,
      closed: 4,
      open: 1,
      soldAll: 1,
      soldSome: 0,
      soldRate: 25,
      noneOther: 1,
      noneNothing: 2,
      deliveredNoSale: 1,
      soldAnyway: 1,
      noZone: 1,
      severalZones: 0,
    });
    expect(p.funnel.map((s) => [s.key, s.count, s.rate, s.stopped])).toEqual([
      ["found", 5, null, 0],
      ["order", 3, 60, 2],
      ["store", 2, 67, 1],
      ["agent", 1, 50, 1],
      ["delivered", 1, 100, 0],
      ["sold", 0, 0, 1],
    ]);
    expect(
      p.cross.map((c) => [c.step, c.checks, c.anySold, c.noneOther, c.noneNothing, c.open]),
    ).toEqual([
      ["noOrder", 2, 1, 0, 1, 0],
      ["storeSilent", 1, 0, 0, 0, 1],
      ["agentWaiting", 1, 0, 0, 1, 0],
      ["delivered", 1, 0, 1, 0, 0],
    ]);
    // Who did not create the order; whose order waits for an answer; whose delivery was not sold.
    expect(p.byTsm.map((x) => [x.code, x.name, x.checks, x.noOrder, x.noOrderRate])).toEqual([
      [TSM1, `Тест ${TSM1}`, 2, 1, 50],
      [TSM2, `Тест ${TSM2}`, 3, 1, 33],
    ]);
    expect(
      p.byDr.map((x) => [
        x.zone,
        x.checks,
        x.orders,
        x.agentWaiting,
        x.delivered,
        x.deliveredNoSale,
      ]),
    ).toEqual([
      [DR1, 3, 3, 1, 1, 1],
      // Store 2 is on no route: the client base names its rep.
      [DR2, 1, 0, 0, 0, 0],
      // Store 4: «DR не определён».
      [null, 1, 0, 0, 0, 0],
    ]);
    expect(p.byRegion.map((x) => [x.region, x.people, x.checks])).toEqual([
      ["Тестоград", 1, 2],
      ["Тестобад", 1, 3],
    ]);
    expect(p.byManager.map((x) => [x.title, x.name, x.people, x.checks])).toEqual([
      ["BDM 99", "Тест Руководитель", 2, 5],
    ]);
    expect(
      p.stores.map((s) => [s.reason, s.storeCode, s.code, s.zones, s.orderNo, s.sold]),
    ).toEqual([
      ["deliveredNoSale", "900001", TSM1, [DR1], "#TEST-1", "noneOther"],
      ["agentWaiting", "900003", TSM2, [DR1], "#TEST-3", "noneNothing"],
      ["noOrderNoSale", "900004", TSM2, [], null, "noneNothing"],
    ]);
    expect(p.stores[0]).toMatchObject({
      store: "Тест магазин 900001",
      day: "2026-11-10",
      step: "delivered",
      out: ["SKU-TEST 1", "SKU-TEST 2"],
    });

    // Managers: the checks of their TSMs; the reps are not theirs to see.
    const mine = await pathOf({ view: "manager" }, new Set([TSM2]));
    expect(mine.totals).toMatchObject({ checks: 3, noOrder: 1, agentWaiting: 1, open: 1 });
    expect(mine.byTsm.map((x) => x.code)).toEqual([TSM2]);
    expect(mine.byDr).toEqual([]);
    // The distributor's supervisor: the checks at the reps' stores — by the route or the client base.
    const reps = await pathOf({ view: "manager" }, new Set([DR1, DR2]));
    expect(reps.totals).toMatchObject({ checks: 4, delivered: 1, deliveredNoSale: 1, noZone: 0 });
    expect(reps.byDr.map((x) => [x.zone, x.checks])).toEqual([
      [DR1, 3],
      [DR2, 1],
    ]);
    expect(reps.byTsm).toEqual([]);

    // An executor: their own chains — a TSM's checks, a rep's stores.
    const tsm = await pathOf({ view: "executor", person: TSM1 });
    expect(tsm.totals).toMatchObject({ checks: 2, noOrder: 1, delivered: 1, soldAnyway: 1 });
    expect(tsm.stores.map((s) => s.storeCode)).toEqual(["900001"]);
    const rep = await pathOf({ view: "executor", person: DR1 });
    expect(rep.totals).toMatchObject({ checks: 3, agentWaiting: 1, deliveredNoSale: 1 });
    expect(rep.stores.map((s) => [s.reason, s.storeCode])).toEqual([
      ["deliveredNoSale", "900001"],
      ["agentWaiting", "900003"],
    ]);
  });

  it("works with what is loaded: no orders file, no sales, no routes", async () => {
    // The checks alone: their own rows say where the orders stand; nothing is known of the sales.
    await upload({ checks });
    const p = await pathOf({ view: "exec" });
    expect(p.sales).toBeNull();
    expect(p.totals).toMatchObject({
      checks: 5,
      orders: 3,
      noOrder: 2,
      storeSilent: 1,
      agentWaiting: 1,
      delivered: 1,
      closed: 0,
      open: 5,
      soldRate: null,
      deliveredNoSale: 0,
      noZone: 5,
    });
    expect(p.byDr.map((x) => [x.zone, x.checks])).toEqual([[null, 5]]);
    expect(p.byManager).toEqual([]);
    // Waiting for the rep is seen without the sales; what was not sold is not.
    expect(p.stores.map((s) => [s.reason, s.orderNo])).toEqual([["agentWaiting", "#TEST-3"]]);
  });

  it("puts the block into the Excel file", async () => {
    await upload(ALL);
    const exec = await report({ view: "exec" });
    const sheetsOf = async (source: typeof exec, lang: "ru" | "ko" = "ru") => {
      const wb = new ExcelJS.Workbook();
      await withExportLocale(lang, async () => {
        await wb.xlsx.load((await connectXlsx(source, TODAY)) as unknown as ArrayBuffer);
      });
      return wb;
    };
    const rows = (wb: ExcelJS.Workbook, name: string) => {
      const out: unknown[][] = [];
      wb.getWorksheet(name)!.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
      return out;
    };
    const ru = await sheetsOf(exec);
    // The block is on the first sheet as on the page; its lists are sheets of their own.
    expect(ru.worksheets.map((ws) => ws.name)).toEqual(
      expect.arrayContaining([
        "Путь OOS — регионы",
        "Путь OOS — ТСМ",
        "Путь OOS — DR",
        "Путь OOS — точки",
      ]),
    );
    const block = readBook(ru).page.block("Путь OOS: от проверки до продажи");
    // Step × sold, with the page's columns: the step, the checks, those with a sale and their
    // share, all sold, not sold (something else sold / nothing sold), the window still open.
    const cross = block.tables()[0]!;
    expect(cross.head).toEqual([
      "Шаг",
      "Проверок с OOS",
      "Продан хотя бы один",
      "Проданы все",
      "Нет, но продали другое",
      "Точке ничего не продали",
      "Окно не закрыто",
    ]);
    expect(cross.rows).toEqual([
      ["Заказ не создан", 2, "1 · 50%", 1, 0, 1, 0],
      ["Точка не ответила", 1, "—", 0, 0, 0, 1],
      ["Точка выбрала дату — ждём DR", 1, "0 · 0%", 0, 0, 1, 0],
      ["Доставлено", 1, "0 · 0%", 0, 1, 0, 0],
    ]);
    // A part sold is not a column of the page: the report has it.
    expect(exec.insights!.oosPath.cross.map((c) => c.some)).toEqual([0, 0, 0, 0]);
    // The total is the page's funnel and the numbers of what was sold.
    expect(block.stat("1. Найден OOS").value).toBe(5);
    expect(block.stat("Продан хотя бы один товар")).toMatchObject({
      value: 25,
      note: "1 из 4 проверок",
    });
    expect(block.stat("Проданы все товары").value).toBe(1);
    expect(block.stat("Ничего не продано")).toMatchObject({
      value: 3,
      note: "точке ничего не продали: 2 · продали другие товары: 1",
    });
    expect(block.stat("Окно не закрыто").value).toBe(1);
    expect(exec.insights!.oosPath.totals.soldSome).toBe(0);
    expect(
      rows(ru, "Путь OOS — регионы")
        .slice(1)
        .map((r) => r.slice(0, 5)),
    ).toEqual([
      ["Регион", "Тестоград", undefined, 1, 2],
      ["Регион", "Тестобад", undefined, 1, 3],
      ["Руководитель", "BDM 99", "Тест Руководитель", 2, 5],
    ]);
    // Checks, orders, no order (and %), then the steps.
    expect(rows(ru, "Путь OOS — ТСМ")[1]!.slice(0, 6)).toEqual([TSM1, `Тест ${TSM1}`, 2, 1, 1, 50]);
    expect(rows(ru, "Путь OOS — DR").map((r) => r.slice(0, 3))).toEqual([
      ["Зона DR (Smart Up)", "Проверок с OOS (Connect-бот)", "Заказов (Connect-бот)"],
      [DR1, 3, 3],
      [DR2, 1, 0],
      ["DR не определён", 1, 0],
    ]);
    expect(rows(ru, "Путь OOS — точки").slice(1)).toEqual([
      [
        "Доставлено, продажи нет",
        "Тест магазин 900001",
        "900001",
        "2026-11-10",
        TSM1,
        `Тест ${TSM1}`,
        DR1,
        2,
        "SKU-TEST 1, SKU-TEST 2",
        "Доставлено",
        "#TEST-1",
        "Не проданы (точке продали другое)",
      ],
      [
        "DR не ответил",
        "Тест магазин 900003",
        "900003",
        "2026-11-11",
        TSM2,
        `Тест ${TSM2}`,
        DR1,
        1,
        "SKU-TEST 1",
        "Точка выбрала дату — ждём DR",
        "#TEST-3",
        "Не проданы (точке ничего не продали)",
      ],
      [
        "Нет заказа и нет продажи",
        "Тест магазин 900004",
        "900004",
        "2026-11-11",
        TSM2,
        `Тест ${TSM2}`,
        "DR не определён",
        2,
        "SKU-TEST 1, SKU-TEST 2",
        "Заказ не создан",
        undefined,
        "Не проданы (точке ничего не продали)",
      ],
    ]);
    const ko = await sheetsOf(exec, "ko");
    expect(ko.worksheets.map((ws) => ws.name)).toEqual(
      expect.arrayContaining(["OOS 경로 — TSM", "OOS 경로 — DR", "OOS 경로 — 매장"]),
    );
    expect(readBook(ko).page.links.map((link) => link.text)).toContain("OOS 경로");
    expect(rows(ko, "OOS 경로 — 매장")[1]![0]).toBe("배송됐으나 판매 없음");

    // One TSM's file: their own numbers and chains, without the tables by employee.
    const own = await sheetsOf(await report({ view: "executor", person: TSM1 }));
    const names = own.worksheets.map((ws) => ws.name);
    expect(names).toEqual(expect.arrayContaining(["Путь OOS — точки"]));
    expect(names).not.toContain("Путь OOS — ТСМ");
    expect(names).not.toContain("Путь OOS — DR");
    const mine = readBook(own).page.block("Путь OOS: от проверки до продажи");
    expect(mine.stat("1. Найден OOS").value).toBe(2);
    expect(mine.stat("Продан хотя бы один товар")).toMatchObject({
      value: 50,
      note: "1 из 2 проверок",
    });
    expect(mine.stat("Проданы все товары").value).toBe(1);
    expect(mine.stat("Ничего не продано")).toMatchObject({
      value: 1,
      note: "точке ничего не продали: 0 · продали другие товары: 1",
    });
    expect(mine.stat("Окно не закрыто").value).toBe(0);
    // One TSM's page has no table of steps, as the page.
    expect(mine.tables().map((table) => table.head[0])).toEqual(["Точка"]);
  });

  it("shows the block on the three levels", async () => {
    await upload(ALL);
    const href = (query: object) => (change: Record<string, string | null>) =>
      connectHref("/connect", query as Parameters<typeof connectHref>[1], change);
    const block = () =>
      within(
        screen
          .getByRole("heading", { name: "Путь OOS: от проверки до продажи" })
          .closest("[data-connect-section]") as HTMLElement,
      );
    const heading = (name: string | RegExp) => block().queryByRole("heading", { name });

    // Leadership: the funnel, the mismatches, the regions, the managers, the TSMs and the reps.
    const exec = await report({ view: "exec" });
    const top = render(
      <ExecView
        data={exec.exec!}
        months="ноябрь 2026"
        insights={exec.insights}
        href={href(exec.query)}
      />,
    );
    expect(block().getByText("Без заказа: 2")).toBeInTheDocument();
    expect(block().getByText("DR не ответил: 1")).toBeInTheDocument();
    expect(block().getByText("Доставлено без продажи: 1")).toHaveClass("text-red-600");
    expect(
      block().getByText(
        "В боте «Доставлено», а в Smart Up нет продажи этих товаров: 1 из 1 доставок.",
      ),
    ).toBeInTheDocument();
    expect(block().getByText(/товар всё равно продан: 1\./)).toBeInTheDocument();
    expect(block().getByText("Данные продаж по 15 нояб.")).toBeInTheDocument();
    expect(heading("На каком шаге остановились и что продано")).toBeInTheDocument();
    expect(heading("Путь OOS по регионам")).toBeInTheDocument();
    expect(heading("Путь OOS по руководителям")).toBeInTheDocument();
    expect(heading("Путь OOS по ТСМ")).toBeInTheDocument();
    expect(heading("Путь OOS по зонам DR")).toBeInTheDocument();
    expect(block().getAllByText("DR не определён").length).toBeGreaterThan(0);
    // The list of chains is the managers' and the executors'; leadership has it in the file.
    expect(heading(/Что проверить/)).not.toBeInTheDocument();
    expect(block().queryByRole("link")).not.toBeInTheDocument();
    // Both sources are named on the block.
    expect(block().getAllByText("Connect-бот").length).toBeGreaterThan(1);
    expect(block().getAllByText("Smart Up").length).toBeGreaterThan(1);
    top.unmount();

    // Managers: their TSMs and reps open the person's page; the chains to act on.
    const manager = await report({ view: "manager" });
    const middle = render(
      <ManagerView
        data={manager.manager!}
        months="ноябрь 2026"
        sales
        personHref={(person) => `/connect?view=executor&person=${person}`}
        insights={manager.insights}
        href={href(manager.query)}
      />,
    );
    expect(heading("Путь OOS по регионам")).not.toBeInTheDocument();
    expect(heading("Путь OOS по ТСМ")).toBeInTheDocument();
    expect(block().getAllByRole("link", { name: /TSM_TST_1/ })[0]).toHaveAttribute(
      "href",
      "/connect?view=executor&person=TSM_TST_1",
    );
    expect(block().getAllByRole("link", { name: DR1 })[0]).toHaveAttribute(
      "href",
      "/connect?view=executor&person=DR_TST_1",
    );
    expect(heading("Что проверить · 3")).toBeInTheDocument();
    expect(block().getAllByText("Доставлено, продажи нет")[0]).toHaveClass("bg-red-500/20");
    expect(block().getAllByText("Нет заказа и нет продажи").length).toBeGreaterThan(0);
    middle.unmount();

    // A TSM: their own funnel and chains, without the tables by employee.
    const one = await report({ view: "executor", person: TSM1 });
    const own = render(
      <ExecutorView
        data={one.executor!}
        months="ноябрь 2026"
        insights={one.insights}
        href={href(one.query)}
      />,
    );
    expect(block().getByText("Без заказа: 1")).toBeInTheDocument();
    expect(heading("Что проверить · 1")).toBeInTheDocument();
    expect(heading("Путь OOS по ТСМ")).not.toBeInTheDocument();
    expect(heading("На каком шаге остановились и что продано")).not.toBeInTheDocument();
    own.unmount();

    // A rep has no Connect records of their own: the route, and what became of the checks at
    // their stores.
    const rep = await report({ view: "executor", person: DR1 });
    render(
      <ExecutorView
        data={rep.executor!}
        months="ноябрь 2026"
        insights={rep.insights}
        href={href(rep.query)}
      />,
    );
    expect(block().getByText("DR не ответил: 1")).toBeInTheDocument();
    expect(heading("Что проверить · 2")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Market Visit" })).not.toBeInTheDocument();
  });

  it("marks in the Excel file what the page marks: a delivery without a sale, a silent rep", async () => {
    await upload(ALL);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await connectXlsx(await report({ view: "exec" }), TODAY)) as unknown as ArrayBuffer,
    );
    const RED = "FFFED5D7";
    const AMBER = "FFFFEEBF";
    const row = (sheet: string, first: string) => {
      let found: ExcelJS.Row | undefined;
      wb.getWorksheet(sheet)!.eachRow((r) => {
        if (!found && r.getCell(1).text === first) found = r;
      });
      return found!;
    };

    // Every list of the block compares the two sources: its tab is neither's colour. On the
    // first sheet the block has both tags under its title, and the line under a column's header
    // of its tables says whose the column is — the page's legend, in the header itself.
    expect(wb.getWorksheet("Путь OOS — точки")!.properties.tabColor?.argb).toBe("FF62748E");
    const page = readBook(wb).page;
    const block = page.block("Путь OOS: от проверки до продажи");
    expect(page.ws.autoFilter).toBeUndefined();
    const cross = block.tables()[0]!;
    expect(cross.headCells[0]!.border?.bottom).toMatchObject({
      style: "medium",
      color: { argb: "FF00A6F4" },
    });
    expect(cross.headCells[2]!.border?.bottom?.color?.argb).toBe("FF8E51FF");

    // Step × sold. Delivered in the bot and not sold in Smart Up is red; a sale without an
    // order is amber (the number with its share).
    const delivered = cross.row("Доставлено");
    expect([delivered[4]!.value, fillOf(delivered[4]!)]).toEqual([1, RED]);
    expect(fillOf(delivered[5]!)).toBeUndefined();
    const noOrder = cross.row("Заказ не создан");
    expect([noOrder[2]!.value, fillOf(noOrder[2]!)]).toEqual(["1 · 50%", AMBER]);
    // The same number not sold after an order nobody answered is not a mismatch.
    expect(fillOf(cross.row("Точка выбрала дату — ждём DR")[5]!)).toBeUndefined();
    // The two mismatches as the page says them: a line each on its tinted ground, and the
    // funnel's last step in red.
    const said = (start: string) =>
      block.cells.flat().find((cell) => String(cell.value).startsWith(start))!;
    const mismatch = said("В боте «Доставлено», а в Smart Up нет продажи этих товаров: 1 из 1");
    expect([fillOf(mismatch), mismatch.border?.left?.color?.argb]).toEqual([
      "FFFFEAEB",
      "FFFB2C36",
    ]);
    const anyway = said("Заказа нет или точка не ответила, а товар всё равно продан: 1.");
    expect([fillOf(anyway), anyway.border?.left?.color?.argb]).toEqual(["FFFFF7E0", "FFFFB900"]);
    expect(said("Доставлено без продажи: 1").font?.color?.argb).toBe("FFE7000B");
    expect(said("Без заказа: 2").font?.color?.argb).toBe("FFBB4D00");

    // The same on the first sheet's tables by TSM and by rep, as on the page: a delivery
    // without a sale red (the row marked on its left edge), a rep's unanswered orders amber.
    const byRep = page.sub("Путь OOS по зонам DR").tables()[0]!;
    const waitingAt = byRep.head.indexOf("DR не ответил");
    const noSaleAt = byRep.head.indexOf("Доставлено без продажи");
    expect([byRep.row(DR1)[waitingAt]!.value, fillOf(byRep.row(DR1)[waitingAt]!)]).toEqual([
      1,
      AMBER,
    ]);
    expect([byRep.row(DR1)[noSaleAt]!.value, fillOf(byRep.row(DR1)[noSaleAt]!)]).toEqual([1, RED]);
    expect(byRep.row(DR1)[0]!.border?.left).toMatchObject({
      style: "thick",
      color: { argb: "FFFB2C36" },
    });
    expect(byRep.row(DR2)[0]!.border?.left).toBeUndefined();
    const byTsm = page.sub("Путь OOS по ТСМ").tables()[0]!;
    expect(fillOf(byTsm.row(TSM2)[byTsm.head.indexOf("DR не ответил")]!)).toBeUndefined();
    expect(byTsm.row(TSM1)[0]!.border?.left?.color?.argb).toBe("FFFB2C36");

    // The chains to act on, each in the colour of its reason (the row is marked too).
    const chain = (reason: string) => {
      const r = row("Путь OOS — точки", reason);
      return [fillOf(r.getCell(1)), r.getCell(1).border?.left?.style];
    };
    expect(chain("Доставлено, продажи нет")).toEqual([RED, "medium"]);
    expect(chain("DR не ответил")).toEqual([AMBER, "medium"]);
    expect(chain("Нет заказа и нет продажи")).toEqual([undefined, undefined]);

    // A rep's zone: the orders they have not answered amber, a delivery without a sale red.
    const reps = wb.getWorksheet("Путь OOS — DR")!;
    const header = (reps.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    const waiting = header.indexOf("DR не ответил (Connect-бот)") + 1;
    const noSale = header.indexOf("Доставлено без продажи") + 1;
    const rep = row("Путь OOS — DR", DR1);
    expect([rep.getCell(waiting).value, fillOf(rep.getCell(waiting))]).toEqual([1, AMBER]);
    expect([rep.getCell(noSale).value, fillOf(rep.getCell(noSale))]).toEqual([1, RED]);
    expect(fillOf(rep.getCell(1))).toBe(RED);
    expect(fillOf(row("Путь OOS — DR", DR2).getCell(1))).toBeUndefined();
    // A TSM's row is not marked for a rep's silence (as on the page), only for the mismatch.
    const tsms = wb.getWorksheet("Путь OOS — ТСМ")!;
    const tsmHeader = (tsms.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    const second = row("Путь OOS — ТСМ", TSM2);
    const tsmWaiting = tsmHeader.indexOf("DR не ответил (Connect-бот)") + 1;
    expect([second.getCell(tsmWaiting).value, fillOf(second.getCell(tsmWaiting))]).toEqual([
      1,
      undefined,
    ]);
    expect(fillOf(row("Путь OOS — ТСМ", TSM1).getCell(1))).toBe(RED);
  });
});
