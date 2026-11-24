import { describe, expect, it } from "vitest";

import type { RouteZone } from "./routes";
import {
  idleStores,
  idleSummary,
  soldStores,
  sortIdle,
  zoneSales,
  type IdleStore,
  type RouteStore,
  type SalesGroup,
} from "./zone-sales";

// Synthetic data only: DR_TST_* / TSM_TST_* zones, stores 9000xx.
const zone = (name: string, kind: "DR" | "TSM", rates: Partial<RouteZone> = {}) =>
  ({
    zone: name,
    kind,
    person: `Тест ${name}`,
    organization: "Тестоград",
    attendance: 90,
    hitRate: kind === "DR" ? 50 : null,
    ...rates,
  }) as RouteZone;

const group = (
  period: "now" | "before",
  staff: string | null,
  tsm: string | null,
  sum: number,
  stores: string[] = [],
): SalesGroup => ({ period, staff, tsm, blocks: sum / 100, sum, days: stores.length || 1, stores });

const ZONES = [zone("DR_TST_1", "DR"), zone("DR_TST_2", "DR"), zone("TSM_TST_1", "TSM")];
const CLIENTS = new Map([
  ["dr tst 1", new Set(["900001", "900002", "900003"])],
  ["dr tst 2", new Set(["900003", "900004"])],
  ["tsm tst 1", new Set(["900001", "900004"])],
]);
const GROUPS = [
  // DR_TST_1 sold 1 000 to two stores of the TSM's, and 500 to nobody's store.
  group("now", "DR_TST_1", "TSM_TST_1", 1000, ["900001"]),
  group("now", "dr_tst_1", null, 500, ["900002"]),
  group("before", "DR_TST_1", "TSM_TST_1", 2000),
  // DR_TST_2 sold nothing now, something before.
  group("before", "DR_TST_2", null, 800),
  // An operator without a route.
  group("now", "Operator 9 (Тест)", "TSM_TST_1", 300, ["900004", "900099"]),
];
const sales = (extra: Partial<Parameters<typeof zoneSales>[0]> = {}) =>
  zoneSales({
    zones: ZONES,
    clients: CLIENTS,
    groups: GROUPS,
    repZones: ["DR_TST_1", "DR_TST_2"],
    ...extra,
  });

describe("«Продажи по зонам»", () => {
  it("gives a rep what they sold and a TSM what was sold to their stores", () => {
    const rows = Object.fromEntries(sales().rows.map((r) => [r.zone, r]));
    // The rep's name is compared as a zone's: «dr_tst_1» is DR_TST_1.
    expect(rows["DR_TST_1"]).toMatchObject({ sum: 1500, blocks: 15, before: 2000, change: -25 });
    expect(rows["DR_TST_2"]).toMatchObject({ sum: 0, before: 800, change: -100 });
    // The TSM's stores were sold to by the rep and by the operator.
    expect(rows["TSM_TST_1"]).toMatchObject({ sum: 1300, before: 2000, change: -35 });
    // A rep has a hit rate next to the sales, a TSM their attendance.
    expect(rows["DR_TST_1"]).toMatchObject({ hitRate: 50, attendance: 90 });
    expect(rows["TSM_TST_1"]).toMatchObject({ hitRate: null, attendance: 90 });
  });

  it("counts the stores of a zone's route anyone sold to", () => {
    const rows = Object.fromEntries(sales().rows.map((r) => [r.zone, r]));
    // 900001 and 900002 of the three; 900003 had no sale.
    expect(rows["DR_TST_1"]).toMatchObject({ clients: 3, buying: 2, coverage: 66.7 });
    // 900004 was sold to by the operator: the store bought, whoever sold.
    expect(rows["DR_TST_2"]).toMatchObject({ clients: 2, buying: 1, coverage: 50 });
    // The reps' routes together: four stores (900003 is on both), three of them with a sale.
    expect(sales()).toMatchObject({ clients: 4, buying: 3 });
    // A zone with no route in the period has nothing to take a share of.
    expect(sales({ clients: new Map() }).rows[0]).toMatchObject({ clients: 0, coverage: null });
  });

  it("totals every sale, and says how much was sold by those with no route", () => {
    const s = sales();
    expect(s.total).toEqual({ blocks: 18, sum: 1800, before: 2800, change: -35.7 });
    expect(s.outside).toEqual({ blocks: 3, sum: 300, share: 16.7, staff: 1 });
    // Nothing before: no change to show.
    expect(sales({ groups: GROUPS.filter((g) => g.period === "now") }).total.change).toBeNull();
    expect(sales().legacy).toBe(false);
    expect(sales({ legacy: true }).legacy).toBe(true);
  });

  it("puts the biggest fall first: the TSMs, then the reps", () => {
    expect(sales().rows.map((r) => [r.zone, r.change])).toEqual([
      ["TSM_TST_1", -35],
      ["DR_TST_2", -100],
      ["DR_TST_1", -25],
    ]);
    // What has nothing to compare with goes after, the smaller money first.
    const fresh = sales({
      groups: [
        group("now", "DR_TST_1", null, 900, ["900001"]),
        group("now", "DR_TST_2", null, 100, ["900004"]),
      ],
    });
    expect(fresh.rows.filter((r) => r.kind === "DR").map((r) => [r.zone, r.change])).toEqual([
      ["DR_TST_2", null],
      ["DR_TST_1", null],
    ]);
  });
});

