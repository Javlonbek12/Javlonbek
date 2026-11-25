import { describe, expect, it } from "vitest";

import { buildHierarchy } from "./hierarchy";
import {
  chainSold,
  indexPathSales,
  oosPath,
  orderStep,
  outOf,
  pathChains,
  repRoutes,
} from "./oos-path";
import type {
  OosRecord,
  OosStatus,
  OrderRecord,
  PositionRecord,
  RouteRecord,
  SaleDayRecord,
  SaleRecord,
} from "./parse";

// Synthetic data only: TSM_TST_* / DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST n.

const TSM1 = "TSM_TST_1 - Тест Первый";
const TSM2 = "TSM_TST_2 - Тест Второй";
const DR1 = "DR_TST_1";
const DR2 = "DR_TST_2";
const [A, B, C] = [1, 2, 3].map((n) => `SKU-TEST ${n}`) as [string, string, string];

const SILENT = "Точка не ответила";
const WAITING = "Ожидает ответа точки";
const CHOSE = "Точка выбрала дату — ожидает агента";
const ACCEPTED = "Агент принял — готовит доставку";
const DELIVERED = "Доставлено — ожидает подтверждения точки";
const CONFIRMED = "Доставлено и подтверждено точкой";

let nextId = 1;
const check = (
  store: number,
  day: string,
  skus: Record<string, OosStatus>,
  person = TSM1,
  more: Partial<OosRecord> = {},
): OosRecord => ({
  id: String(nextId++),
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at: `${day}T10:00`,
  day,
  month: day.slice(0, 7),
  person,
  missing: Object.values(skus).filter((s) => s === "OUT").length,
  low: Object.values(skus).filter((s) => s === "LOW").length,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus,
  ...more,
});
const out = (...skus: string[]) => Object.fromEntries(skus.map((s) => [s, "OUT" as const]));

// An order made from a check.
const order = (source: OosRecord, status: string | null, more: Partial<OrderRecord> = {}) =>
  ({
    id: `#TEST-${source.id}`,
    storeCode: source.storeCode,
    storeName: source.storeName,
    city: source.city,
    channel: null,
    at: `${source.day}T10:05`,
    day: source.day,
    month: source.month,
    person: source.person,
    status,
    express: false,
    payment: null,
    sourceCheck: source.id,
    storeAnswer: null,
    storeAnswerAt: null,
    agent: null,
    agentAnswer: null,
    deliveredAt: null,
    outcome: null,
    daysToDeliver: null,
    positions: 1,
    adjusted: false,
    packs: 10,
    sum: 100000,
    skus: {},
    ...more,
  }) satisfies OrderRecord;

const route = (zone: string, store: number, month = "2026-11"): RouteRecord => ({
  id: `${month}|${zone}|${store}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at: "",
  day: `${month}-14`,
  month,
  person: zone,
  staff: zone,
  days: { "10": "P" },
});

// A store's delivery day with what was sold on it.
const sale = (store: number, day: string, skus: Record<string, number>): SaleDayRecord => ({
  id: `${store}|${day}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: null,
  channel: null,
  at: `${day}T00:00`,
  day,
  month: day.slice(0, 7),
  person: null,
  skus,
});
const RANGE = { from: "2026-09-01", to: "2026-11-20" };

const chainsOf = (
  oos: OosRecord[],
  orders: OrderRecord[] = [],
  routes: RouteRecord[] = [],
  more: Partial<Parameters<typeof pathChains>[0]> = {},
) => pathChains({ oos, orders, reps: repRoutes(routes), ...more });

