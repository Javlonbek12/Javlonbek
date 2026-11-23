import type { Hierarchy } from "./hierarchy";
import { titleKey, type RouteCode, type RouteRecord } from "./parse";

// Smart Up's route analysis in small pieces shared by the reports: what a day's code means, whose
// working zone it is, and the days of a period. Rules of 23.11.2026 (see docs/DECISIONS.md).

// A visit was made (planned or not); it brought an order; it was planned and its day has come.
export const isVisit = (code: RouteCode) => code !== "X" && code !== "O";
export const isOrder = (code: RouteCode) => code === "PD" || code === "UD";
export const isPlanned = (code: RouteCode) => code === "P" || code === "PD" || code === "X";
export const isUnplanned = (code: RouteCode) => code === "U" || code === "UD";

// Whose working zone it is: KT&G's own field staff (TSMs, key account: they visit and check, and
// take no orders) or the distributor's sales reps (they take orders). The office's zone is nobody's
// route.
export type StaffKind = "TSM" | "DR";
const OFFICE_ZONE = /офис|office/i;
const DR_ZONE = /^dr([\s_-]|$)/i;
const DR_ROLE = /торговый представитель/i;

export function staffKind(zone: string, hierarchy?: Hierarchy | null): StaffKind | null {
  if (OFFICE_ZONE.test(zone)) return null;
  if (DR_ZONE.test(zone.trim())) return "DR";
  const roles = hierarchy?.nodes.get(titleKey(zone))?.positions.flatMap((p) => p.roles) ?? [];
  return roles.some((role) => DR_ROLE.test(role)) ? "DR" : "TSM";
}

export type RouteDay = { day: string; code: RouteCode };

// The days of a route row within from..to (inclusive, YYYY-MM-DD), in order.
export function routeDays(route: RouteRecord, from: string, to: string): RouteDay[] {
  return Object.entries(route.days)
    .map(([dayOfMonth, code]) => ({ day: `${route.month}-${dayOfMonth}`, code }))
    .filter((d) => d.day >= from && d.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export type RouteCounts = {
  // Planned visits whose day has come: made + missed.
  planned: number;
  visited: number;
  missed: number;
  unplanned: number;
  // Planned visits still ahead (the day of the export).
  upcoming: number;
  // Visits of any kind, and those that brought an order.
  visits: number;
  orders: number;
};

export const emptyRouteCounts = (): RouteCounts => ({
  planned: 0,
  visited: 0,
  missed: 0,
  unplanned: 0,
  upcoming: 0,
  visits: 0,
  orders: 0,
});

export function addRouteCode(counts: RouteCounts, code: RouteCode) {
  if (code === "O") counts.upcoming += 1;
  if (isPlanned(code)) counts.planned += 1;
  if (code === "P" || code === "PD") counts.visited += 1;
  if (code === "X") counts.missed += 1;
  if (isUnplanned(code)) counts.unplanned += 1;
  if (isVisit(code)) counts.visits += 1;
  if (isOrder(code)) counts.orders += 1;
  return counts;
}

const share = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

// Attendance: planned visits made, of those planned. Hit rate: visits that brought an order, of
// all visits made (the distributor's reps only: TSMs take no orders).
export const routeRates = (c: RouteCounts) => ({
  attendance: share(c.visited, c.planned),
  hitRate: share(c.orders, c.visits),
});