describe("«Точки маршрута без продаж»", () => {
  const store = (code: string, visits = 1, orders = 0): [string, RouteStore] => [
    code,
    { store: `Тест магазин ${code}`, organization: "Тестоград", visits, orders },
  ];
  const STORES = new Map([
    ["dr tst 1", new Map([store("900001"), store("900002"), store("900003", 4, 2)])],
    ["dr tst 2", new Map([store("900003", 0), store("900004")])],
    ["tsm tst 1", new Map([store("900001"), store("900005", 2)])],
  ]);
  const SOLD = soldStores(GROUPS);

  it("takes the stores sold to in the period shown, not before", () => {
    expect([...SOLD].sort()).toEqual(["900001", "900002", "900004", "900099"]);
    expect(soldStores([group("before", "DR_TST_1", null, 100, ["900001"])]).size).toBe(0);
  });

  it("lists the reps' route stores nobody sold to, a store on two routes with each", () => {
    const idle = idleStores({ zones: ZONES, stores: STORES, sold: SOLD });
    // 900004 was sold to by an operator: it bought. The TSM's 900005 is not a rep's store.
    expect(idle.map((s) => [s.zone, s.storeCode, s.visits, s.orders])).toEqual([
      ["DR_TST_1", "900003", 4, 2],
      ["DR_TST_2", "900003", 0, 0],
    ]);
    expect(idle[0]).toMatchObject({
      kind: "DR",
      person: "Тест DR_TST_1",
      store: "Тест магазин 900003",
      organization: "Тестоград",
    });
  });

  it("lists the TSMs' own route stores when no rep is shown", () => {
    const idle = idleStores({ zones: [ZONES[2]!], stores: STORES, sold: SOLD });
    expect(idle.map((s) => [s.zone, s.storeCode])).toEqual([["TSM_TST_1", "900005"]]);
    // A zone with no route in the period has nothing to list.
    expect(idleStores({ zones: ZONES, stores: new Map(), sold: SOLD })).toEqual([]);
  });

  it("puts the biggest first, then those with an order marked and no sale", () => {
    const row = (storeCode: string, grade: string | null, orders: number, visits: number) =>
      ({
        storeCode,
        store: `Тест магазин ${storeCode}`,
        zone: "DR_TST_1",
        kind: "DR",
        person: null,
        organization: null,
        lastSale: null,
        equipment: null,
        grade,
        orders,
        visits,
      }) satisfies IdleStore;
    const sorted = sortIdle(
      [
        row("900001", null, 5, 5),
        row("900002", "m", 0, 9),
        row("900003", "XL", 0, 1),
        row("900004", "M", 2, 1),
        row("900005", "XL", 0, 3),
        row("900006", "M", 2, 4),
      ],
      ["XL", "L", "M", "S"],
    );
    expect(sorted.map((s) => s.storeCode)).toEqual([
      "900005",
      "900003",
      "900006",
      "900004",
      "900002",
      "900001",
    ]);
    // A store on two routes is one store: visited by one of the two is visited.
    expect(
      idleSummary([
        row("900001", null, 2, 3),
        row("900002", null, 0, 0),
        { ...row("900002", null, 0, 1), zone: "DR_TST_2" },
        { ...row("900003", null, 0, 0), lastSale: "2026-10-20" },
      ]),
    ).toEqual({ stores: 3, orders: 1, unvisited: 1, never: 2 });
  });
});
