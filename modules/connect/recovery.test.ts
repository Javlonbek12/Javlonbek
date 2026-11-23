import { describe, expect, it } from "vitest";

import { buildHierarchy } from "./hierarchy";
import type { OosRecord, OosStatus, PositionRecord, RouteCode, RouteRecord } from "./parse";
import { analyzeRecovery, followUps, recoveryFrom } from "./recovery";

// Synthetic data only: TSM_TST_* / DR_TST_* codes, «Тест …» people, stores 9000xx, SKU-TEST n.

const TSM1 = "TSM_TST_1 - Тест Первый";
const TSM2 = "TSM_TST_2 - Тест Второй";
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map((n) => `SKU-TEST ${n}`) as [
  string,
  string,
  string,
  string,
  string,
];

let nextId = 1;
const check = (
  store: number,
  at: string,
  skus: Record<string, OosStatus>,
  person = TSM1,
): OosRecord => ({
  id: String(nextId++),
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at,
  day: at.slice(0, 10),
  month: at.slice(0, 7),
  person,
  missing: Object.values(skus).filter((s) => s === "OUT").length,
  low: Object.values(skus).filter((s) => s === "LOW").length,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus,
});
const out = (...skus: string[]) => Object.fromEntries(skus.map((s) => [s, "OUT" as const]));

const WEEK = { from: "2026-11-09", to: "2026-11-15" };

