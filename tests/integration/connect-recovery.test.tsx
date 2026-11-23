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

// «Восстановление наличия», «Заказ дистрибьютора после OOS», «Требует внимания» and the tiles'
// change, through uploads and the report. Synthetic data only: TSM_TST_* / DR_TST_* codes,
// «Тест …» people, stores 9000xx, SKU-TEST n products.

type Row = (string | number | null)[];
const TODAY = "2026-11-16";
const WEEK = { from: "2026-11-09", to: "2026-11-15" };
const TSM1 = "TSM_TST_1";
const TSM2 = "TSM_TST_2";
const DR1 = "DR_TST_1";
const SKUS = Array.from({ length: 12 }, (_, i) => `SKU-TEST ${i + 1}`);

const book = async (rows: Row[], created?: Date) => {
  const wb = new ExcelJS.Workbook();
  if (created) wb.created = created;
  const ws = wb.addWorksheet("Тест");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

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
let nextCheck = 600;
// `out`: the numbers of the products that are out (SKU-TEST n); the others are in stock.
const check = (client: number, at: string, code: string, out: number[]): Row => [
  nextCheck++,
  `Тест магазин ${client}`,
  client,
  "Тестоград",
  at,
  "2026-11",
  `${code} - Тест ${code}`,
  out.length,
  0,
  "Нет",
  null,
  null,
  null,
  ...SKUS.map((_, i) => (out.includes(i + 1) ? "Нет в наличии" : "В наличии")),
];
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const checks = () =>
  book([
    OOS_HEADERS,
    // Store 1 (TSM 1): eleven products out, a week later ten of them still are and one more is.
    check(900001, "03.11.2026 10:00", TSM1, upTo(11)),
    check(900001, "10.11.2026 10:00", TSM1, [...upTo(10), 12]),
    // Store 2 (TSM 2): one out, then two, then everything is back.
    check(900002, "02.11.2026 10:00", TSM2, [1]),
    check(900002, "06.11.2026 10:00", TSM2, [1, 2]),
    check(900002, "11.11.2026 10:00", TSM2, []),
    // Stores 3 and 4 (TSM 2): one check each.
    check(900003, "09.11.2026 10:00", TSM2, [1]),
    check(900004, "12.11.2026 10:00", TSM2, [1]),
  ]);

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
const pos = (id: number, title: string, user: string, roles: string, boss: string): Row => [
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
    EMP_HEADERS,
    pos(900101, "BDM 99", "Тест Руководитель", "KT&G BDM", "BUM TEST"),
    pos(900102, TSM1, "Тест Первый", "Мерчендайзер", "BDM 99"),
    pos(900103, TSM2, "Тест Второй", "Мерчендайзер", "BDM 99"),
  ]);

// The route analysis of 9–14 Nov: a code under each day.
const route = (n: number, zone: string, client: number, days: (string | null)[]): Row => [
  n,
  "Тестоград",
  zone,
  zone,
  client,
  `Тест магазин ${client}`,
  null,
  null,
  ...days,
  0,
];
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
      // Store 1: the rep took an order two days after the check of 10 Nov.
      route(1, DR1, 900001, [null, "P", null, "PD", null, null]),
      // Store 3: visits without an order after the check of 9 Nov.
      route(2, DR1, 900003, ["P", null, "U", null, null, null]),
      // Store 4: checked on 12 Nov — its three days end after the routes do (14 Nov).
      route(3, DR1, 900004, [null, null, null, "P", null, null]),
      // The TSM's own route is not the distributor's.
      route(4, TSM1, 900001, [null, "P", null, null, null, null]),
    ],
    new Date("2026-11-14T13:00:00Z"),
  );

const report = (query: Record<string, string>, scope: Set<string> | null = null) =>
  buildConnectReport(parseConnectQuery({ ...WEEK, ...query }, true), TODAY, scope);