describe("orderStep", () => {
  it("reads the step from the status of the Russian export", () => {
    const step = (status: string | null) => orderStep({ status }).step;
    expect(step(WAITING)).toBe("storeWaiting");
    expect(step(SILENT)).toBe("storeSilent");
    expect(step("Точка отказалась от заказа")).toBe("storeRefused");
    expect(step(CHOSE)).toBe("agentWaiting");
    // The store answered; the courier has not.
    expect(step("Ожидает экспресс-доставщика")).toBe("agentWaiting");
    expect(step(ACCEPTED)).toBe("agentAccepted");
    expect(orderStep({ status: DELIVERED })).toEqual({ step: "delivered", confirmed: false });
    expect(orderStep({ status: CONFIRMED })).toEqual({ step: "delivered", confirmed: true });
    // «Статус заказа» of an export without a delivery status only says the order was sent.
    expect(step("Отправлен")).toBe("storeWaiting");
  });

  it("reads the English texts and keeps an unknown status apart", () => {
    const step = (status: string | null) => orderStep({ status }).step;
    expect(step("Store did not respond")).toBe("storeSilent");
    expect(step("Store chose a date — waiting for the agent")).toBe("agentWaiting");
    expect(step("Waiting for an express courier")).toBe("agentWaiting");
    expect(step("Agent accepted — preparing delivery")).toBe("agentAccepted");
    expect(step("Store refused the order")).toBe("storeRefused");
    expect(step("Sent")).toBe("storeWaiting");
    expect(orderStep({ status: "Delivered and confirmed by the store" })).toEqual({
      step: "delivered",
      confirmed: true,
    });
    expect(orderStep({ status: "Delivered — awaiting store confirmation" })).toEqual({
      step: "delivered",
      confirmed: false,
    });
    expect(step("Что-то новое")).toBe("other");
    expect(step(null)).toBe("other");
  });

  it("uses the separate answer columns when the export fills them", () => {
    // The store answered, the rep has not: whatever the status still says.
    expect(orderStep({ status: SILENT, storeAnswer: "Подтверждено" }).step).toBe("agentWaiting");
    expect(orderStep({ status: null, storeAnswerAt: "2026-11-10T12:00" }).step).toBe(
      "agentWaiting",
    );
    expect(orderStep({ status: null, storeAnswer: "В ожидании" }).step).toBe("other");
    expect(orderStep({ status: CHOSE, storeAnswer: "Отказался" }).step).toBe("storeRefused");
    expect(orderStep({ status: CHOSE, agentAnswer: "Подтверждено" }).step).toBe("agentAccepted");
    expect(orderStep({ status: CHOSE, agentAnswer: "В ожидании" }).step).toBe("agentWaiting");
    expect(orderStep({ status: ACCEPTED, deliveredAt: "2026-11-11T15:00" }).step).toBe("delivered");
    expect(orderStep({ status: null, outcome: "Доставлено" }).step).toBe("delivered");
    // «Не доставлено» is not a delivery, even with a delivery time.
    expect(
      orderStep({ status: ACCEPTED, outcome: "Не доставлено", deliveredAt: "2026-11-11T15:00" })
        .step,
    ).toBe("agentAccepted");
  });
});