describe("analyzeRecovery", () => {
  it("compares a store's last check of the period with the check before it", () => {
    const r = analyzeRecovery(
      [
        // «Недостаточно» is on the shelf, «Не было закупа» is not an OOS.
        check(900001, "2026-11-03T10:00", { ...out(A, B, E), [C]: "LOW", [D]: "NOT_BOUGHT" }),
        check(900001, "2026-11-10T10:00", { ...out(B, C, D), [E]: "NOT_BOUGHT" }),
      ],
      WEEK,
    );
    expect(r.baseline).toBe("prev");
    expect(r.stores).toMatchObject([
      {
        storeCode: "900001",
        code: "TSM_TST_1",
        baseDay: "2026-11-03",
        lastDay: "2026-11-10",
        days: 7,
        // A is back; E is no longer «нет в наличии» either.
        restored: [A, E],
        stillOut: [B],
        // C was low and D not bought: both are out only now.
        newlyOut: [C, D],
        worse: false,
      },
    ]);
    expect(r.totals).toEqual({
      stores: 1,
      restored: 2,
      stillOut: 1,
      newlyOut: 2,
      worse: 0,
      wasOut: 3,
      rate: 67,
    });
  });

  it("takes the final check of a store-day and leaves out stores with one day of checks", () => {
    const r = analyzeRecovery(
      [
        check(900001, "2026-11-03T09:00", out(A, B, C)),
        // The later check of the same day is the day's final one.
        check(900001, "2026-11-03T17:00", out(A, B)),
        check(900001, "2026-11-10T09:00", out(A, B)),
        check(900001, "2026-11-10T16:00", out(A)),
        // Two checks on one day only: nothing to compare with.
        check(900002, "2026-11-10T09:00", out(A)),
        check(900002, "2026-11-10T12:00", out()),
        // One check.
        check(900003, "2026-11-11T09:00", out(A)),
      ],
      WEEK,
    );
    expect(r.totals).toMatchObject({ stores: 1, restored: 1, stillOut: 1, newlyOut: 0, rate: 50 });
    expect(r.stores.map((s) => s.storeCode)).toEqual(["900001"]);
  });

  it("looks back before the period, up to 45 days, and not past the period's end", () => {
    const checks = [
      check(900001, "2026-10-01T10:00", out(A)),
      check(900001, "2026-11-12T10:00", out()),
      // After the period: the last check of the period is still 12 Nov.
      check(900001, "2026-11-20T10:00", out(A, B)),
      // 46 days before: too old to compare with.
      check(900002, "2026-09-27T10:00", out(A)),
      check(900002, "2026-11-12T10:00", out()),
      // The last check is before the period: not this period's store.
      check(900003, "2026-11-01T10:00", out(A)),
      check(900003, "2026-11-05T10:00", out()),
    ];
    const r = analyzeRecovery(checks, WEEK);
    expect(r.totals).toMatchObject({ stores: 1, restored: 1, stillOut: 0, rate: 100 });
    expect(r.byTsm).toMatchObject([{ code: "TSM_TST_1", stores: 1, restored: 1 }]);
    // A store with nothing out and nothing new is compared but not listed.
    expect(r.stores).toEqual([]);
    expect(recoveryFrom("2026-11-09")).toBe("2026-09-25");
    expect(recoveryFrom("2026-12-30")).toBe("2026-11-15");
  });

  it("compares with the store's first check of the month when asked", () => {
    const checks = [
      check(900001, "2026-10-28T10:00", out(A, B, C)),
      check(900001, "2026-11-02T10:00", out(A, B)),
      check(900001, "2026-11-06T10:00", out(A)),
      check(900001, "2026-11-13T10:00", out(B)),
      // The only earlier check is in October: nothing of this month to compare with.
      check(900002, "2026-10-30T10:00", out(A)),
      check(900002, "2026-11-13T10:00", out(A)),
    ];
    const prev = analyzeRecovery(checks, { ...WEEK, baseline: "prev" });
    expect(prev.totals).toMatchObject({ stores: 2, restored: 1, stillOut: 1, newlyOut: 1 });
    expect(prev.stores.find((s) => s.storeCode === "900001")).toMatchObject({
      baseDay: "2026-11-06",
      restored: [A],
      newlyOut: [B],
    });
    const month = analyzeRecovery(checks, { ...WEEK, baseline: "month" });
    expect(month.baseline).toBe("month");
    expect(month.totals).toMatchObject({ stores: 1, restored: 1, stillOut: 1, newlyOut: 0 });
    expect(month.stores).toMatchObject([
      { storeCode: "900001", baseDay: "2026-11-02", days: 11, restored: [A], stillOut: [B] },
    ]);
  });

  it("counts by who made the last check, by product and the stores that got worse", () => {
    const r = analyzeRecovery(
      [
        // Store 1 (TSM 1): A back, B still out.
        check(900001, "2026-11-03T10:00", out(A, B), TSM2),
        check(900001, "2026-11-10T10:00", out(B), TSM1),
        // Store 2 (TSM 2): nothing back, one more out — worse.
        check(900002, "2026-11-04T10:00", out(A, B), TSM2),
        check(900002, "2026-11-11T10:00", out(A, B, C), TSM2),
        // Store 3 (TSM 2): all back.
        check(900003, "2026-11-04T10:00", out(C), TSM2),
        check(900003, "2026-11-11T10:00", out(), TSM2),
      ],
      WEEK,
    );
    expect(r.totals).toEqual({
      stores: 3,
      restored: 2,
      stillOut: 3,
      newlyOut: 1,
      worse: 1,
      wasOut: 5,
      rate: 40,
    });
    // The most still out first.
    expect(r.byTsm).toEqual([
      {
        code: "TSM_TST_2",
        name: "Тест Второй",
        stores: 2,
        restored: 1,
        stillOut: 2,
        newlyOut: 1,
        worse: 1,
        wasOut: 3,
        rate: 33,
      },
      {
        code: "TSM_TST_1",
        name: "Тест Первый",
        stores: 1,
        restored: 1,
        stillOut: 1,
        newlyOut: 0,
        worse: 0,
        wasOut: 2,
        rate: 50,
      },
    ]);
    // The worst share first.
    expect(r.bySku).toEqual([
      { sku: B, restored: 0, stillOut: 2, wasOut: 2, rate: 0 },
      { sku: A, restored: 1, stillOut: 1, wasOut: 2, rate: 50 },
      { sku: C, restored: 1, stillOut: 0, wasOut: 1, rate: 100 },
    ]);
    // The most still out first; the store with all back is not listed.
    expect(r.stores.map((s) => [s.storeCode, s.stillOut.length, s.worse])).toEqual([
      ["900002", 2, true],
      ["900001", 1, false],
    ]);
  });

  it("keeps to the scope: the stores whose last check was made by a TSM in it", () => {
    const checks = [
      check(900001, "2026-11-03T10:00", out(A), TSM2),
      check(900001, "2026-11-10T10:00", out(A), TSM1),
      check(900002, "2026-11-04T10:00", out(A), TSM2),
      check(900002, "2026-11-11T10:00", out(), TSM2),
    ];
    // A code is compared like a position title: without case, «_» as a space.
    const mine = analyzeRecovery(checks, { ...WEEK, scope: new Set(["tsm tst 1"]) });
    expect(mine.totals).toMatchObject({ stores: 1, restored: 0, stillOut: 1, rate: 0 });
    expect(mine.byTsm.map((t) => t.code)).toEqual(["TSM_TST_1"]);
    expect(analyzeRecovery(checks, { ...WEEK, scope: new Set() }).totals).toMatchObject({
      stores: 0,
      rate: null,
    });
    expect(analyzeRecovery(checks, { ...WEEK, scope: null }).totals.stores).toBe(2);
  });
});

