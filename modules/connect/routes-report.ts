import { previousPeriod } from "@/modules/reports/period";

import type { Hierarchy } from "./hierarchy";
import { titleKey, type RecordOf } from "./parse";
import type { ConnectQuery } from "./report";
import {
  analyzeRoutes,
  GRADE_ORDER,
  gradeRouteLists,
  listStoreCodes,
  type RouteAnalysis,
  type RouteTargets,
  type RouteZone,
  type StaffFilter,
} from "./routes";
import { isOrder, isVisit, routeDays, staffKind } from "./route-codes";
import {
  loadClients,
  loadHierarchy,
  loadLastSales,
  loadRoutes,
  loadSalesGroups,
  routesDataDate,
} from "./service";
import {
  idleStores,
  soldStores,
  sortIdle,
  zoneSales,
  type RouteStore,
  type ZoneSales,
} from "./zone-sales";

// «Маршруты и дисциплина» for the Connect analytics page and its downloads: what is loaded for a
// period and the block each level shows.

export type RouteSource = {
  // The route analysis of the period and of the one before it (for «изменение»).
  routes: RecordOf<"ROUTE">[];
  hierarchy: Hierarchy | null;
  // The last day the loaded route analysis covers.
  dataDate: string | null;
};

// `hierarchy`: the positions when the caller has them (undefined: read here; null: none).
export async function loadRouteSource(
  period: { from: string; to: string },
  hierarchy?: Hierarchy | null,
): Promise<RouteSource> {
  const [routes, positions, dataDate] = await Promise.all([
    loadRoutes({ from: previousPeriod(period).from, to: period.to }),
    hierarchy === undefined ? loadHierarchy() : hierarchy,
    routesDataDate(),
  ]);
  return { routes, hierarchy: positions, dataDate };
}

// The zones with a route in the period that the viewer may see: they can be chosen on the
// executors' level like the TSMs of the visit data.
export function routeZones(
  source: RouteSource,
  period: { from: string; to: string },
  scope: Set<string> | null,
): RouteZone[] {
  if (!source.routes.length) return [];
  return analyzeRoutes(source.routes, { ...period, hierarchy: source.hierarchy, scope }).zones;
}

export type RoutesBlock = {
  level: ConnectQuery["view"];
  staff: StaffFilter;
  dataDate: string | null;
  // For the links of the block: the staff switch and a zone's own list.
  query: ConnectQuery;
  analysis: RouteAnalysis;
  // The executors' level: the chosen zone.
  zone: RouteZone | null;
  // «Продажи по зонам»: the sales report next to the shown zones (null: no sales loaded for the
  // period).
  sales: ZoneSales | null;
  // The days of the period whose Smart Up visits are read from the route analysis.
  visitDays: string[];
};

// The sales of the shown zones: each zone's route stores of the period, and the sums by rep and
// by responsible TSM.
async function salesOf(
  source: RouteSource,
  analysis: RouteAnalysis,
  period: { from: string; to: string },
): Promise<ZoneSales | null> {
  const { groups, legacy } = await loadSalesGroups(period, previousPeriod(period));
  if (!groups.some((g) => g.period === "now")) return null;
  // Each zone's stores of the period, with the visits and the orders the route shows for them.
  const stores = new Map<string, Map<string, RouteStore>>();
  const reps = new Map<string, string>();
  for (const route of source.routes) {
    if (!route.person) continue;
    const key = titleKey(route.person);
    if (!reps.has(key) && staffKind(route.person, source.hierarchy) === "DR")
      reps.set(key, route.person);
    const days = routeDays(route, period.from, period.to);
    if (!days.length) continue;
    let ofZone = stores.get(key);
    if (!ofZone) stores.set(key, (ofZone = new Map()));
    let store = ofZone.get(route.storeCode);
    if (!store)
      ofZone.set(
        route.storeCode,
        (store = { store: route.storeName, organization: route.city, visits: 0, orders: 0 }),
      );
    for (const { code } of days) {
      if (isVisit(code)) store.visits += 1;
      if (isOrder(code)) store.orders += 1;
    }
  }
  const sales = zoneSales({
    zones: analysis.zones,
    clients: new Map([...stores].map(([zone, list]) => [zone, new Set(list.keys())])),
    groups,
    repZones: [...reps.values()],
    legacy,
  });
  const idle = idleStores({ zones: analysis.zones, stores, sold: soldStores(groups) });
  // When each of them last bought before the period: how long it has been.
  const lastSales = await loadLastSales([...new Set(idle.map((s) => s.storeCode))], period.from);
  return {
    ...sales,
    idle: idle.map((s) => ({
      ...s,
      lastSale: lastSales.get(s.storeCode) ?? null,
      grade: null,
      equipment: null,
    })),
  };
}

// More stores than this in the lists: the whole client base is read instead of a long list.
const MAX_CLIENT_CODES = 5000;

// The block of a level, or null when the viewer has no route in the period: leadership sees
// every zone, managers theirs, an executor the chosen one.
export async function buildRoutesBlock(
  source: RouteSource,
  options: {
    period: { from: string; to: string };
    // With the chosen person.
    query: ConnectQuery;
    scope: Set<string> | null;
    visitDays?: string[];
    // The owner's targets (the standard ones without them).
    targets?: RouteTargets;
  },
): Promise<RoutesBlock | null> {
  const { period, query, scope } = options;
  if (!source.routes.length) return null;
  if (query.view === "executor" && !query.person) return null;
  const staff: StaffFilter = query.view === "executor" ? "all" : (query.staff ?? "all");
  const analysis = analyzeRoutes(source.routes, {
    ...period,
    hierarchy: source.hierarchy,
    scope:
      query.view === "exec" ? null : query.view === "executor" ? new Set([query.person!]) : scope,
    staff,
    targets: options.targets,
  });
  if (!analysis.totals.all.clients) return null;
  const sales = await salesOf(source, analysis, period);
  const codes = [
    ...new Set([...listStoreCodes(analysis), ...(sales?.idle ?? []).map((s) => s.storeCode)]),
  ];
  const clients = codes.length
    ? await loadClients(codes.length > MAX_CLIENT_CODES ? undefined : codes)
    : new Map<string, RecordOf<"CLIENT">>();
  return {
    level: query.view,
    staff,
    dataDate: source.dataDate,
    query,
    analysis: gradeRouteLists(analysis, clients),
    // The stores without a sale get their grade and equipment, the biggest first.
    sales: sales && {
      ...sales,
      idle: sortIdle(
        sales.idle.map((store) => {
          const client = clients.get(store.storeCode);
          return client ? { ...store, grade: client.grade, equipment: client.equipment } : store;
        }),
        GRADE_ORDER,
      ),
    },
    zone:
      query.view === "executor"
        ? (analysis.zones.find((z) => titleKey(z.zone) === titleKey(query.person!)) ?? null)
        : null,
    visitDays: options.visitDays ?? [],
  };
}