describe("Connect analytics: stock recovery, the distributor's orders, who needs attention", () => {
  beforeEach(resetDb);

  it("counts the recovery on every level, with both baselines", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [
      { name: "checks.xlsx", buffer: await checks() },
      { name: "employees.xlsx", buffer: await employees() },
    ]);

    // Leadership, against the check before: store 1 (1 of 11 back), store 2 (2 of 2 back).
    const exec = await report({ view: "exec" });
    expect(exec.insights).toMatchObject({ base: "prev", followUp: null });
    const r = exec.insights!.recovery;
    expect(r.totals).toEqual({
      stores: 2,
      restored: 3,
      stillOut: 10,
      newlyOut: 1,
      worse: 0,
      wasOut: 13,
      rate: 23,
    });
    expect(r.byTsm.map((t) => [t.code, t.name, t.stores, t.rate, t.stillOut])).toEqual([
      [TSM1, "Тест TSM_TST_1", 1, 9, 10],
      [TSM2, "Тест TSM_TST_2", 1, 100, 0],
    ]);
    expect(r.bySku).toHaveLength(11);
    expect(r.bySku[0]).toMatchObject({ rate: 0, wasOut: 1 });
    expect(r.bySku.find((s) => s.sku === "SKU-TEST 1")).toMatchObject({
      wasOut: 2,
      restored: 1,
      rate: 50,
    });
    expect(r.stores).toMatchObject([
      {
        storeCode: "900001",
        code: TSM1,
        baseDay: "2026-11-03",
        lastDay: "2026-11-10",
        days: 7,
        restored: ["SKU-TEST 11"],
        newlyOut: ["SKU-TEST 12"],
      },
    ]);
    expect(r.stores[0]!.stillOut).toHaveLength(10);
    // What the existing section counts stays the period's own checks.
    expect(exec.exec!.sections.oos).toMatchObject({ checked: 4, withGap: 3, gapRate: 75 });

    // Against the first check of the month: store 2 is compared with 2 Nov (one product out).
    const month = await report({ view: "exec", base: "month" });
    expect(month.query.base).toBe("month");
    expect(month.insights).toMatchObject({
      base: "month",
      recovery: { baseline: "month", totals: { stores: 2, restored: 2, stillOut: 10, rate: 17 } },
    });
    expect(connectHref("/connect", month.query)).toContain("base=month");
    expect(connectHref("/connect", month.query, { base: null })).not.toContain("base=");
    expect(connectHref("/connect", exec.query)).not.toContain("base=");

    // The tiles against 2–8 Nov: then 3 of 3 checks found an OOS and nothing of store 2 was back.
    expect(exec.insights!.trend).toEqual({
      previous: { from: "2026-11-02", to: "2026-11-08" },
      changes: {
        planDone: null,
        connectUsed: null,
        mvFull: null,
        oosStores: { delta: -25, was: 100 },
        recovery: { delta: 23, was: 0 },
      },
    });
    // No data before: nothing to compare with.
    const first = await buildConnectReport(
      parseConnectQuery({ view: "exec", from: "2026-11-02", to: "2026-11-08" }, true),
      TODAY,
    );
    expect(Object.values(first.insights!.trend!.changes)).toEqual([null, null, null, null, null]);

    // Managers: only the TSMs in their scope.
    const manager = await report({ view: "manager" }, new Set([TSM2]));
    expect(manager.insights!.recovery.totals).toMatchObject({ stores: 1, restored: 2, rate: 100 });
    expect(manager.insights!.recovery.byTsm.map((t) => t.code)).toEqual([TSM2]);
    expect(manager.insights).toMatchObject({ attention: [], trend: null });

    // An executor: their own share and stores, nothing else.
    const one = await report({ view: "executor", person: TSM1 });
    expect(one.insights).toMatchObject({
      recovery: { totals: { stores: 1, restored: 1, stillOut: 10, rate: 9 } },
      followUp: null,
      attention: null,
      trend: null,
    });
    expect(one.insights!.recovery.stores.map((s) => s.storeCode)).toEqual(["900001"]);
    // Everyone's cards, no TSM chosen: the blocks are not there.
    expect((await report({ view: "executor" })).insights).toBeNull();
    // A period without data.
    expect((await report({ view: "exec", from: "2026-12-07", to: "2026-12-13" })).insights).toBe(
      null,
    );
  });

  it("checks the distributor's orders against the routes and names who needs attention", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [
      { name: "checks.xlsx", buffer: await checks() },
      { name: "employees.xlsx", buffer: await employees() },
      { name: "route.xlsx", buffer: await routes() },
    ]);

    const exec = await report({ view: "exec" });
    // Store 1 followed up, store 3 not; store 4's three days are not over; store 2 had no OOS.
    expect(exec.insights!.followUp).toEqual({
      days: 3,
      routesTo: "2026-11-14",
      totals: { checks: 2, followed: 1, rate: 50, open: 1 },
      byDr: [{ zone: DR1, checks: 2, followed: 1, rate: 50 }],
      byTsm: [
        { code: TSM2, name: "Тест TSM_TST_2", checks: 1, followed: 0, rate: 0 },
        { code: TSM1, name: "Тест TSM_TST_1", checks: 1, followed: 1, rate: 100 },
      ],
    });
    // TSM 1: one of eleven products back. Too few checks to judge the follow-up by.
    expect(exec.insights!.attention).toEqual([
      {
        code: TSM1,
        name: "Тест TSM_TST_1",
        manager: { name: "Тест Руководитель", title: "BDM 99" },
        reasons: [{ kind: "recovery", value: 9, of: 11, severity: expect.any(Number) }],
        score: expect.any(Number),
        canOpen: true,
      },
    ]);

    // A manager on the leadership level sees everyone, but opens only their own TSMs.
    const limited = await report({ view: "exec" }, new Set([TSM2]));
    expect(limited.insights!.attention).toMatchObject([{ code: TSM1, canOpen: false }]);
    // On their own level: their TSM's checks, no rows of the reps.
    const manager = await report({ view: "manager" }, new Set([TSM2]));
    expect(manager.insights!.followUp).toMatchObject({
      totals: { checks: 1, followed: 0, rate: 0, open: 1 },
      byDr: [],
      byTsm: [{ code: TSM2 }],
    });
    expect(manager.insights!.attention).toEqual([]);
    // Someone who sees the rep's zone: the checks at its stores.
    const supervisor = await report({ view: "manager" }, new Set([DR1]));
    expect(supervisor.insights!.followUp).toMatchObject({
      totals: { checks: 2, followed: 1 },
      byDr: [{ zone: DR1, checks: 2 }],
      byTsm: [],
    });

    // The Excel file: the blocks in full, in the file's language.
    const sheetsOf = async (lang: "ru" | "ko") => {
      const wb = new ExcelJS.Workbook();
      await withExportLocale(lang, async () => {
        await wb.xlsx.load((await connectXlsx(exec, TODAY)) as unknown as ArrayBuffer);
      });
      return wb;
    };
    const ru = await sheetsOf("ru");
    const names = ru.worksheets.map((ws) => ws.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Восстановление OOS",
        "Восстановление — ТСМ",
        "Восстановление — товары",
        "Восстановление — точки",
        "Заказ DR после OOS",
        "Требует внимания",
      ]),
    );
    const rows = (wb: ExcelJS.Workbook, name: string) => {
      const out: unknown[][] = [];
      wb.getWorksheet(name)!.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
      return out;
    };
    expect(rows(ru, "Восстановление OOS").slice(1, 4)).toEqual([
      ["С чем сравнивать", "К предыдущей проверке"],
      ["Точек сравнили", 2],
      ["Восстановлено, %", 23],
    ]);
    expect(rows(ru, "Восстановление — ТСМ")[1]).toEqual([
      TSM1,
      "Тест TSM_TST_1",
      1,
      11,
      1,
      9,
      10,
      1,
      0,
    ]);
    expect(rows(ru, "Восстановление — точки")[1]!.slice(0, 7)).toEqual([
      "Тест магазин 900001",
      "900001",
      TSM1,
      "2026-11-03",
      "2026-11-10",
      7,
      10,
    ]);
    expect(rows(ru, "Заказ DR после OOS").slice(1)).toEqual([
      ["DR", DR1, undefined, 2, 1, 50],
      ["ТСМ", TSM2, "Тест TSM_TST_2", 1, 0, 0],
      ["ТСМ", TSM1, "Тест TSM_TST_1", 1, 1, 100],
    ]);
    expect(rows(ru, "Требует внимания")[1]).toEqual([
      TSM1,
      "Тест TSM_TST_1",
      "Тест Руководитель",
      "BDM 99",
      1,
      "восстановлено 9% OOS (из 11 товаров)",
    ]);
    const ko = await sheetsOf("ko");
    expect(ko.worksheets.map((ws) => ws.name)).toEqual(
      expect.arrayContaining(["OOS 회복", "회복 — 매장", "OOS 후 DR 주문", "주의 필요"]),
    );
    expect(rows(ko, "주의 필요")[1]![5]).toBe("OOS 9% 회복 (제품 11개 중)");

    // One TSM's file: their own stores, without the tables by employee.
    const one = await report({ view: "executor", person: TSM1 });
    const own = new ExcelJS.Workbook();
    await own.xlsx.load((await connectXlsx(one, TODAY)) as unknown as ArrayBuffer);
    const ownNames = own.worksheets.map((ws) => ws.name);
    expect(ownNames).toEqual(
      expect.arrayContaining(["Восстановление OOS", "Восстановление — точки"]),
    );
    expect(ownNames).not.toContain("Восстановление — ТСМ");
    expect(ownNames).not.toContain("Требует внимания");
  });

  it("shows the blocks on the three levels", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importConnectFiles(owner, [
      { name: "checks.xlsx", buffer: await checks() },
      { name: "employees.xlsx", buffer: await employees() },
      { name: "route.xlsx", buffer: await routes() },
    ]);
    const href = (query: object) => (change: Record<string, string | null>) =>
      connectHref("/connect", query as Parameters<typeof connectHref>[1], change);
    const heading = (name: string | RegExp) => screen.queryByRole("heading", { name });

    // Leadership: the tiles with the change, who needs attention, the two blocks in the section.
    const exec = await report({ view: "exec" });
    const top = render(
      <ExecView
        data={exec.exec!}
        months="ноябрь 2026"
        insights={exec.insights}
        href={href(exec.query)}
      />,
    );
    // The tile, and the list of the lowest in «Худшие результаты».
    expect(screen.getAllByText("Восстановление OOS")).toHaveLength(2);
    expect(screen.getByText("3 из 13 товаров вернулись")).toBeInTheDocument();
    expect(heading("Худшие результаты")).toBeInTheDocument();
    const worst = screen
      .getByRole("heading", { name: "Восстановление OOS" })
      .closest("div")!.parentElement!;
    // TSM_TST_1 restored 1 of 11 products: under the line of 15%, so the card is red.
    expect(within(worst).getByText("9%")).toHaveClass("bg-red-500/20");
    expect(within(worst).getByText("1 из 11")).toBeInTheDocument();
    expect(within(worst).getByText("норма: не ниже 15%")).toBeInTheDocument();
    expect(worst).toHaveClass("border-red-400");
    // Stores with an OOS: 100% → 75%, and fewer is better; recovery: 0% → 23%.
    expect(screen.getByText("▼ 25 п.п.")).toHaveClass("text-emerald-700");
    expect(screen.getByText("▲ 23 п.п.")).toHaveClass("text-emerald-700");
    expect(
      screen.getByText(/изменение к предыдущему периоду \(2 нояб\. – 8 нояб\.\)/),
    ).toBeVisible();
    expect(screen.getByText("Требует внимания · 1")).toBeInTheDocument();
    expect(screen.getAllByText("восстановлено 9% OOS (из 11 товаров)").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /TSM_TST_1/ })[0]!.getAttribute("href")).toContain(
      "view=executor&from=2026-11-09&to=2026-11-15&person=TSM_TST_1",
    );
    expect(heading("Восстановление наличия")).toBeInTheDocument();
    expect(heading("Заказ дистрибьютора после OOS (3 дня)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К началу месяца" }).getAttribute("href")).toContain(
      "base=month#recovery",
    );
    top.unmount();

    // Managers: the same for the TSMs they see; nobody of theirs is below the lines.
    const manager = await report({ view: "manager" }, new Set([TSM2]));
    const middle = render(
      <ManagerView
        data={manager.manager!}
        months="ноябрь 2026"
        sales={false}
        personHref={(person) => `/connect?person=${person}`}
        insights={manager.insights}
        href={href(manager.query)}
      />,
    );
    expect(screen.getByText("Все показатели в норме.")).toBeInTheDocument();
    expect(heading("Восстановление наличия")).toBeInTheDocument();
    expect(heading("По зонам DR")).not.toBeInTheDocument();
    expect(heading("По ТСМ")).toBeInTheDocument();
    middle.unmount();

    // An executor: their own share and stores; the distributor's orders are not theirs to chase.
    const one = await report({ view: "executor", person: TSM1 });
    render(
      <ExecutorView
        data={one.executor!}
        months="ноябрь 2026"
        insights={one.insights}
        href={href(one.query)}
      />,
    );
    expect(heading("Восстановление наличия")).toBeInTheDocument();
    expect(screen.getByText("1 из 11 товаров")).toBeInTheDocument();
    expect(heading(/Точки, где товара всё ещё нет/)).toBeInTheDocument();
    expect(heading("По сотрудникам")).not.toBeInTheDocument();
    expect(heading("Заказ дистрибьютора после OOS (3 дня)")).not.toBeInTheDocument();
    expect(screen.queryByText(/Требует внимания/)).not.toBeInTheDocument();
  });
});