describe("pathChains", () => {
  it("starts a chain at every check that found a product out", () => {
    const checks = [
      check(900001, "2026-11-10", { ...out(A, B), [C]: "LOW" }),
      // The same store again: a chain of its own.
      check(900001, "2026-11-12", out(A)),
      // «Недостаточно» and «Не было закупа» start nothing.
      check(900002, "2026-11-10", { [A]: "LOW", [B]: "NOT_BOUGHT" }),
      check(900003, "2026-11-10", {}),
    ];
    expect(outOf(checks[0]!)).toEqual([A, B]);
    const chains = chainsOf(checks);
    expect(chains.map((c) => [c.check.storeCode, c.check.day, c.out, c.step])).toEqual([
      ["900001", "2026-11-10", [A, B], "noOrder"],
      ["900001", "2026-11-12", [A], "noOrder"],
    ]);
    expect(chains[0]).toMatchObject({ code: "TSM_TST_1", name: "Тест Первый", orderNo: null });
  });

  it("finds a check's order by either side's reference and takes the furthest step", () => {
    const bySource = check(900001, "2026-11-10", out(A));
    const byNumber = check(900002, "2026-11-10", out(A), TSM1, { orderNo: "#TEST-X" });
    // The order's row is not loaded: the check's own row says where the order stands.
    const ownRow = check(900003, "2026-11-10", out(A), TSM1, {
      orderCreated: true,
      orderNo: "#TEST-Y",
      delivery: CHOSE,
    });
    // The check's export is fresher than the order's.
    const fresher = check(900004, "2026-11-10", out(A), TSM1, {
      orderCreated: true,
      delivery: CONFIRMED,
    });
    // An order was made, nothing says where it stands.
    const unknown = check(900005, "2026-11-10", out(A), TSM1, { orderCreated: true });
    const chains = chainsOf(
      [bySource, byNumber, ownRow, fresher, unknown],
      [
        order(bySource, SILENT),
        { ...order(byNumber, ACCEPTED), id: "#TEST-X", sourceCheck: null },
        order(fresher, ACCEPTED),
      ],
    );
    expect(chains.map((c) => [c.step, c.confirmed, c.orderNo])).toEqual([
      ["storeSilent", false, `#TEST-${bySource.id}`],
      ["agentAccepted", false, "#TEST-X"],
      ["agentWaiting", false, "#TEST-Y"],
      ["delivered", true, `#TEST-${fresher.id}`],
      ["other", false, null],
    ]);
  });

  it("names the reps of a store: the route of the check's month, any month, the client base", () => {
    const checks = [
      check(900001, "2026-11-10", out(A)),
      check(900002, "2026-11-10", out(A)),
      check(900003, "2026-11-10", out(A)),
      check(900004, "2026-11-10", out(A)),
      check(900005, "2026-11-10", out(A)),
    ];
    const routes = [
      // In October the store was another rep's.
      route(DR2, 900001, "2026-10"),
      route(DR1, 900001),
      // Two rows of one zone (another employee in it) are one zone; two reps are two.
      route(DR1, 900002),
      route("dr tst 1", 900002),
      route(DR2, 900002),
      // Only an earlier month is loaded for this store.
      route(DR2, 900003, "2026-10"),
      // A TSM's own route is not a rep's.
      route("TSM_TST_1", 900004),
      route("TSM_TST_1", 900005),
    ];
    const chains = chainsOf(checks, [], routes, {
      clients: new Map([
        ["900001", { dr: "DR_TST_9" }],
        ["900004", { dr: " DR_TST_3 " }],
        ["900005", { dr: null }],
      ]),
    });
    expect(chains.map((c) => c.zones)).toEqual([[DR1], [DR1, DR2], [DR2], ["DR_TST_3"], []]);
  });

  it("knows a rep's zone by the employee info when its name does not say so", () => {
    const position = (title: string, roles: string[]) =>
      ({
        id: title,
        title,
        user: `Тест ${title}`,
        zones: [],
        roles,
        manager: null,
      }) as unknown as PositionRecord;
    const hierarchy = buildHierarchy([
      position("Тест зона 1", ["Торговый представитель"]),
      position("Тест зона 2", ["Мерчендайзер"]),
    ]);
    const routes = [route("Тест зона 1", 900001), route("Тест зона 2", 900001)];
    const checks = [check(900001, "2026-11-10", out(A))];
    expect(
      pathChains({ oos: checks, orders: [], reps: repRoutes(routes, hierarchy) })[0]!.zones,
    ).toEqual(["Тест зона 1"]);
    expect(chainsOf(checks, [], routes)[0]!.zones).toEqual([]);
  });

  it("keeps to the scope: the TSM's checks, or the checks at a rep's stores", () => {
    const checks = [
      check(900001, "2026-11-10", out(A), TSM1),
      check(900002, "2026-11-10", out(A), TSM2),
      check(900003, "2026-11-10", out(A), TSM2),
    ];
    const routes = [route(DR1, 900001), route(DR1, 900002), route(DR2, 900003)];
    const of = (scope: Set<string> | null) => chainsOf(checks, [], routes, { scope });
    expect(of(null).map((c) => [c.mine, c.shown])).toEqual([
      [true, [DR1]],
      [true, [DR1]],
      [true, [DR2]],
    ]);
    // A code is compared like a position title: without case, «_» as a space.
    const tsm = of(new Set(["tsm tst 2"]));
    expect(tsm.map((c) => [c.check.storeCode, c.mine, c.shown])).toEqual([
      ["900002", true, []],
      ["900003", true, []],
    ]);
    const rep = of(new Set([DR1]));
    expect(rep.map((c) => [c.check.storeCode, c.mine, c.shown])).toEqual([
      ["900001", false, [DR1]],
      ["900002", false, [DR1]],
    ]);
    expect(of(new Set())).toEqual([]);
  });
});

