import { describe, expect, it } from "vitest";

import type { RouteZone } from "./routes";
import { zoneSales, type SalesGroup } from "./zone-sales";

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
