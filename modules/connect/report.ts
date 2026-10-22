import { formatMonth } from "@/lib/dates";
import { intlLocale, t } from "@/lib/i18n";

import { executiveView, executorView, listPeople, managerView, type Insight } from "./analytics";
import { connectFacets, loadDataset, type ConnectFilter } from "./service";

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

// Months of the period that have data (for the trend), in order.
export function periodMonths(all: string[], filter: ConnectFilter) {
  return all.filter((m) => (!filter.from || m >= filter.from) && (!filter.to || m <= filter.to));
}

export async function buildConnectReport(query: ConnectQuery, today: string) {
  const [facets, data] = await Promise.all([connectFacets(), loadDataset(query.filter)]);
  const months = periodMonths(facets.months, query.filter);
  const people = listPeople(data);
  const person = query.person && people.includes(query.person) ? query.person : null;
  const empty =
    !data.oos.length && !data.orders.length && !data.payments.length && !data.visits.length;
  return {
    query: { ...query, person },
    facets,
    months,
    people,
    empty,
    exec: query.view === "exec" ? executiveView(data, months) : null,
    manager: query.view === "manager" ? managerView(data, today) : null,
    executor: query.view === "executor" && person ? executorView(data, person, today) : null,
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

export function insightText(insight: Insight) {
  const params = { ...insight.params };
  if (insight.key === "waiting") params.sum = formatMoney(Number(params.sum));
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
