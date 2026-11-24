import { addDays, daysBetween, formatMonth, isDateString, startOfWeek } from "@/lib/dates";
import { currentLocale, intlLocale, t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { formatRange } from "@/modules/reports/format";
import { presetPeriod } from "@/modules/reports/period";

import { ismBlock, paymentIssues } from "./analytics";
import { linkedPositionCodes, managerTree, type Hierarchy } from "./hierarchy";
import { connectInsights } from "./insights";
import { personCode, titleKey } from "./parse";
import type { StaffFilter } from "./routes";
import { buildRoutesBlock, loadRouteSource, routeZones } from "./routes-report";
import type { RecoveryBase } from "./recovery";
import {
  connectDataDate,
  connectPeopleLinks,
  connectPositionLinks,
  loadHierarchy,
  loadConnectRules,
  loadPayments,
  loadVisitData,
} from "./service";
import {
  analyzeVisits,
  regionRows,
  tsmCodes,
  tsmDetail,
  tsmInfo,
  tsmRows,
  visitSections,
} from "./visits";

// What the Connect analytics page and its downloads show: the level, the period and the TSM come
// from the query string, so a download gives exactly what is on the screen.

export const VIEWS = ["exec", "manager", "executor"] as const;
export type ConnectView = (typeof VIEWS)[number];

// The period chips; own dates are the rest. Without a choice: the latest week that has data.
export const PERIOD_PRESETS = ["week", "lastWeek", "month", "lastMonth"] as const;
export type ConnectPreset = (typeof PERIOD_PRESETS)[number];

export type ConnectQuery = {
  view: ConnectView;
  preset: ConnectPreset | null;
  from: string | null;
  to: string | null;
  // A TSM code.
  person: string | null;
  // «Маршруты и дисциплина»: only KT&G's field staff or only the distributor's reps (no value:
  // everyone).
  staff?: Exclude<StaffFilter, "all">;
  // «Восстановление наличия» against the store's first check of the month; without it, against
  // the check before.
  base?: RecoveryBase;
};

export function parseConnectQuery(
  query: Record<string, string | string[] | undefined>,
  canLead: boolean,
): ConnectQuery {
  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const view = VIEWS.find((v) => v === one("view"));
  let from = one("from");
  let to = one("to");
  // Own dates: both, real, at most a year.
  const custom = Boolean(from && to && isDateString(from) && isDateString(to));
  if (custom && from! > to!) [from, to] = [to, from];
  const own = custom && daysBetween(from!, to!) <= 366;
  return {
    // Employees only see the executor level.
    view: canLead ? (view ?? "exec") : "executor",
    preset: own ? null : (PERIOD_PRESETS.find((p) => p === one("preset")) ?? null),
    from: own ? from! : null,
    to: own ? to! : null,
    person: personCode(one("person")),
    staff: (["TSM", "DR"] as const).find((s) => s === one("staff")?.toUpperCase()),
    ...(one("base") === "month" ? { base: "month" as const } : {}),
  };
}

export type ConnectPeriod = { from: string; to: string; preset: ConnectPreset | null };

// The period on the screen: own dates, a chip, or (nothing chosen) the week of the latest data —
// shown as «Эта неделя» / «Прошлая неделя» when it is one of them.
export function connectPeriod(
  query: Pick<ConnectQuery, "preset" | "from" | "to">,
  today: string,
  dataDate: string | null,
): ConnectPeriod {
  if (query.from && query.to) return { from: query.from, to: query.to, preset: null };
  if (query.preset) return { ...presetPeriod(query.preset, today), preset: query.preset };
  const monday = startOfWeek(dataDate && dataDate < today ? dataDate : today);
  if (monday === startOfWeek(today)) return { ...presetPeriod("week", today), preset: "week" };
  if (monday === addDays(startOfWeek(today), -7))
    return { ...presetPeriod("lastWeek", today), preset: "lastWeek" };
  return { from: monday, to: addDays(monday, 6), preset: null };
}

const sameCode = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

// The TSM codes linked to a person (links by the bot's full name mean its code).
export function linkedCodes(links: Record<string, string>, userIds: Set<string> | null) {
  const codes: string[] = [];
  for (const [key, userId] of Object.entries(links)) {
    const code = personCode(key);
    if (code && (!userIds || userIds.has(userId)) && !codes.some((c) => sameCode(c, code)))
      codes.push(code);
  }
  return codes;
}

// The TSM a link points to, for the executor cards: by code, else by an old full-name link.
export function linkOf(links: Record<string, string>, code: string) {
  const key = Object.keys(links).find((k) => sameCode(personCode(k) ?? "", code));
  return key ? links[key]! : null;
}

// Positions of the employee info linked to people in the app (title → user) and the hierarchy
// they are in: a person linked to a position sees every TSM under it.
export type PositionAccess = { links: Record<string, string>; hierarchy: Hierarchy | null };

// The links and the hierarchy, read once for a page or a download.
export async function loadConnectAccess() {
  const [people, links, hierarchy] = await Promise.all([
    connectPeopleLinks(),
    connectPositionLinks(),
    loadHierarchy(),
  ]);
  return { people, positions: { links, hierarchy } satisfies PositionAccess };
}

// An employee (not the owner or a manager) sees only their own list once TSM codes or positions
// are linked to people in the app: `own` is their codes and those under their positions (maybe
// none). Before any link exists the level works as before, with a choice of TSM (`own` null).
export function scopeConnectQuery(
  query: ConnectQuery,
  canLead: boolean,
  links: Record<string, string>,
  userId: string,
  positions: PositionAccess = { links: {}, hierarchy: null },
): { query: ConnectQuery; own: string[] | null } {
  if (canLead || (!Object.keys(links).length && !Object.keys(positions.links).length))
    return { query, own: null };
  const me = new Set([userId]);
  const own: string[] = [];
  for (const code of [
    ...linkedCodes(links, me),
    ...linkedPositionCodes(positions.hierarchy, positions.links, me),
  ])
    if (!own.some((c) => titleKey(c) === titleKey(code))) own.push(code);
  const person =
    query.person && own.some((c) => titleKey(c) === titleKey(query.person!))
      ? query.person
      : (own[0] ?? null);
  return { query: { ...query, view: "executor", person }, own };
}

// Which TSMs the owner or a manager sees on the managers' and executors' levels (by the org
// chart): the owner and the people named in «Роли и доступ» every one (null); a manager those linked to people of their team or to
// themselves, or under positions linked to them (every linked one with «all tasks» in the role
// settings). A TSM linked to nobody is for the owner to link.
export function leadScope(
  actor: Pick<Actor, "id" | "role" | "access">,
  links: Record<string, string>,
  positions: PositionAccess = { links: {}, hierarchy: null },
): Set<string> | null {
  if (actor.role === "OWNER" || actor.access?.connectLead) return null;
  const scope = actor.access?.taskScope ?? "all";
  const team = scope === "all" ? null : new Set([actor.id, ...(actor.access?.teamIds ?? [])]);
  return new Set([
    ...linkedCodes(links, team),
    ...linkedPositionCodes(positions.hierarchy, positions.links, team),
  ]);
}

// Codes compared by titleKey («BDM_99» is the position «BDM 99»); each scope's keys made once.
const scopeKeys = new WeakMap<Set<string>, Set<string>>();
function inScope(scope: Set<string> | null, code: string | null) {
  if (!scope) return true;
  if (!code) return false;
  let keys = scopeKeys.get(scope);
  if (!keys) scopeKeys.set(scope, (keys = new Set([...scope].map(titleKey))));
  return keys.has(titleKey(code));
}

export async function buildConnectReport(
  query: ConnectQuery,
  today: string,
  // The TSMs this person may see on the managers' and executors' levels (null: all).
  scope: Set<string> | null = null,
  options: {
    // The positions (undefined: read here; null: none).
    hierarchy?: Hierarchy | null;
    // An employee's own list: always one TSM's list, the first with data when none is chosen.
    own?: boolean;
  } = {},
) {
  const dataDate = await connectDataDate();
  const period = connectPeriod(query, today, dataDate);
  const months = { from: period.from.slice(0, 7), to: period.to.slice(0, 7) };
  // Smart Up's route analysis: «Маршруты и дисциплина», and the TSMs' visits of the days no
  // visit detail is loaded for.
  const routeSource = await loadRouteSource(period, options.hierarchy);
  const { hierarchy } = routeSource;
  // The owner's lines («Нормы»): the targets of the routes and of «Требует внимания».
  const [data, payments, rules] = await Promise.all([
    loadVisitData(period, routeSource),
    loadPayments(months),
    loadConnectRules(),
  ]);
  const analysis = analyzeVisits(data);
  const codes = tsmCodes(data).filter((code) => inScope(scope, code));
  // Zones known only by their route (the distributor's reps) can be chosen as well.
  const zones = routeZones(routeSource, period, scope);
  const routeOnly = zones.filter((z) => !codes.some((c) => titleKey(c) === titleKey(z.zone)));
  // «Требует внимания»: how much of their plan each TSM visited (none without routes).
  const attendance = zones.length
    ? new Map(
        zones.flatMap((z) =>
          z.kind === "TSM" && z.attendance !== null ? [[z.zone, z.attendance] as const] : [],
        ),
      )
    : null;
  const choice = [...codes, ...routeOnly.map((z) => z.zone)];
  const chosen = query.person && choice.find((c) => titleKey(c) === titleKey(query.person!));
  const person = chosen || (options.own && query.view === "executor" ? (choice[0] ?? null) : null);
  const routes = await buildRoutesBlock(routeSource, {
    period,
    query: { ...query, person },
    scope,
    visitDays: data.routeDays,
    targets: { attendance: rules.attendance, hitRate: rules.hitRate },
  });
  const paymentsOf = (allowed: Set<string> | null) =>
    payments.filter((p) => inScope(allowed, personCode(p.person)));
  const empty =
    !data.suVisits.length &&
    !data.mv.length &&
    !data.oos.length &&
    !data.orders.length &&
    !payments.length &&
    !routes;
  const managerRows = query.view === "manager" ? tsmRows(analysis, codes) : [];
  const execRows = query.view === "exec" ? tsmRows(analysis, tsmCodes(data)) : [];
  const execSections = query.view === "exec" ? visitSections(analysis) : null;
  // Recovery of stock, the distributor's orders after an OOS, who needs attention, the change.
  const insights = empty
    ? null
    : await connectInsights({
        view: query.view,
        base: query.base ?? "prev",
        period,
        data,
        scope,
        person,
        hierarchy,
        rows: query.view === "exec" ? execRows : managerRows,
        sections: execSections,
        attendance,
        rules,
      });
  return {
    query: { ...query, person },
    period,
    months,
    dataDate,
    // The last day of the sales loaded (null: no sales, no cross-check).
    salesDate: data.salesRange?.to ?? null,
    empty,
    insights,
    people: [
      ...codes.map((code) => tsmInfo(data, code)),
      ...routeOnly.map((z) => ({
        code: z.zone,
        name: z.person,
        zone: null,
        region: z.organization,
      })),
    ],
    exec:
      query.view === "exec" && execSections
        ? {
            routes,
            sections: execSections,
            regions: regionRows(execRows),
            ism: ismBlock(payments, today),
          }
        : null,
    manager:
      query.view === "manager"
        ? {
            routes,
            sections: visitSections(analysis, scope),
            people: managerRows,
            // By the employee info, when one is uploaded.
            tree: hierarchy ? managerTree(hierarchy, managerRows, scope) : null,
            ism: ismBlock(paymentsOf(scope), today),
          }
        : null,
    executor:
      query.view === "executor" && person
        ? {
            routes,
            row: tsmRows(analysis, [person])[0]!,
            sections: visitSections(analysis, new Set([person])),
            detail: tsmDetail(analysis, person),
            payments: paymentIssues(paymentsOf(new Set([person]))),
          }
        : null,
    // Without a TSM: everyone's numbers, for the executor level's overview.
    executors: query.view === "executor" && !person ? tsmRows(analysis, codes) : null,
  };
}
export type ConnectReport = Awaited<ReturnType<typeof buildConnectReport>>;

// --- Formatting shared by the page and the downloads ----------------------------------------

export function formatMoney(value: number) {
  const n = (x: number, digits: number) =>
    new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(x);
  if (Math.abs(value) >= 1e9) return `${n(value / 1e9, 2)} ${t("connect.bln")} ${t("connect.sum")}`;
  if (Math.abs(value) >= 1e6) return `${n(value / 1e6, 1)} ${t("connect.mln")} ${t("connect.sum")}`;
  return `${n(value, 0)} ${t("connect.sum")}`;
}

export const formatNumber = (value: number) => new Intl.NumberFormat(intlLocale()).format(value);

export const monthLabel = (month: string) => formatMonth(`${month}-01`);

// «2–8 нояб.» for the period on screen.
export const periodLabel = (period: { from: string; to: string }, today: string) =>
  formatRange(period.from, period.to, today);

// «ноябрь 2026» or «октябрь 2026 – ноябрь 2026» for the ISM block's months.
export function monthsLabel(months: { from: string; to: string }) {
  // Inside a Russian sentence a month is written in lower case.
  const name = (month: string) => {
    const label = monthLabel(month);
    return currentLocale() === "ru" ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  };
  return months.from === months.to
    ? name(months.from)
    : `${name(months.from)} – ${name(months.to)}`;
}

// The query string for links and downloads, without empty values.
export function connectHref(
  base: string,
  query: ConnectQuery,
  change: Partial<Record<string, string | null>> = {},
) {
  const params = new URLSearchParams();
  const values: Record<string, string | null | undefined> = {
    view: query.view,
    preset: query.preset,
    from: query.from,
    to: query.to,
    person: query.person,
    staff: query.staff,
    base: query.base,
    ...change,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