describe("chainSold", () => {
  const one = (skus: Record<string, OosStatus>, day = "2026-11-10") =>
    chainsOf([check(900001, day, skus)])[0]!;
  const sold = (
    chain: ReturnType<typeof one>,
    sales: (SaleRecord | SaleDayRecord)[],
    range: typeof RANGE | null = RANGE,
  ) => chainSold(chain, indexPathSales(sales, range));

  it("looks at the check's day and the next three, by delivery day", () => {
    const chain = one(out(A, B));
    expect(
      sold(chain, [sale(900001, "2026-11-10", { [A]: 1 }), sale(900001, "2026-11-13", { [B]: 2 })]),
    ).toBe("all");
    expect(sold(chain, [sale(900001, "2026-11-13", { [A]: 1 })])).toBe("some");
    // The day before the check and the fifth day are outside the window.
    expect(
      sold(chain, [sale(900001, "2026-11-09", { [A]: 1 }), sale(900001, "2026-11-14", { [B]: 1 })]),
    ).toBe("noneNothing");
    // Another store's sale is not this one's.
    expect(sold(chain, [sale(900002, "2026-11-10", { [A]: 1, [B]: 1 })])).toBe("noneNothing");
  });

  it("tells «nothing sold to the store» from «other products were sold»", () => {
    const chain = one({ ...out(A), [B]: "LOW" });
    expect(sold(chain, [sale(900001, "2026-11-11", { [C]: 3 })])).toBe("noneOther");
    // «Недостаточно» was not out: its sale is another product's.
    expect(sold(chain, [sale(900001, "2026-11-11", { [B]: 3 })])).toBe("noneOther");
    expect(sold(chain, [])).toBe("noneNothing");
  });

  it("compares product names without case and repeated spaces, and counts returns", () => {
    const chain = one(out("SKU-TEST 1"));
    expect(sold(chain, [sale(900001, "2026-11-11", { "sku-test  1": 1 })])).toBe("all");
    // Sold and taken back within the window: not sold.
    expect(
      sold(chain, [
        sale(900001, "2026-11-11", { [A]: 2 }),
        sale(900001, "2026-11-12", { [A]: -2 }),
      ]),
    ).toBe("noneOther");
    // A line of the report (a row stored before the store-days) counts the same.
    const line: SaleRecord = { ...sale(900001, "2026-11-12", {}), sku: A, blocks: 1 };
    delete (line as Partial<SaleDayRecord>).skus;
    expect(sold(chain, [line])).toBe("all");
  });

  it("leaves a chain open while the sales loaded do not cover its window", () => {
    // The sales end on 20 Nov: a check of 18 Nov needs 21 Nov.
    expect(sold(one(out(A), "2026-11-18"), [sale(900001, "2026-11-18", { [A]: 1 })])).toBe("open");
    expect(sold(one(out(A), "2026-11-17"), [sale(900001, "2026-11-18", { [A]: 1 })])).toBe("all");
    // Before the first day of the sales, and without any sales loaded.
    expect(sold(one(out(A), "2026-08-31"), [])).toBe("open");
    expect(sold(one(out(A)), [], null)).toBe("open");
  });
});

