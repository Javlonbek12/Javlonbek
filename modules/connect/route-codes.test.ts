import { describe, expect, it } from "vitest";

import type { RouteRecord } from "./parse";
import { addRouteCode, emptyRouteCounts, routeDays, routeRates, staffKind } from "./route-codes";

const route = (days: RouteRecord["days"]): RouteRecord => ({
  id: "2026-11|DR_TST_1|900001",
  storeCode: "900001",
  storeName: "Тест магазин 1",
  city: "Тестоград",
  channel: null,
  at: "",
  day: "2026-11-23",
  month: "2026-11",
  person: "DR_TST_1",
  staff: "DR_TST_1",
  days,
});

describe("route codes", () => {
  it("counts a period's codes: plan, visits, misses, orders", () => {
    const days = routeDays(
      route({ "02": "PD", "03": "X", "04": "P", "05": "UD", "06": "U", "09": "O", "10": "PD" }),
      "2026-11-02",
      "2026-11-09",
    );
    expect(days.map((d) => d.day)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
    ]);
    const counts = days.reduce((c, d) => addRouteCode(c, d.code), emptyRouteCounts());
    expect(counts).toEqual({
      planned: 3,
      visited: 2,
      missed: 1,
      unplanned: 2,
      upcoming: 1,
      visits: 4,
      orders: 2,
    });
    expect(routeRates(counts)).toEqual({ attendance: 66.7, hitRate: 50 });
    expect(routeRates(emptyRouteCounts())).toEqual({ attendance: null, hitRate: null });
  });

  it("tells the distributor's reps from KT&G's field staff; the office is nobody's route", () => {
    expect(staffKind("DR_TST_1")).toBe("DR");
    expect(staffKind("DR 02")).toBe("DR");
    expect(staffKind("TSM_TST_1")).toBe("TSM");
    expect(staffKind("Key Account / KA")).toBe("TSM");
    expect(staffKind("Офис (Office)")).toBeNull();
    // A drugstore zone is not «DR».
    expect(staffKind("DRUG_TST_1")).toBe("TSM");
  });
});
