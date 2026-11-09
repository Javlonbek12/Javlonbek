import { addDays, daysBetween, formatMonth, isDateString, startOfWeek } from "@/lib/dates";
import { currentLocale, intlLocale, t } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";
import { formatRange } from "@/modules/reports/format";
import { presetPeriod } from "@/modules/reports/period";

import { ismBlock, paymentIssues } from "./analytics";
import { personCode } from "./parse";
import { connectDataDate, loadPayments, loadVisitData } from "./service";
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

// An employee (not the owner or a manager) sees only their own list once TSM codes are linked to
// people in the app: `own` is their codes (maybe none). Before any link exists the level works
// as before, with a choice of TSM (`own` null).
export function scopeConnectQuery(
  query: ConnectQuery,
  canLead: boolean,
  links: Record<string, string>,
  userId: string,
): { query: ConnectQuery; own: string[] | null } {
  if (canLead || !Object.keys(links).length) return { query, own: null };
  const own = linkedCodes(links, new Set([userId]));
  const person =
    query.person && own.some((c) => sameCode(c, query.person!)) ? query.person : (own[0] ?? null);
  return { query: { ...query, view: "executor", person }, own };
}

// Which TSMs the owner or a manager sees on the managers' and executors' levels (by the org
// chart): the owner every one (null); a manager those linked to people of their team or to
// themselves, or every linked one with «all tasks» in the role settings. A TSM linked to nobody is
// for the owner to link.
export function leadScope(
  actor: Pick<Actor, "id" | "role" | "access">,
  links: Record<string, string>,
): Set<string> | null {
  if (actor.role === "OWNER") return null;
  const scope = actor.access?.taskScope ?? "all";
  const team = scope === "all" ? null : new Set([actor.id, ...(actor.access?.teamIds ?? [])]);
  return new Set(linkedCodes(links, team));
}

const inScope = (scope: Set<string> | null, code: string | null) =>
  !scope || Boolean(code && [...scope].some((s) => sameCode(s, code)));

export async function buildConnectReport(
  query: ConnectQuery,
  today: string,
  // The TSMs this person may see on the managers' and executors' levels (null: all).
  scope: Set<string> | null = null,
) {
  const dataDate = await connectDataDate();
  const period = connectPeriod(query, today, dataDate);
  const months = { from: period.from.slice(0, 7), to: period.to.slice(0, 7) };
  const [data, payments] = await Promise.all([loadVisitData(period), loadPayments(months)]);
  const analysis = analyzeVisits(data);
  const codes = tsmCodes(data).filter((code) => inScope(scope, code));
  const person =
    query.person && codes.some((c) => sameCode(c, query.person!))
      ? codes.find((c) => sameCode(c, query.person!))!
      : null;
  const paymentsOf = (allowed: Set<string> | null) =>
    payments.filter((p) => inScope(allowed, personCode(p.person)));
  const empty =
    !data.suVisits.length &&
    !data.mv.length &&
    !data.oos.length &&
    !data.orders.length &&
    !payments.length;
  return {
    query: { ...query, person },
    period,
    months,
    dataDate,
    empty,
    people: codes.map((code) => tsmInfo(data, code)),
    exec:
      query.view === "exec"
        ? {
            sections: visitSections(analysis),
            regions: regionRows(tsmRows(analysis, tsmCodes(data))),
            ism: ismBlock(payments, today),
          }
        : null,
    manager:
      query.view === "manager"
        ? {
            sections: visitSections(analysis, scope),
            people: tsmRows(analysis, codes),
            ism: ismBlock(paymentsOf(scope), today),
          }
        : null,
    executor:
      query.view === "executor" && person
        ? {
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
    ...change,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
