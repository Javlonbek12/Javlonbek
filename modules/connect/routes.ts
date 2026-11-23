import { fromDateString, startOfWeek } from "@/lib/dates";
import { previousPeriod } from "@/modules/reports/period";

import { ownerOf, type Hierarchy } from "./hierarchy";
import { titleKey, type ClientRecord, type RouteRecord } from "./parse";
import {
  addRouteCode,
  emptyRouteCounts,
  isVisit,
  routeDays,
  routeRates,
  staffKind,
  type RouteCounts,
  type RouteDay,
  type StaffKind,
} from "./route-codes";
import { DEFAULT_RULES } from "./rules";

// «Маршруты и дисциплина»: Smart Up's route analysis as pure functions (rules of 23.11.2026, see
// docs/DECISIONS.md). A row of the analysis is one client of a working zone for a month with a
// code per day; here they become totals, days, weekdays, zones, the «Visit × Hitting» matrix and
// the lists of stores to act on. Attendance is planned visits made of those planned; hit rate is
// visits with an order of all visits made, and only the distributor's reps (DR) have one: TSMs
// take no orders.

// The standard targets; the owner sets their own on «Нормы» (rules.ts).
export const ROUTE_TARGETS: RouteTargets = {
  attendance: DEFAULT_RULES.attendance,
  hitRate: DEFAULT_RULES.hitRate,
};
export type RouteTargets = { attendance: number; hitRate: number };

// Whose routes are shown: everyone's, KT&G's field staff or the distributor's reps.
export const STAFF_FILTERS = ["all", "TSM", "DR"] as const;
export type StaffFilter = (typeof STAFF_FILTERS)[number];

// A store is in the «missed» list after this many planned visits not made in a row, and in the
// «no order» list after this many visits of a DR without one.
export const MISSED_IN_A_ROW = 2;
export const NO_ORDER_VISITS = 3;

// The client base's grades, the biggest stores first; a store without a grade comes last.
export const GRADE_ORDER = ["XL+", "XL", "L", "LT", "M", "S"] as const;

export type RouteSummary = RouteCounts & { attendance: number | null; hitRate: number | null };

// Against the previous period of the same length, in percentage points (null: nothing to
// compare with).
type Deltas = { attendanceDelta: number | null; hitRateDelta: number | null };

export type RouteTotals = RouteSummary &
  Deltas & {
    zones: number;
    // Clients of a zone with any code in the period (a store on two routes counts twice).
    clients: number;
    // Planned and not visited once in the period.
    neverVisited: number;
    // A DR's clients visited in the period without a single order.
    noOrder: number;
  };

// Both rates reach the targets / one is below / both are below.
export type MatrixClass = "ok" | "one" | "both";
export const MATRIX_CLASSES = ["ok", "one", "both"] as const;

export type RouteZone = RouteSummary &
  Deltas & {
    zone: string;
    kind: StaffKind;
    // Who works the zone and who is above them, by the employee info.
    person: string | null;
    manager: string | null;
    managerPerson: string | null;
    organization: string | null;
    clients: number;
    neverVisited: number;
    noOrder: number;
    // DR zones with both rates; null otherwise.
    class: MatrixClass | null;
  };

export type RouteOrganization = RouteSummary &
  Deltas & {
    organization: string | null;
    kind: StaffKind;
    zones: number;
    clients: number;
    class: MatrixClass | null;
    // How many of its DR zones are in each class.
    classes: Record<MatrixClass, number>;
  };

export type RouteDayRow = RouteSummary & { day: string };

export type WeekdayCell = {
  day: string;
  planned: number;
  attendance: number | null;
  hitRate: number | null;
};
export type WeekdayTable = {
  // The Mondays of the weeks that have data.
  weeks: string[];
  // 1 = Monday … 7 = Sunday; a cell per week (null: no such day in the data).
  rows: { weekday: number; cells: (WeekdayCell | null)[] }[];
};

type ListStore = {
  zone: string;
  kind: StaffKind;
  person: string | null;
  organization: string | null;
  storeCode: string;
  store: string;
  grade: string | null;
  equipment: string | null;
};
export type MissedStore = ListStore & {
  misses: number;
  // The days of the planned visits not made, in order.
  days: string[];
  // The last visit of any kind in the period.
  lastVisit: string | null;
};
export type NoOrderStore = ListStore & { visits: number; lastVisit: string | null };

