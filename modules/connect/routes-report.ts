import { previousPeriod } from "@/modules/reports/period";

import type { Hierarchy } from "./hierarchy";
import { titleKey, type RecordOf } from "./parse";
import type { ConnectQuery } from "./report";
import {
  analyzeRoutes,
  gradeRouteLists,
  listStoreCodes,
  type RouteAnalysis,
  type RouteTargets,
  type RouteZone,
  type StaffFilter,
} from "./routes";
import { loadClients, loadHierarchy, loadRoutes, routesDataDate } from "./service";

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
  // The days of the period whose Smart Up visits are read from the route analysis.
  visitDays: string[];
};

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
  const codes = listStoreCodes(analysis);
  const clients = codes.length
    ? await loadClients(codes.length > MAX_CLIENT_CODES ? undefined : codes)
    : new Map<string, RecordOf<"CLIENT">>();
  return {
    level: query.view,
    staff,
    dataDate: source.dataDate,
    query,
    analysis: gradeRouteLists(analysis, clients),
    zone:
      query.view === "executor"
        ? (analysis.zones.find((z) => titleKey(z.zone) === titleKey(query.person!)) ?? null)
        : null,
    visitDays: options.visitDays ?? [],
  };
}
