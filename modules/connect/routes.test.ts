import { describe, expect, it } from "vitest";

import { buildHierarchy } from "./hierarchy";
import type { PositionRecord, RouteCode, RouteRecord } from "./parse";
import {
  analyzeRoutes,
  gradeRouteLists,
  listStoreCodes,
  matrixClass,
  ROUTE_TARGETS,
  weekdayOf,
} from "./routes";

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
  day: "2026-11-15",
  month: "2026-11",
  person: zone,
  staff: zone,
  days,
  ...extra,
});

let nextId = 1;
const position = (
  title: string,
  manager: string | null,
  extra: Partial<PositionRecord> = {},
): PositionRecord => ({
  id: String(nextId++),
  storeCode: "",
  storeName: "",
  city: null,
  channel: null,
  at: "",
  day: "",
  month: "",
  person: null,
  title,
  user: `Тест ${title}`,
  zones: [],
  roles: [],
  manager,
  created: null,
  status: "Активный",
  ...extra,
});

// BDM 99 → TSM_TST_1, TSM_TST_2; the distributor's supervisor → DR_TST_1, DR_TST_2 and a rep
// whose zone is not called «DR» (known by the role).
const hierarchy = buildHierarchy([
  position("BDM 99", null, { user: "Тест Руководитель" }),
  position("TSM_TST_1", "BDM 99", { user: "Тест Первый" }),
  position("TSM_TST_2", "BDM 99", { user: "Тест Второй" }),
  position("Supervisor TST (Тест дистрибьютор)", null, { user: "Тест Супервайзер" }),
  position("DR_TST_1", "Supervisor TST (Тест дистрибьютор)", { user: "Тест Агент 1" }),
  position("DR_TST_2", "Supervisor TST (Тест дистрибьютор)", { user: "Тест Агент 2" }),
  position("Agent TST 1", "Supervisor TST (Тест дистрибьютор)", {
    user: "Тест Агент 3",
    roles: ["Торговый представитель"],
  }),
]);

// The week of 9–15 November (the week before it is the previous period).
const WEEK = { from: "2026-11-09", to: "2026-11-15" };
const ROUTES: RouteRecord[] = [
  route("TSM_TST_1", 900001, { "02": "P", "03": "X", "09": "P", "10": "X", "11": "P" }),
  route("TSM_TST_1", 900002, { "09": "X", "12": "X", "14": "X" }),
  route("TSM_TST_1", 900003, { "10": "X", "11": "U", "13": "X" }),
  route("TSM_TST_2", 900004, { "09": "P", "10": "P", "11": "P", "12": "P" }),
  route("DR_TST_1", 900001, {
    "02": "PD",
    "03": "P",
    "09": "PD",
    "10": "PD",
    "11": "P",
    "12": "UD",
  }),
  route("DR_TST_1", 900005, { "09": "P", "11": "P", "13": "P" }),
  route("DR_TST_1", 900006, { "10": "P", "12": "U" }),
  route("DR_TST_1", 900007, { "13": "X", "14": "X", "15": "O" }),
  route(
    "DR_TST_2",
    900008,
    { "09": "PD", "10": "PD", "11": "PD", "12": "PD" },
    { city: "Тестобад" },
  ),
  route("Agent TST 1", 900009, { "09": "PD", "10": "P" }, { city: "Тестобад" }),
  // Nobody's route.
  route("Тест (Office)", 900010, { "09": "P" }),
];

const analyze = (options: Partial<Parameters<typeof analyzeRoutes>[1]> = {}) =>
  analyzeRoutes(ROUTES, { ...WEEK, hierarchy, ...options });

