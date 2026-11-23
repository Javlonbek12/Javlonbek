import { describe, expect, it } from "vitest";

import type { OosRecord, RouteCode, RouteRecord, VisitRecord } from "./parse";
import { isRouteVisit, visitsFromRoutes } from "./route-visits";
import {
  analyzeVisits,
  checkVisit,
  finalMarketVisits,
  finalOosChecks,
  STORE_OPEN_QUESTION,
  storeDay,
  tsmRows,
  visitSections,
} from "./visits";

// Synthetic data only: TSM_TST_* / DR_TST_* zones, «Тест …» people, stores 9000xx.

const route = (
  zone: string,
  store: number,
  days: Record<string, RouteCode>,
  extra: Partial<RouteRecord> = {},
): RouteRecord => ({
  id: `2026-11|${zone}|${store}`,
  storeCode: String(store),
  storeName: `Тест магазин ${store}`,
  city: "Тестоград",
  channel: null,
  at: "",
  day: "2026-11-12",
  month: "2026-11",
  person: zone,
  staff: zone,
  days,
  ...extra,
});

const PERIOD = { from: "2026-11-09", to: "2026-11-15" };
const ROUTES = [
  route("TSM_TST_1", 900001, { "02": "P", "09": "PD", "10": "X", "11": "U", "12": "O" }),
  // A supervisor came along on the 9th and alone on the 10th.
  route("TSM_TST_1", 900001, { "09": "U", "10": "UD" }, { staff: "Senior TST" }),
  route("TSM_TST_1", 900002, { "09": "P" }),
  // The distributor's reps and the office are not TSMs.
  route("DR_TST_1", 900001, { "09": "PD" }),
  route("Тест (Office)", 900003, { "09": "P" }),
];

const mv = (day: string, time: string, extra: Partial<VisitRecord> = {}): VisitRecord => ({
  id: `MV-${day}`,
  storeCode: "900001",
  storeName: "Тест магазин 900001",
  city: "Тестоград",
  channel: null,
  at: `${day}T${time}`,
  day,
  month: "2026-11",
  person: "TSM_TST_1 - Тест Первый",
  template: "Тестовая анкета",
  status: "Выполнено",
  percent: null,
  creator: null,
  doneAt: null,
  taskStatus: null,
  problems: 0,
  problemList: [],
  photos: 1,
  answers: [{ q: STORE_OPEN_QUESTION, a: "Да" }],
  unanswered: [],
  ...extra,
});

const oos = (day: string, time: string): OosRecord => ({
  id: `OOS-${day}`,
  storeCode: "900001",
  storeName: "Тест магазин 900001",
  city: "Тестоград",
  channel: null,
  at: `${day}T${time}`,
  day,
  month: "2026-11",
  person: "TSM_TST_1 - Тест Первый",
  missing: 0,
  low: 0,
  orderCreated: false,
  orderNo: null,
  delivery: null,
  skus: {},
});

describe("Smart Up visits from the route analysis", () => {
  it("reads the TSMs' zones: planned made, not made, still ahead, out of plan", () => {
    const { visits, days } = visitsFromRoutes(ROUTES, PERIOD);
    // The 12th is still ahead (O): no visit yet, so not a plan missed.
    expect(days).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(
      visits
        .map((v) => [v.id, v.planned, v.planDay, v.factDay])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      // A joint visit (the TSM's «PD» and a supervisor's «U») is the planned visit.
      ["route|TSM_TST_1|900001|2026-11-09", true, "2026-11-09", "2026-11-09"],
      // Planned and not made; the supervisor's own visit that day is one out of plan.
      ["route|TSM_TST_1|900001|2026-11-10", true, "2026-11-10", null],
      ["route|TSM_TST_1|900001|2026-11-10|u", false, null, "2026-11-10"],
      ["route|TSM_TST_1|900001|2026-11-11", false, null, "2026-11-11"],
      ["route|TSM_TST_1|900002|2026-11-09", true, "2026-11-09", "2026-11-09"],
    ]);
    expect(visits[0]).toMatchObject({
      person: "TSM_TST_1",
      city: "TSM_TST_1",
      organization: "Тестоград",
      storeCode: "900001",
      storeName: "Тест магазин 900001",
      day: "2026-11-09",
      month: "2026-11",
      start: null,
      finish: null,
    });
    expect(visits.every(isRouteVisit)).toBe(true);
    expect(isRouteVisit({ id: "7001" })).toBe(false);
  });

  it("leaves the days that have a visit detail to it", () => {
    const { visits, days } = visitsFromRoutes(ROUTES, {
      ...PERIOD,
      covered: new Set(["2026-11-09", "2026-11-10"]),
    });
    expect(days).toEqual(["2026-11-11"]);
    expect(visits.map((v) => v.day)).toEqual(["2026-11-11"]);
  });

  it("never says «not during the visit»: there is no time to check against", () => {
    const { visits } = visitsFromRoutes(ROUTES, PERIOD);
    const visit = visits.find((v) => v.id === "route|TSM_TST_1|900001|2026-11-09")!;
    // Late in the evening: the same store and day is enough.
    const late = mv("2026-11-09", "23:40");
    const check = checkVisit(
      visit,
      finalMarketVisits([late]).get(storeDay("900001", "2026-11-09")),
      finalOosChecks([oos("2026-11-09", "23:50")]).get(storeDay("900001", "2026-11-09")),
    );
    expect(check).toMatchObject({
      status: "ok",
      issues: [],
      mvInTime: null,
      oosInTime: null,
      otherEmployee: false,
    });
    // By someone else is still seen.
    const other = checkVisit(
      visit,
      finalMarketVisits([mv("2026-11-09", "10:00", { person: "TSM_TST_2 - Тест Второй" })]).get(
        storeDay("900001", "2026-11-09"),
      ),
      undefined,
    );
    expect(other.issues).toEqual(["noOos", "otherEmployee"]);
  });

  it("keeps such visits out of the «during the visit» share", () => {
    const { visits, days } = visitsFromRoutes(ROUTES, PERIOD);
    const analysis = analyzeVisits({
      suVisits: visits,
      routeDays: days,
      mv: [mv("2026-11-09", "23:40")],
      oos: [oos("2026-11-09", "23:50")],
      orders: [],
      people: [],
    });
    const v = visitSections(analysis).visits;
    expect(v).toMatchObject({
      // 900001 on the 9th and 10th, 900002 on the 9th; the 12th is still ahead.
      planned: 3,
      visited: 2,
      notVisited: 1,
      unplanned: 2,
      withConnect: 1,
      allGood: 1,
      timed: 0,
      inTime: 0,
    });
    expect(v.status.notInTime).toBe(0);
    expect(tsmRows(analysis, ["TSM_TST_1"])[0]).toMatchObject({
      planned: 3,
      visited: 2,
      withConnect: 1,
      timed: 0,
    });
  });
});
