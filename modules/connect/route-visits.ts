import type { Hierarchy } from "./hierarchy";
import { titleKey, type RouteCode, type RouteRecord, type SuVisitRecord } from "./parse";
import { isUnplanned, routeDays, staffKind } from "./route-codes";

// Smart Up visits read from the route analysis, for the days no visit detail («Visit
// Detailization») is loaded for: the TSMs' zones give where they had to go and went, so «Визиты ×
// Connect Bot» still works. Such a visit has no times: «во время визита» is not checked for it.

const PREFIX = "route|";
export const isRouteVisit = (visit: Pick<SuVisitRecord, "id">) => visit.id.startsWith(PREFIX);

const isMade = (code: RouteCode) => code === "P" || code === "PD";

// One visit per zone, store and day: a planned visit made (P, PD), or one not made (X) or still
// ahead (O); a visit out of plan (U, UD) — also next to a planned one not made. A joint visit (a
// second row of the same client: the TSM's «P» and a supervisor's «U») is the planned visit.
// `covered`: the days that have a visit detail, left to it.
export function visitsFromRoutes(
  routes: RouteRecord[],
  options: {
    from: string;
    to: string;
    hierarchy?: Hierarchy | null;
    covered?: Set<string>;
  },
): { visits: SuVisitRecord[]; days: string[] } {
  const { from, to, hierarchy = null, covered = new Set<string>() } = options;
  const kinds = new Map<string, boolean>();
  const isTsm = (zone: string) => {
    const key = titleKey(zone);
    let tsm = kinds.get(key);
    if (tsm === undefined) kinds.set(key, (tsm = staffKind(zone, hierarchy) === "TSM"));
    return tsm;
  };
  const groups = new Map<string, { route: RouteRecord; day: string; codes: RouteCode[] }>();
  for (const route of routes) {
    if (!route.person || !isTsm(route.person)) continue;
    for (const { day, code } of routeDays(route, from, to)) {
      if (covered.has(day)) continue;
      const key = `${titleKey(route.person)}|${route.storeCode}|${day}`;
      const group = groups.get(key);
      if (group) group.codes.push(code);
      else groups.set(key, { route, day, codes: [code] });
    }
  }
  const visits: SuVisitRecord[] = [];
  const days = new Set<string>();
  for (const { route, day, codes } of groups.values()) {
    const made = codes.some(isMade);
    const planned = made || codes.includes("X") || codes.includes("O");
    const id = `${PREFIX}${route.person}|${route.storeCode}|${day}`;
    const visit = (plan: boolean, fact: boolean, suffix = ""): SuVisitRecord => ({
      id: `${id}${suffix}`,
      storeCode: route.storeCode,
      storeName: route.storeName,
      // As in the visit detail: the working zone, and the organization apart.
      city: route.person,
      channel: null,
      at: `${day}T00:00`,
      day,
      month: day.slice(0, 7),
      person: route.person,
      planned: plan,
      planDay: plan ? day : null,
      factDay: fact ? day : null,
      start: null,
      finish: null,
      backwall: null,
      comment: null,
      organization: route.city,
    });
    if (planned) visits.push(visit(true, made));
    if (!made && codes.some(isUnplanned)) visits.push(visit(false, true, planned ? "|u" : ""));
    days.add(day);
  }
  return { visits, days: [...days].sort() };
}