describe("route analysis: totals", () => {
  it("counts everyone, the TSMs and the DRs; the hit rate is the DRs'", () => {
    const { totals } = analyze();
    expect(totals.TSM).toMatchObject({
      zones: 2,
      clients: 4,
      planned: 12,
      visited: 6,
      missed: 6,
      unplanned: 1,
      attendance: 50,
      // TSMs take no orders.
      hitRate: null,
      neverVisited: 1,
      noOrder: 0,
    });
    expect(totals.DR).toMatchObject({
      zones: 3,
      clients: 6,
      planned: 15,
      visited: 13,
      missed: 2,
      unplanned: 2,
      upcoming: 1,
      visits: 15,
      orders: 8,
      attendance: 86.7,
      hitRate: 53.3,
      // Planned twice, never visited; visited without a single order (two stores).
      neverVisited: 1,
      noOrder: 2,
    });
    expect(totals.all).toMatchObject({
      zones: 5,
      clients: 10,
      planned: 27,
      visited: 19,
      attendance: 70.4,
      hitRate: 53.3,
      neverVisited: 2,
      noOrder: 2,
    });
  });

  it("leaves the office's zone out", () => {
    expect(analyze().zones.map((z) => z.zone)).not.toContain("Тест (Office)");
  });

  it("compares with the previous period of the same length", () => {
    const { totals, previous } = analyze();
    expect(previous).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    // TSM: 1 of 2 before, 6 of 12 now. DR: 2 of 2 before; 1 order of 2 visits before.
    expect(totals.TSM).toMatchObject({ attendanceDelta: 0, hitRateDelta: null });
    expect(totals.DR).toMatchObject({ attendanceDelta: -13.3, hitRateDelta: 3.3 });
  });
});