// A zone's day: planned visits, those made, all visits made and those with an order.
export type DayCounts = Pick<RouteCounts, "planned" | "visited" | "visits" | "orders">;

export type RouteAnalysis = {
  from: string;
  to: string;
  // The targets the classes and the colours are counted against.
  targets: RouteTargets;
  staff: StaffFilter;
  previous: { from: string; to: string };
  // Within the scope, whatever the staff filter.
  totals: Record<StaffFilter, RouteTotals>;
  // The rest follows the staff filter.
  days: RouteDayRow[];
  weekdays: WeekdayTable;
  // TSM zones, then DR zones; the lowest attendance first.
  zones: RouteZone[];
  organizations: RouteOrganization[];
  // The DR zones' «Visit × Hitting»: the averages and how many zones are in each class (null: no
  // DR zone shown). The points are `zones` with a class.
  matrix: {
    average: { attendance: number | null; hitRate: number | null };
    classes: Record<MatrixClass, number>;
  } | null;
  // TSM zones by attendance, the lowest first (they have no matrix: no orders).
  ranking: RouteZone[];
  // «Календарь»: each shown zone's counts day by day (by zone, then by day), for the grid of
  // zones × days.
  calendar: Record<string, Record<string, DayCounts>>;
  missed: MissedStore[];
  noOrder: NoOrderStore[];
};

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const plus = (a: RouteCounts, b: RouteCounts): RouteCounts => ({
  planned: a.planned + b.planned,
  visited: a.visited + b.visited,
  missed: a.missed + b.missed,
  unplanned: a.unplanned + b.unplanned,
  upcoming: a.upcoming + b.upcoming,
  visits: a.visits + b.visits,
  orders: a.orders + b.orders,
});

// Counts kept apart by whose zone it is: attendance is of both, the hit rate only the DRs'.
type Bucket = Record<StaffKind, RouteCounts>;
const emptyBucket = (): Bucket => ({ TSM: emptyRouteCounts(), DR: emptyRouteCounts() });
const summarize = (bucket: Bucket): RouteSummary => {
  const all = plus(bucket.TSM, bucket.DR);
  return {
    ...all,
    attendance: routeRates(all).attendance,
    hitRate: routeRates(bucket.DR).hitRate,
  };
};

const delta = (now: number | null, before: number | null) =>
  now === null || before === null ? null : Math.round((now - before) * 10) / 10;
const deltas = (now: RouteSummary, before: RouteSummary): Deltas => ({
  attendanceDelta: delta(now.attendance, before.attendance),
  hitRateDelta: delta(now.hitRate, before.hitRate),
});

export function matrixClass(
  attendance: number | null,
  hitRate: number | null,
  targets: RouteTargets = ROUTE_TARGETS,
): MatrixClass | null {
  if (attendance === null || hitRate === null) return null;
  const below = Number(attendance < targets.attendance) + Number(hitRate < targets.hitRate);
  return MATRIX_CLASSES[below]!;
}
const emptyClasses = (): Record<MatrixClass, number> => ({ ok: 0, one: 0, both: 0 });

// 1 = Monday … 7 = Sunday.
export const weekdayOf = (day: string) => ((fromDateString(day).getUTCDay() + 6) % 7) + 1;

type ZoneState = {
  key: string;
  zone: string;
  kind: StaffKind;
  days: Map<string, RouteCounts>;
  now: Bucket;
  before: Bucket;
  organizations: Map<string | null, number>;
  clients: number;
  neverVisited: number;
  noOrder: number;
};
type ClientState = {
  zone: ZoneState;
  storeCode: string;
  store: string;
  organization: string | null;
  days: RouteDay[];
};