describe("oosPath", () => {
  // Seven chains of two TSMs: every step once, with what Smart Up shows for each.
  const build = (scope: Set<string> | null = null) => {
    const none = check(900001, "2026-11-10", out(A, B), TSM1);
    const noneSold = check(900002, "2026-11-10", out(A), TSM1);
    const silent = check(900003, "2026-11-10", out(A), TSM1);
    const waitingRep = check(900004, "2026-11-11", out(A, B), TSM2);
    const waitingRepOld = check(900005, "2026-11-09", out(A), TSM2);
    const accepted = check(900006, "2026-11-10", out(A), TSM2);
    const delivered = check(900007, "2026-11-10", out(A, B), TSM2);
    const deliveredSold = check(900008, "2026-11-10", out(A), TSM2);
    const open = check(900009, "2026-11-19", out(A), TSM2);
    const checks = [
      none,
      noneSold,
      silent,
      waitingRep,
      waitingRepOld,
      accepted,
      delivered,
      deliveredSold,
      open,
    ];
    const orders = [
      order(silent, SILENT),
      order(waitingRep, CHOSE),
      order(waitingRepOld, CHOSE),
      order(accepted, ACCEPTED),
      order(delivered, DELIVERED),
      order(deliveredSold, CONFIRMED),
      order(open, WAITING),
    ];
    const routes = [
      route(DR1, 900001),
      route(DR1, 900004),
      route(DR1, 900007),
      route(DR2, 900005),
      route(DR2, 900007),
      route(DR2, 900008),
    ];
    const sales = [
      // No order, yet the product came (the rep's ordinary route).
      sale(900002, "2026-11-12", { [A]: 1 }),
      // The store never answered; another product was sold to it.
      sale(900003, "2026-11-11", { [C]: 1 }),
      sale(900004, "2026-11-12", { [A]: 1 }),
      // Delivered in the bot, and Smart Up shows another product only.
      sale(900007, "2026-11-11", { [C]: 2 }),
      sale(900008, "2026-11-11", { [A]: 2 }),
    ];
    const hierarchy = buildHierarchy(
      [
        ["BDM 99", "Тест Руководитель", "BUM TEST"],
        ["TSM_TST_1", "Тест Первый", "BDM 99"],
      ].map(
        ([title, user, manager], i) =>
          ({
            id: String(900100 + i),
            title,
            user,
            zones: [],
            roles: [],
            manager,
          }) as unknown as PositionRecord,
      ),
    );
    return oosPath(chainsOf(checks, orders, routes, { scope }), {
      sales: indexPathSales(sales, RANGE),
      hierarchy,
      regions: new Map([
        ["tsm tst 1", "Тест регион 1"],
        ["tsm tst 2", "Тест регион 2"],
      ]),
      scope,
    });
  };

  it("counts the steps, what was sold and the two mismatches", () => {
    const p = build();
    expect(p.days).toBe(3);
    expect(p.sales).toEqual(RANGE);
    expect(p.totals).toEqual({
      checks: 9,
      orders: 7,
      noOrder: 2,
      noOrderRate: 22,
      storeWaiting: 1,
      storeSilent: 1,
      storeRefused: 0,
      agentWaiting: 2,
      agentAccepted: 1,
      delivered: 2,
      confirmed: 1,
      other: 0,
      closed: 8,
      open: 1,
      soldAll: 2,
      soldSome: 1,
      anySold: 3,
      soldRate: 38,
      notSold: 5,
      noneOther: 2,
      noneNothing: 3,
      // Store 900007: delivered, and none of its two products sold.
      deliveredNoSale: 1,
      // Store 900002: no order, and the product was sold.
      soldAnyway: 1,
      stores: 9,
      tsms: 2,
      // Stores 900002, 900003, 900006, 900009 are on no rep's route; 900007 is on two.
      noZone: 4,
      severalZones: 1,
    });
    expect(p.funnel).toEqual([
      { key: "found", count: 9, of: null, rate: null, stopped: 0 },
      { key: "order", count: 7, of: 9, rate: 78, stopped: 2 },
      // The store chose a date in five of the seven orders.
      { key: "store", count: 5, of: 7, rate: 71, stopped: 2 },
      { key: "agent", count: 3, of: 5, rate: 60, stopped: 2 },
      { key: "delivered", count: 2, of: 3, rate: 67, stopped: 1 },
      { key: "sold", count: 1, of: 2, rate: 50, stopped: 1 },
    ]);
    // A step nobody stands at is left out.
    expect(p.cross.map((c) => c.step)).toEqual([
      "noOrder",
      "storeWaiting",
      "storeSilent",
      "agentWaiting",
      "agentAccepted",
      "delivered",
    ]);
    expect(p.cross.find((c) => c.step === "noOrder")).toEqual({
      step: "noOrder",
      checks: 2,
      anySold: 1,
      anyRate: 50,
      all: 1,
      some: 0,
      noneOther: 0,
      noneNothing: 1,
      open: 0,
    });
    // Waiting for the store, and its three days are not over: no share yet.
    expect(p.cross.find((c) => c.step === "storeWaiting")).toMatchObject({
      checks: 1,
      open: 1,
      anyRate: null,
    });
    expect(p.cross.find((c) => c.step === "delivered")).toMatchObject({
      checks: 2,
      all: 1,
      noneOther: 1,
      anyRate: 50,
    });
  });

  it("names who did not do their part: the TSMs, the reps, the regions, the managers", () => {
    const p = build();
    // The TSM who left the most checks without an order first.
    expect(p.byTsm.map((x) => [x.code, x.name, x.checks, x.noOrder, x.noOrderRate])).toEqual([
      ["TSM_TST_1", "Тест Первый", 3, 2, 67],
      ["TSM_TST_2", "Тест Второй", 6, 0, 0],
    ]);
    expect(p.byTsm[1]).toMatchObject({
      agentWaiting: 2,
      agentAccepted: 1,
      delivered: 2,
      deliveredNoSale: 1,
      open: 1,
    });
    // A store on two routes counts for both reps; the stores on no route are one row, the last.
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
      [DR1, 3, 2, 1, 1, 1],
      [DR2, 3, 3, 1, 2, 1],
      [null, 4, 3, 0, 0, 0],
    ]);
    expect(p.byDr[0]).toMatchObject({ soldRate: 33, notSold: 2 });
    expect(p.byRegion.map((x) => [x.region, x.people, x.checks, x.noOrderRate])).toEqual([
      ["Тест регион 1", 1, 3, 67],
      ["Тест регион 2", 1, 6, 0],
    ]);
    expect(p.byManager.map((x) => [x.title, x.name, x.people, x.checks, x.noOrder])).toEqual([
      ["BDM 99", "Тест Руководитель", 1, 3, 2],
      // TSM 2 is not in the employee info.
      [null, null, 1, 6, 0],
    ]);
  });

  it("lists the chains to act on: delivered and not sold, waiting for the rep, no order", () => {
    const p = build();
    expect(
      p.stores.map((s) => [s.reason, s.storeCode, s.day, s.code, s.zones, s.out.length, s.sold]),
    ).toEqual([
      ["deliveredNoSale", "900007", "2026-11-10", "TSM_TST_2", [DR1, DR2], 2, "noneOther"],
      // The order waiting the longest first, whatever was sold.
      ["agentWaiting", "900005", "2026-11-09", "TSM_TST_2", [DR2], 1, "noneNothing"],
      ["agentWaiting", "900004", "2026-11-11", "TSM_TST_2", [DR1], 2, "some"],
      ["noOrderNoSale", "900001", "2026-11-10", "TSM_TST_1", [DR1], 2, "noneNothing"],
    ]);
    expect(p.stores[0]).toMatchObject({
      store: "Тест магазин 900007",
      name: "Тест Второй",
      step: "delivered",
      out: [A, B],
    });
    expect(p.stores[0]!.orderNo).toMatch(/^#TEST-/);
    expect(p.stores[3]!.orderNo).toBeNull();
  });

  it("keeps to the scope", () => {
    // A TSM (or their manager): their own checks; the reps are not theirs to see.
    const tsm = build(new Set(["TSM_TST_1"]));
    expect(tsm.totals).toMatchObject({ checks: 3, noOrder: 2, storeSilent: 1, soldAnyway: 1 });
    expect(tsm.byTsm.map((x) => x.code)).toEqual(["TSM_TST_1"]);
    expect(tsm.byDr).toEqual([]);
    expect(tsm.stores.map((s) => s.storeCode)).toEqual(["900001"]);
    // A rep (or the distributor's supervisor): the checks at the rep's stores.
    const rep = build(new Set([DR2]));
    expect(rep.totals).toMatchObject({ checks: 3, agentWaiting: 1, delivered: 2, noZone: 0 });
    expect(rep.byDr.map((x) => [x.zone, x.checks])).toEqual([[DR2, 3]]);
    expect(rep.byTsm).toEqual([]);
    expect(rep.byRegion).toEqual([]);
    expect(rep.stores.map((s) => s.storeCode)).toEqual(["900007", "900005"]);
  });

  it("shows the steps alone when no sales are loaded", () => {
    const checks = [check(900001, "2026-11-10", out(A)), check(900002, "2026-11-10", out(A))];
    const p = oosPath(chainsOf(checks, [order(checks[0]!, DELIVERED)]), { sales: null });
    expect(p.sales).toBeNull();
    expect(p.totals).toMatchObject({
      checks: 2,
      delivered: 1,
      noOrder: 1,
      closed: 0,
      open: 2,
      soldRate: null,
      deliveredNoSale: 0,
    });
    // Nothing is known to be unsold, so there is nothing to chase yet.
    expect(p.stores).toEqual([]);
    expect(p.byManager).toEqual([]);
    expect(p.byRegion.map((x) => x.region)).toEqual(["—"]);
    expect(oosPath([], { sales: null }).totals).toMatchObject({ checks: 0, noOrderRate: null });
  });
});
