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
    expect(ru.worksheets.map((ws) => ws.name)).toEqual(
      expect.arrayContaining([
        "Путь OOS",
        "Путь OOS — регионы",
        "Путь OOS — ТСМ",
        "Путь OOS — DR",
        "Путь OOS — точки",
      ]),
    );
    // Every column says whose data it is.
    expect(rows(ru, "Путь OOS")[0]!.slice(0, 4)).toEqual([
      "Шаг (Connect-бот)",
      "Проверок с OOS (Connect-бот)",
      "Продан хотя бы один (Smart Up)",
      "Продано за 3 дня (Smart Up)",
    ]);
    expect(rows(ru, "Путь OOS").slice(1, 6)).toEqual([
      ["Заказ не создан", 2, 1, 50, 1, 0, 0, 1, 0],
      ["Точка не ответила", 1, 0, undefined, 0, 0, 0, 0, 1],
      ["Точка выбрала дату — ждём DR", 1, 0, 0, 0, 0, 0, 1, 0],
      ["Доставлено", 1, 0, 0, 0, 0, 1, 0, 0],
      ["Всего", 5, 1, 25, 1, 0, 1, 2, 1],
    ]);
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
      expect.arrayContaining(["OOS 경로", "OOS 경로 — TSM", "OOS 경로 — DR", "OOS 경로 — 매장"]),
    );
    expect(rows(ko, "OOS 경로 — 매장")[1]![0]).toBe("배송됐으나 판매 없음");

    // One TSM's file: their own numbers and chains, without the tables by employee.
    const own = await sheetsOf(await report({ view: "executor", person: TSM1 }));
    const names = own.worksheets.map((ws) => ws.name);
    expect(names).toEqual(expect.arrayContaining(["Путь OOS", "Путь OOS — точки"]));
    expect(names).not.toContain("Путь OOS — ТСМ");
    expect(names).not.toContain("Путь OOS — DR");
    expect(rows(own, "Путь OOS").find((r) => r[0] === "Всего")).toEqual([
      "Всего",
      2,
      1,
      50,
      1,
      0,
      1,
      0,
      0,
    ]);
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
    const fillOf = (cell: ExcelJS.Cell) =>
      cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined;
    const row = (sheet: string, first: string) => {
      let found: ExcelJS.Row | undefined;
      wb.getWorksheet(sheet)!.eachRow((r) => {
        if (!found && r.getCell(1).text === first) found = r;
      });
      return found!;
    };

    // Every sheet of the block compares the two sources: its tab is neither's colour, and the
    // line under a column's header says whose the column is.
    const summary = wb.getWorksheet("Путь OOS")!;
    expect(summary.properties.tabColor?.argb).toBe("FF62748E");
    expect(wb.getWorksheet("Путь OOS — точки")!.properties.tabColor?.argb).toBe("FF62748E");
    expect(summary.getRow(1).getCell(1).border?.bottom?.color?.argb).toBe("FF00A6F4");
    expect(summary.getRow(1).getCell(3).border?.bottom?.color?.argb).toBe("FF8E51FF");
    // The table of steps is filtered; the funnel and the mismatches under it are not in it.
    expect(summary.autoFilter).toBe("A1:I6");

    // Step × sold. Delivered in the bot and not sold in Smart Up is red; a sale without an
    // order is amber (the number and its share).
    const delivered = row("Путь OOS", "Доставлено");
    expect([delivered.getCell(7).value, fillOf(delivered.getCell(7))]).toEqual([1, RED]);
    expect(fillOf(delivered.getCell(8))).toBeUndefined();
    const noOrder = row("Путь OOS", "Заказ не создан");
    expect([fillOf(noOrder.getCell(3)), fillOf(noOrder.getCell(4))]).toEqual([AMBER, AMBER]);
    expect(noOrder.getCell(4).numFmt).toBe('0.0"%"');
    // The same number not sold after an order nobody answered is not a mismatch.
    expect(fillOf(row("Путь OOS", "Точка выбрала дату — ждём DR").getCell(8))).toBeUndefined();
    expect(row("Путь OOS", "Всего").getCell(1).font).toMatchObject({ bold: true });
    // The two mismatches as numbers of their own.
    const mismatch = row("Путь OOS", "Доставлено без продажи");
    expect([mismatch.getCell(2).value, fillOf(mismatch.getCell(2))]).toEqual([1, RED]);
    expect(fillOf(row("Путь OOS", "Продано без заказа или ответа").getCell(2))).toBe(AMBER);

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