// The people of a zone by the employee info: the position with the zone's title (or the deepest
// one listing it among its working zones) and the position above it.
function zonePeople(hierarchy: Hierarchy | null, zone: string) {
  const key = hierarchy ? ownerOf(hierarchy, zone) : null;
  const node = key ? hierarchy!.nodes.get(key) : undefined;
  const parent = node?.parent ? hierarchy!.nodes.get(node.parent) : undefined;
  const names = (positions: { user: string | null }[]) =>
    [...new Set(positions.map((p) => p.user).filter((u): u is string => Boolean(u)))].join(", ") ||
    null;
  return {
    person: node ? names(node.positions) : null,
    manager: parent?.title ?? null,
    managerPerson: parent ? names(parent.positions) : null,
  };
}

export function analyzeRoutes(
  routes: RouteRecord[],
  options: {
    // The period's days, inclusive (YYYY-MM-DD).
    from: string;
    to: string;
    hierarchy?: Hierarchy | null;
    // The zones the viewer may see (null: all), compared by titleKey.
    scope?: Set<string> | null;
    staff?: StaffFilter;
    // The owner's targets (the standard ones without them).
    targets?: RouteTargets;
  },
): RouteAnalysis {
  const { from, to, hierarchy = null, scope = null, staff = "all" } = options;
  const targets = options.targets ?? ROUTE_TARGETS;
  const previous = previousPeriod({ from, to });
  const allowed = scope ? new Set([...scope].map(titleKey)) : null;
  const shown = (kind: StaffKind) => staff === "all" || staff === kind;

  // Every client of a zone once: a period over two months has a row per month, and a client has
  // a row per employee who visits it (the zone's own and a supervisor on a joint visit). Their
  // codes are all counted, as Smart Up's own totals do.
  const zones = new Map<string, ZoneState | null>();
  const clients = new Map<string, ClientState>();
  for (const route of routes) {
    if (!route.person) continue;
    const key = titleKey(route.person);
    if (allowed && !allowed.has(key)) continue;
    let zone = zones.get(key);
    if (zone === undefined) {
      const kind = staffKind(route.person, hierarchy);
      zone = kind && {
        key,
        zone: route.person,
        kind,
        days: new Map(),
        now: emptyBucket(),
        before: emptyBucket(),
        organizations: new Map(),
        clients: 0,
        neverVisited: 0,
        noOrder: 0,
      };
      zones.set(key, zone);
    }
    // The office's zone is nobody's route.
    if (!zone) continue;
    for (const d of routeDays(route, previous.from, previous.to))
      addRouteCode(zone.before[zone.kind], d.code);
    const days = routeDays(route, from, to);
    if (!days.length) continue;
    zone.organizations.set(route.city, (zone.organizations.get(route.city) ?? 0) + 1);
    const clientKey = `${key}|${route.storeCode}`;
    const client = clients.get(clientKey);
    if (client) client.days.push(...days);
    else
      clients.set(clientKey, {
        zone,
        storeCode: route.storeCode,
        store: route.storeName,
        organization: route.city,
        days,
      });
  }

  const byDay = new Map<string, Bucket>();
  const people = new Map<string, ReturnType<typeof zonePeople>>();
  const peopleOf = (zone: ZoneState) => {
    let found = people.get(zone.key);
    if (!found) people.set(zone.key, (found = zonePeople(hierarchy, zone.zone)));
    return found;
  };
  const missed: MissedStore[] = [];
  const noOrder: NoOrderStore[] = [];
  for (const client of clients.values()) {
    const { zone } = client;
    // In order; on a day with two rows a visit comes after a miss (the store was visited).
    const days = client.days.sort(
      (a, b) => a.day.localeCompare(b.day) || Number(isVisit(a.code)) - Number(isVisit(b.code)),
    );
    const counts = emptyRouteCounts();
    // Planned visits not made in a row up to the last planned day; any visit starts over.
    let streak: string[] = [];
    let lastVisit: string | null = null;
    for (const { day, code } of days) {
      addRouteCode(counts, code);
      addRouteCode(zone.now[zone.kind], code);
      let ofDay = zone.days.get(day);
      if (!ofDay) zone.days.set(day, (ofDay = emptyRouteCounts()));
      addRouteCode(ofDay, code);
      if (shown(zone.kind)) {
        let bucket = byDay.get(day);
        if (!bucket) byDay.set(day, (bucket = emptyBucket()));
        addRouteCode(bucket[zone.kind], code);
      }
      if (code === "X") streak.push(day);
      else if (isVisit(code)) {
        streak = [];
        lastVisit = day;
      }
    }
    zone.clients += 1;
    const withoutOrder = zone.kind === "DR" && counts.visits > 0 && counts.orders === 0;
    if (counts.planned > 0 && counts.visits === 0) zone.neverVisited += 1;
    if (withoutOrder) zone.noOrder += 1;
    if (!shown(zone.kind)) continue;
    const store = {
      zone: zone.zone,
      kind: zone.kind,
      person: peopleOf(zone).person,
      organization: client.organization,
      storeCode: client.storeCode,
      store: client.store,
      grade: null,
      equipment: null,
    };
    if (streak.length >= MISSED_IN_A_ROW)
      missed.push({ ...store, misses: streak.length, days: streak, lastVisit });
    if (withoutOrder && counts.visits >= NO_ORDER_VISITS)
      noOrder.push({ ...store, visits: counts.visits, lastVisit });
  }

  // Zones with something in the period (one with only earlier days is not shown).
  const active = [...zones.values()].filter((z): z is ZoneState => z !== null && z.clients > 0);
  const sumOf = (list: ZoneState[], pick: (z: ZoneState) => Bucket) =>
    list.reduce<Bucket>(
      (all, z) => ({ TSM: plus(all.TSM, pick(z).TSM), DR: plus(all.DR, pick(z).DR) }),
      emptyBucket(),
    );
  const rowOf = (z: ZoneState): RouteZone => {
    const now = summarize(z.now);
    // The most frequent organization of the zone's clients.
    const organization =
      [...z.organizations.entries()].sort(
        (a, b) => b[1] - a[1] || natural(a[0] ?? "", b[0] ?? ""),
      )[0]?.[0] ?? null;
    return {
      ...now,
      ...deltas(now, summarize(z.before)),
      zone: z.zone,
      kind: z.kind,
      ...peopleOf(z),
      organization,
      clients: z.clients,
      neverVisited: z.neverVisited,
      noOrder: z.noOrder,
      class: z.kind === "DR" ? matrixClass(now.attendance, now.hitRate, targets) : null,
    };
  };

  const totalOf = (kinds: StaffKind[]): RouteTotals => {
    const list = active.filter((z) => kinds.includes(z.kind));
    const now = summarize(sumOf(list, (z) => z.now));
    const count = (pick: (z: ZoneState) => number) => list.reduce((a, z) => a + pick(z), 0);
    return {
      ...now,
      ...deltas(now, summarize(sumOf(list, (z) => z.before))),
      zones: list.length,
      clients: count((z) => z.clients),
      neverVisited: count((z) => z.neverVisited),
      noOrder: count((z) => z.noOrder),
    };
  };
  const totals = { all: totalOf(["TSM", "DR"]), TSM: totalOf(["TSM"]), DR: totalOf(["DR"]) };

  const lowestFirst = (a: RouteZone, b: RouteZone) =>
    (a.attendance ?? 101) - (b.attendance ?? 101) ||
    b.planned - a.planned ||
    natural(a.zone, b.zone);
  const visible = active
    .filter((z) => shown(z.kind))
    .map((state) => ({ state, row: rowOf(state) }));
  const zoneRows = visible.map((z) => z.row);
  const drZones = zoneRows.filter((z) => z.kind === "DR");
  const classes = emptyClasses();
  for (const z of drZones) if (z.class) classes[z.class] += 1;

  // By organization (the «cities matrix» for the DRs): the zones' numbers summed.
  const groups = new Map<string, typeof visible>();
  for (const z of visible) {
    const key = `${z.row.kind}|${z.row.organization ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), z]);
  }
  const organizations: RouteOrganization[] = [...groups.values()]
    .map((list) => {
      const states = list.map((z) => z.state);
      const now = summarize(sumOf(states, (z) => z.now));
      const { kind, organization } = list[0]!.row;
      const inClass = emptyClasses();
      for (const z of list) if (z.row.class) inClass[z.row.class] += 1;
      return {
        ...now,
        ...deltas(now, summarize(sumOf(states, (z) => z.before))),
        organization,
        kind,
        zones: list.length,
        clients: states.reduce((a, z) => a + z.clients, 0),
        class: kind === "DR" ? matrixClass(now.attendance, now.hitRate, targets) : null,
        classes: inClass,
      };
    })
    // The worst first: the lowest attendance for the TSMs; for the reps, who visit nearly
    // everything, the lowest hit rate.
    .sort(
      (a, b) =>
        Number(a.kind === "DR") - Number(b.kind === "DR") ||
        (a.kind === "DR"
          ? (a.hitRate ?? 101) - (b.hitRate ?? 101)
          : (a.attendance ?? 101) - (b.attendance ?? 101)) ||
        b.planned - a.planned ||
        natural(a.organization ?? "", b.organization ?? ""),
    );

  const days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, bucket]) => ({ day, ...summarize(bucket) }));
  // A Monday next to the Mondays before it: the same routes are compared.
  const weeks = [...new Set(days.map((d) => startOfWeek(d.day)))];
  const weekdays = [...new Set(days.map((d) => weekdayOf(d.day)))].sort((a, b) => a - b);

  return {
    from,
    to,
    targets,
    staff,
    previous,
    totals,
    days,
    weekdays: {
      weeks,
      rows: weekdays.map((weekday) => ({
        weekday,
        cells: weeks.map((week) => {
          const d = days.find((x) => startOfWeek(x.day) === week && weekdayOf(x.day) === weekday);
          return d
            ? { day: d.day, planned: d.planned, attendance: d.attendance, hitRate: d.hitRate }
            : null;
        }),
      })),
    },
    zones: [...zoneRows].sort(
      (a, b) => Number(a.kind === "DR") - Number(b.kind === "DR") || lowestFirst(a, b),
    ),
    organizations,
    matrix: drZones.length
      ? {
          average: { attendance: totals.DR.attendance, hitRate: totals.DR.hitRate },
          classes,
        }
      : null,
    ranking: zoneRows.filter((z) => z.kind === "TSM").sort(lowestFirst),
    calendar: Object.fromEntries(
      visible.map(({ state }) => [
        state.zone,
        Object.fromEntries(
          [...state.days.entries()].map(([day, c]) => [
            day,
            { planned: c.planned, visited: c.visited, visits: c.visits, orders: c.orders },
          ]),
        ),
      ]),
    ),
    ...sortLists({ missed, noOrder }),
  };
}

const gradeRank = (grade: string | null) => {
  const at = (GRADE_ORDER as readonly string[]).indexOf((grade ?? "").trim().toUpperCase());
  return at < 0 ? GRADE_ORDER.length : at;
};

// The biggest stores first, then the longest streak; the same order every time.
function sortLists<M extends MissedStore, N extends NoOrderStore>(lists: {
  missed: M[];
  noOrder: N[];
}) {
  const same = (a: ListStore, b: ListStore) =>
    natural(a.zone, b.zone) || natural(a.store, b.store) || natural(a.storeCode, b.storeCode);
  return {
    missed: [...lists.missed].sort(
      (a, b) => gradeRank(a.grade) - gradeRank(b.grade) || b.misses - a.misses || same(a, b),
    ),
    noOrder: [...lists.noOrder].sort(
      (a, b) => gradeRank(a.grade) - gradeRank(b.grade) || b.visits - a.visits || same(a, b),
    ),
  };
}

// The store codes of the lists: what to ask the client base for.
export const listStoreCodes = (analysis: Pick<RouteAnalysis, "missed" | "noOrder">) => [
  ...new Set([...analysis.missed, ...analysis.noOrder].map((s) => s.storeCode)),
];

// The lists with the grade and the equipment of the client base (when the store is known there),
// sorted again: XL+ first.
export function gradeRouteLists(
  analysis: RouteAnalysis,
  clients: Map<string, Pick<ClientRecord, "grade" | "equipment">>,
): RouteAnalysis {
  const graded = <T extends ListStore>(store: T): T => {
    const client = clients.get(store.storeCode);
    return client ? { ...store, grade: client.grade, equipment: client.equipment } : store;
  };
  return {
    ...analysis,
    ...sortLists({
      missed: analysis.missed.map(graded),
      noOrder: analysis.noOrder.map(graded),
    }),
  };
}
