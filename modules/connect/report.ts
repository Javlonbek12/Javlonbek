import { addDays, addMonths, formatMonth, startOfMonth } from "@/lib/dates";
import { intlLocale, t } from "@/lib/i18n";
import { formatRange, plural } from "@/modules/reports/format";

import {
  connectKpis,
  executiveView,
  executorView,
  listPeople,
  managerView,
  type Insight,
} from "./analytics";
import { connectDataDate, connectFacets, loadDataset, type ConnectFilter } from "./service";

// What the Connect analytics page and its downloads show: the level, filters and person
// come from the query string, so a download gives exactly what is on the screen.

export const VIEWS = ["exec", "manager", "executor"] as const;
export type ConnectView = (typeof VIEWS)[number];

const MONTH = /^\d{4}-\d{2}$/;

export type ConnectQuery = {
  view: ConnectView;
  filter: ConnectFilter;
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
  if (from && !MONTH.test(from)) from = undefined;
  if (to && !MONTH.test(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    // Employees only see the executor level.
    view: canLead ? (view ?? "exec") : "executor",
    filter: { from, to, city: one("city"), channel: one("channel") },
    person: one("person") ?? null,
  };
}

// An employee (not the owner or a manager) sees only their own list once names from the bot are
// linked to people in the app: `own` is their names (maybe none). Before any link exists the level
// works as before, with a choice of name (`own` null).
export function scopeConnectQuery(
  query: ConnectQuery,
  canLead: boolean,
  links: Record<string, string>,
  userId: string,
): { query: ConnectQuery; own: string[] | null } {
  if (canLead || !Object.keys(links).length) return { query, own: null };
  const own = Object.entries(links)
    .filter(([, id]) => id === userId)
    .map(([name]) => name);
  const person = query.person && own.includes(query.person) ? query.person : (own[0] ?? null);
  return { query: { ...query, view: "executor", person }, own };
}

// Months of the period that have data (for the trend), in order.
export function periodMonths(all: string[], filter: ConnectFilter) {
  return all.filter((m) => (!filter.from || m >= filter.from) && (!filter.to || m <= filter.to));
}

const month = (date: string) => date.slice(0, 7);

// The period chips: this month, last month, the last three months, all time (no months).
export const PERIOD_PRESETS = ["month", "lastMonth", "quarter", "all"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export function presetMonths(preset: PeriodPreset, today: string) {
  const current = startOfMonth(today);
  switch (preset) {
    case "month":
      return { from: month(current), to: month(current) };
    case "lastMonth":
      return { from: month(addMonths(current, -1)), to: month(addMonths(current, -1)) };
    case "quarter":
      return { from: month(addMonths(current, -2)), to: month(current) };
    case "all":
      return { from: undefined, to: undefined };
  }
}

// The chip that matches the chosen months; null for own months.
export function activePreset(filter: ConnectFilter, today: string): PeriodPreset | null {
  return (
    PERIOD_PRESETS.find((p) => {
      const m = presetMonths(p, today);
      return m.from === filter.from && m.to === filter.to;
    }) ?? null
  );
}

// The same number of months right before the chosen ones (for «к прошлому месяцу»); none for
// all time or an open-ended period.
export function previousMonths(filter: ConnectFilter) {
  if (!filter.from || !filter.to) return null;
  const count =
    (Number(filter.to.slice(0, 4)) - Number(filter.from.slice(0, 4))) * 12 +
    Number(filter.to.slice(5)) -
    Number(filter.from.slice(5)) +
    1;
  const first = `${filter.from}-01`;
  return { from: month(addMonths(first, -count)), to: month(addMonths(first, -1)), count };
}

// The data's last month is partial when the data stops before the month's end: «1–7 нояб.».
export function partialMonth(dataDate: string | null) {
  if (!dataDate) return null;
  const end = addDays(addMonths(startOfMonth(dataDate), 1), -1);
  return dataDate < end ? month(dataDate) : null;
}

export async function buildConnectReport(query: ConnectQuery, today: string) {
  const previous = query.view === "exec" ? previousMonths(query.filter) : null;
  const [facets, data, dataDate, before] = await Promise.all([
    connectFacets(),
    loadDataset(query.filter),
    connectDataDate(),
    previous ? loadDataset({ ...query.filter, ...previous }) : null,
  ]);
  const months = periodMonths(facets.months, query.filter);
  const people = listPeople(data);
  const person = query.person && people.includes(query.person) ? query.person : null;
  const empty =
    !data.oos.length && !data.orders.length && !data.payments.length && !data.visits.length;
  const hasBefore =
    before &&
    (before.oos.length || before.orders.length || before.payments.length || before.visits.length);
  return {
    query: { ...query, person },
    facets,
    months,
    people,
    empty,
    dataDate,
    partial: partialMonth(dataDate),
    // The previous period of the same length, when there is data for it.
    previous: previous && hasBefore ? { ...previous, kpis: connectKpis(before) } : null,
    exec: query.view === "exec" ? executiveView(data, months) : null,
    manager: query.view === "manager" ? managerView(data, today) : null,
    executor: query.view === "executor" && person ? executorView(data, person, today) : null,
    // Without a person: everyone's open items, for the executor level's overview.
    executors:
      query.view === "executor" && !person
        ? people.map((p) => ({ person: p, ...executorView(data, p, today) }))
        : null,
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

// A month's short label on charts; the data's partial last month shows its days («1–7 нояб.»).
export function monthShortLabel(value: string, dataDate: string | null) {
  if (dataDate && partialMonth(dataDate) === value)
    return formatRange(`${value}-01`, dataDate, dataDate);
  return monthLabel(value).slice(0, 3);
}

export function insightText(insight: Insight) {
  const params = { ...insight.params };
  const count = Number(params.count);
  if (insight.key === "waiting") {
    params.sum = formatMoney(Number(params.sum));
    params.count = plural("connect.words.requests", count);
  }
  if (insight.key === "topSku") params.count = plural("connect.words.checks", count);
  return t(`connect.insight.${insight.key}`, params);
}

// "May 2026 – October 2026" for the chosen (or whole) period.
export function periodLabel(report: Pick<ConnectReport, "months" | "query">) {
  const from = report.query.filter.from ?? report.months[0];
  const to = report.query.filter.to ?? report.months.at(-1);
  if (!from || !to) return "—";
  return from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
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
    from: query.filter.from,
    to: query.filter.to,
    city: query.filter.city,
    channel: query.filter.channel,
    person: query.person,
    ...change,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