describe("route analysis: days and weekdays", () => {
  it("counts each day", () => {
    const { days } = analyze();
    expect(days.map((d) => d.day)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    // Monday: 7 planned, one of them missed; 3 orders of the DRs' 4 visits.
    expect(days[0]).toMatchObject({
      planned: 7,
      visited: 6,
      missed: 1,
      attendance: 85.7,
      hitRate: 75,
    });
    // Sunday has only a visit still ahead.
    expect(days[6]).toMatchObject({ planned: 0, upcoming: 1, attendance: null, hitRate: null });
  });

  it("puts a weekday next to the same weekday of the other weeks", () => {
    const { weekdays } = analyze({ from: "2026-11-02", to: "2026-11-15" });
    expect(weekdays.weeks).toEqual(["2026-11-02", "2026-11-09"]);
    expect(weekdays.rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [monday, tuesday, wednesday] = weekdays.rows;
    expect(monday!.cells).toMatchObject([
      { day: "2026-11-02", attendance: 100, hitRate: 100 },
      { day: "2026-11-09", attendance: 85.7, hitRate: 75 },
    ]);
    expect(tuesday!.cells).toMatchObject([
      { day: "2026-11-03", attendance: 50, hitRate: 0 },
      { day: "2026-11-10", attendance: 71.4 },
    ]);
    // No Wednesday in the first week's data.
    expect(wednesday!.cells[0]).toBeNull();
    expect(weekdayOf("2026-11-09")).toBe(1);
    expect(weekdayOf("2026-11-15")).toBe(7);
  });

  it("has no hit rate in the TSMs' days", () => {
    const { days } = analyze({ staff: "TSM" });
    expect(days[0]).toMatchObject({ planned: 3, visited: 2, attendance: 66.7, hitRate: null });
  });
});

describe("route analysis: zones", () => {
  it("gives each zone its people, organization, numbers and change", () => {
    const { zones } = analyze();
    // TSMs first, then the DRs; the lowest attendance first, then the bigger plan.
    expect(zones.map((z) => z.zone)).toEqual([
      "TSM_TST_1",
      "TSM_TST_2",
      "DR_TST_1",
      "DR_TST_2",
      "Agent TST 1",
    ]);
    expect(zones[0]).toMatchObject({
      kind: "TSM",
      person: "Тест Первый",
      manager: "BDM 99",
      managerPerson: "Тест Руководитель",
      organization: "Тестоград",
      clients: 3,
      planned: 8,
      visited: 2,
      missed: 6,
      unplanned: 1,
      attendance: 25,
      hitRate: null,
      // 1 of 2 the week before.
      attendanceDelta: -25,
      hitRateDelta: null,
      neverVisited: 1,
      class: null,
    });
    // Nothing the week before: nothing to compare with.
    expect(zones[1]).toMatchObject({ attendance: 100, attendanceDelta: null });
    expect(zones[2]).toMatchObject({
      kind: "DR",
      person: "Тест Агент 1",
      manager: "Supervisor TST (Тест дистрибьютор)",
      clients: 4,
      planned: 9,
      visited: 7,
      visits: 9,
      orders: 3,
      attendance: 77.8,
      hitRate: 33.3,
      attendanceDelta: -22.2,
      hitRateDelta: -16.7,
      noOrder: 2,
      class: "both",
    });
    expect(zones[3]).toMatchObject({ attendance: 100, hitRate: 100, class: "ok" });
    // A rep by the role in the employee info, not by the zone's name.
    expect(zones[4]).toMatchObject({ kind: "DR", organization: "Тестобад", class: "one" });
  });

  it("takes a zone's people from the position that lists it among its zones", () => {
    const h = buildHierarchy([
      position("Chief TST", null, { user: "Тест Директор" }),
      position("Sales TST", "Chief TST", { user: "Тест Ключевой", zones: ["Key Account / TST"] }),
    ]);
    const [zone] = analyzeRoutes([route("Key Account / TST", 900020, { "09": "P" })], {
      ...WEEK,
      hierarchy: h,
    }).zones;
    expect(zone).toMatchObject({
      kind: "TSM",
      person: "Тест Ключевой",
      manager: "Chief TST",
      managerPerson: "Тест Директор",
    });
  });

  it("works without the employee info", () => {
    const { zones } = analyzeRoutes(ROUTES, WEEK);
    expect(zones.find((z) => z.zone === "DR_TST_1")).toMatchObject({
      kind: "DR",
      person: null,
      manager: null,
    });
    // Without the roles the zone's name is all there is.
    expect(zones.find((z) => z.zone === "Agent TST 1")?.kind).toBe("TSM");
  });

  it("counts a client once over two months and every row of a joint visit", () => {
    const a = analyzeRoutes(
      [
        route("TSM_TST_1", 900001, { "30": "X", "31": "X" }, { month: "2026-10" }),
        route("TSM_TST_1", 900001, { "02": "X", "03": "P" }),
        // The rep's own row and the supervisor's, who came along on the 2nd.
        route("DR_TST_1", 900002, { "02": "PD", "03": "X" }),
        route("DR_TST_1", 900002, { "02": "U" }, { staff: "Supervisor TST" }),
      ],
      { from: "2026-10-26", to: "2026-11-08", hierarchy },
    );
    expect(a.totals.TSM).toMatchObject({ clients: 1, planned: 4, missed: 3, visited: 1 });
    expect(a.totals.DR).toMatchObject({
      clients: 1,
      planned: 2,
      visited: 1,
      unplanned: 1,
      visits: 2,
      orders: 1,
      hitRate: 50,
    });
    // The streak of three ended with a visit.
    expect(a.missed).toEqual([]);
  });
});

describe("route analysis: the DRs' matrix", () => {
  it("classes a zone by the two targets", () => {
    const { attendance, hitRate } = ROUTE_TARGETS;
    expect(matrixClass(attendance, hitRate)).toBe("ok");
    expect(matrixClass(attendance - 0.1, hitRate)).toBe("one");
    expect(matrixClass(attendance, hitRate - 0.1)).toBe("one");
    expect(matrixClass(attendance - 0.1, hitRate - 0.1)).toBe("both");
    expect(matrixClass(null, hitRate)).toBeNull();
    expect(matrixClass(attendance, null)).toBeNull();
  });

  it("gives the averages, the classes and the same by organization", () => {
    const { matrix, organizations } = analyze();
    expect(matrix).toEqual({
      average: { attendance: 86.7, hitRate: 53.3 },
      classes: { ok: 1, one: 1, both: 1 },
    });
    expect(
      organizations.map((o) => [o.kind, o.organization, o.zones, o.attendance, o.hitRate, o.class]),
    ).toEqual([
      ["TSM", "Тестоград", 2, 50, null, null],
      ["DR", "Тестоград", 1, 77.8, 33.3, "both"],
      // 6 of 6 planned visits, 5 orders of 6 visits.
      ["DR", "Тестобад", 2, 100, 83.3, "one"],
    ]);
    expect(organizations[2]!.classes).toEqual({ ok: 1, one: 1, both: 0 });
  });

  it("ranks the TSMs by attendance instead: they have no orders", () => {
    const tsm = analyze({ staff: "TSM" });
    expect(tsm.matrix).toBeNull();
    expect(tsm.ranking.map((z) => [z.zone, z.attendance])).toEqual([
      ["TSM_TST_1", 25],
      ["TSM_TST_2", 100],
    ]);
    expect(analyze({ staff: "DR" }).ranking).toEqual([]);
  });
});

describe("route analysis: the lists", () => {
  it("lists the stores missed twice or more in a row at the end of the period", () => {
    const { missed } = analyze();
    expect(missed).toMatchObject([
      {
        zone: "TSM_TST_1",
        kind: "TSM",
        person: "Тест Первый",
        storeCode: "900002",
        store: "Тест магазин 900002",
        misses: 3,
        days: ["2026-11-09", "2026-11-12", "2026-11-14"],
        lastVisit: null,
        grade: null,
      },
      // A visit still ahead does not end the streak.
      { zone: "DR_TST_1", storeCode: "900007", misses: 2, days: ["2026-11-13", "2026-11-14"] },
    ]);
    // 900003: a visit out of plan between two misses starts the count over.
    expect(missed.map((s) => s.storeCode)).not.toContain("900003");
  });

  it("lists the DRs' stores visited three times or more without an order", () => {
    const { noOrder } = analyze();
    expect(noOrder).toMatchObject([
      { zone: "DR_TST_1", storeCode: "900005", visits: 3, lastVisit: "2026-11-13" },
    ]);
  });

  it("puts the biggest stores first once the client base gives the grades", () => {
    const a = analyze();
    expect(listStoreCodes(a).sort()).toEqual(["900002", "900005", "900007"]);
    const graded = gradeRouteLists(
      a,
      new Map([
        ["900002", { grade: "S", equipment: null }],
        ["900007", { grade: "XL+", equipment: "Display TST" }],
      ]),
    );
    expect(graded.missed.map((s) => [s.storeCode, s.grade, s.equipment])).toEqual([
      ["900007", "XL+", "Display TST"],
      ["900002", "S", null],
    ]);
    // Not in the client base: as it was.
    expect(graded.noOrder[0]).toMatchObject({ storeCode: "900005", grade: null });
    // Among equal grades the longer streak comes first; no grade comes last.
    const more = gradeRouteLists(
      analyzeRoutes(
        [
          route("TSM_TST_1", 900031, { "09": "X", "10": "X" }),
          route("TSM_TST_1", 900032, { "09": "X", "10": "X", "11": "X" }),
          route("TSM_TST_1", 900033, { "09": "X", "10": "X", "11": "X", "12": "X" }),
          route("TSM_TST_1", 900034, { "09": "X", "10": "X" }),
        ],
        WEEK,
      ),
      new Map([
        ["900031", { grade: "L", equipment: null }],
        ["900032", { grade: "L", equipment: null }],
        ["900034", { grade: "XL", equipment: null }],
      ]),
    );
    expect(more.missed.map((s) => s.storeCode)).toEqual(["900034", "900032", "900031", "900033"]);
  });
});

describe("route analysis: who sees what", () => {
  it("keeps the zones of the scope (compared like position titles)", () => {
    const a = analyze({ scope: new Set(["tsm tst 1", "DR_TST_2"]) });
    expect(a.zones.map((z) => z.zone)).toEqual(["TSM_TST_1", "DR_TST_2"]);
    expect(a.totals.all).toMatchObject({ zones: 2, clients: 4, planned: 12 });
    expect(a.totals.DR).toMatchObject({ zones: 1, attendance: 100, hitRate: 100 });
    expect(a.missed.map((s) => s.storeCode)).toEqual(["900002"]);
    expect(a.noOrder).toEqual([]);
    expect(analyze({ scope: new Set() }).totals.all.clients).toBe(0);
  });

  it("filters by staff; the totals stay for all three", () => {
    const dr = analyze({ staff: "DR" });
    expect(dr.zones.map((z) => z.kind)).toEqual(["DR", "DR", "DR"]);
    expect(dr.organizations.every((o) => o.kind === "DR")).toBe(true);
    expect(dr.days[0]).toMatchObject({ planned: 4, visited: 4, attendance: 100, hitRate: 75 });
    expect(dr.missed.map((s) => s.zone)).toEqual(["DR_TST_1"]);
    expect(dr.totals.TSM.planned).toBe(12);
    expect(dr.totals.all.planned).toBe(27);

    const tsm = analyze({ staff: "TSM" });
    expect(tsm.zones.map((z) => z.kind)).toEqual(["TSM", "TSM"]);
    expect(tsm.noOrder).toEqual([]);
    expect(tsm.missed.map((s) => s.zone)).toEqual(["TSM_TST_1"]);
    expect(tsm.totals.DR.planned).toBe(15);
  });

  it("is empty without routes in the period", () => {
    const a = analyze({ from: "2026-12-01", to: "2026-12-07" });
    expect(a.totals.all).toMatchObject({ zones: 0, clients: 0, attendance: null });
    expect(a.zones).toEqual([]);
    expect(a.days).toEqual([]);
    expect(a.matrix).toBeNull();
  });
});