// --- Did the distributor follow up? -------------------------------------------------------------

const route = (
  zone: string,
  store: number,
  days: Record<string, RouteCode>,
  lastDay = "2026-11-14",
): RouteRecord => ({
  id: `${lastDay.slice(0, 7)}|${zone}|${store}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at: "",
  day: lastDay,
  month: lastDay.slice(0, 7),
  person: zone,
  staff: zone,
  days,
});
const DR1 = "DR_TST_1";
const DR2 = "DR_TST_2";

describe("followUps", () => {
  it("looks for a rep's visit with an order on the day of the check or the next three", () => {
    const routes = [
      // Store 1: an order the day after the check.
      route(DR1, 900001, { "09": "P", "10": "PD" }),
      // Store 2: visits, no order.
      route(DR1, 900002, { "09": "P", "11": "U" }),
      // Store 3: an order on the fourth day after the check — too late; and one before it.
      route(DR2, 900003, { "07": "PD", "13": "UD" }),
      // Store 4: an unplanned visit with an order on the day of the check.
      route(DR2, 900004, { "10": "UD" }),
      // The TSM's own route: his visits are not the distributor's (and take no orders).
      route("TSM_TST_1", 900002, { "09": "PD" }),
      route("TSM_TST_1", 900005, { "09": "PD" }),
    ];
    const f = followUps(
      [
        check(900001, "2026-11-09T10:00", out(A)),
        check(900002, "2026-11-09T11:00", out(A)),
        check(900003, "2026-11-09T12:00", out(A, B), TSM2),
        check(900004, "2026-11-10T12:00", out(A), TSM2),
        // Not on a rep's route: not counted.
        check(900005, "2026-11-09T13:00", out(A)),
        // Nothing out («недостаточно» only): not counted.
        check(900001, "2026-11-11T10:00", { [A]: "LOW" }),
        // Before the period.
        check(900002, "2026-11-06T10:00", out(A)),
      ],
      routes,
      WEEK,
    );
    expect(f.days).toBe(3);
    expect(f.routesTo).toBe("2026-11-14");
    expect(f.totals).toEqual({ checks: 4, followed: 2, rate: 50, open: 0 });
    // The worst share first.
    expect(f.byDr).toEqual([
      { zone: DR1, checks: 2, followed: 1, rate: 50 },
      { zone: DR2, checks: 2, followed: 1, rate: 50 },
    ]);
    expect(f.byTsm).toEqual([
      { code: "TSM_TST_1", name: "Тест Первый", checks: 2, followed: 1, rate: 50 },
      { code: "TSM_TST_2", name: "Тест Второй", checks: 2, followed: 1, rate: 50 },
    ]);
  });

  it("leaves out checks whose three days the routes loaded do not cover yet", () => {
    const routes = [route(DR1, 900001, { "09": "P", "12": "PD" }, "2026-11-12")];
    const f = followUps(
      [
        // 9 + 3 = 12 Nov: covered. 10 + 3 = 13 Nov: the routes end on 12 Nov.
        check(900001, "2026-11-09T10:00", out(A)),
        check(900001, "2026-11-10T10:00", out(A)),
      ],
      routes,
      WEEK,
    );
    expect(f.totals).toEqual({ checks: 1, followed: 1, rate: 100, open: 1 });
    // No routes of the month at all: the window is not covered either.
    const october = followUps(
      [check(900001, "2026-11-09T10:00", out(A))],
      [route(DR1, 900001, { "30": "PD" }, "2026-10-31")],
      WEEK,
    );
    expect(october.totals).toEqual({ checks: 0, followed: 0, rate: null, open: 1 });
    expect(followUps([check(900001, "2026-11-09T10:00", out(A))], [], WEEK)).toMatchObject({
      routesTo: null,
      totals: { checks: 0, rate: null, open: 0 },
      byDr: [],
      byTsm: [],
    });
  });

  it("keeps to the scope: the TSM's checks or the rep's stores, rows only for zones in it", () => {
    const routes = [
      route(DR1, 900001, { "10": "PD" }),
      route(DR2, 900002, { "09": "P" }),
      // A store two reps go to: an order by either counts.
      route(DR1, 900003, { "09": "P" }),
      route(DR2, 900003, { "11": "UD" }),
    ];
    const checks = [
      check(900001, "2026-11-09T10:00", out(A), TSM1),
      check(900002, "2026-11-09T10:00", out(A), TSM2),
      check(900003, "2026-11-09T10:00", out(A), TSM2),
    ];
    const all = followUps(checks, routes, WEEK);
    expect(all.totals).toMatchObject({ checks: 3, followed: 2 });
    expect(all.byDr).toEqual([
      { zone: DR2, checks: 2, followed: 1, rate: 50 },
      { zone: DR1, checks: 2, followed: 2, rate: 100 },
    ]);
    // A TSM's manager: that TSM's checks; the reps are not theirs to see.
    const tsm = followUps(checks, routes, { ...WEEK, scope: new Set(["TSM_TST_2"]) });
    expect(tsm.totals).toMatchObject({ checks: 2, followed: 1, rate: 50 });
    expect(tsm.byTsm.map((t) => t.code)).toEqual(["TSM_TST_2"]);
    expect(tsm.byDr).toEqual([]);
    // The distributor's supervisor: the checks at the rep's stores; the TSMs are not theirs.
    const rep = followUps(checks, routes, { ...WEEK, scope: new Set(["dr tst 1"]) });
    expect(rep.totals).toMatchObject({ checks: 2, followed: 2, rate: 100 });
    expect(rep.byDr).toEqual([{ zone: DR1, checks: 2, followed: 2, rate: 100 }]);
    expect(rep.byTsm).toEqual([]);
  });

  it("knows a rep's zone by the employee info when its name does not say so", () => {
    const position = (title: string, roles: string[]): PositionRecord =>
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
    const routes = [
      route("Тест зона 1", 900001, { "10": "PD" }),
      route("Тест зона 2", 900002, { "10": "PD" }),
    ];
    const checks = [
      check(900001, "2026-11-09T10:00", out(A)),
      check(900002, "2026-11-09T10:00", out(A)),
    ];
    const f = followUps(checks, routes, { ...WEEK, hierarchy });
    expect(f.totals).toMatchObject({ checks: 1, followed: 1 });
    expect(f.byDr.map((z) => z.zone)).toEqual(["Тест зона 1"]);
    // Without the employee info both zones are someone's own field staff.
    expect(followUps(checks, routes, WEEK).totals.checks).toBe(0);
  });
});
