import { formatNumber } from "@/lib/format";
import { t, type TranslationKey } from "@/lib/i18n";

import type { Finding, RuleId } from "./findings";
import { isMonth, METRICS, type Metric } from "./types";

// How S&OP's numbers and findings are written on the pages and in the Excel file: one place, so
// both say the same.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11" → «Nov'26»: the way the workbook itself names its months, in every language.
export function monthLabel(month: string): string {
  if (!isMonth(month)) return month;
  return `${MONTHS[Number(month.slice(5)) - 1]}'${month.slice(2, 4)}`;
}

// Cases: whole above a hundred, one decimal below («5 546», «12,5»).
export const cases = (value: number) => formatNumber(value, Math.abs(value) >= 100 ? 0 : 1);
// Months of stock: one decimal.
export const coverText = (value: number | null) => (value === null ? "—" : formatNumber(value, 1));

const isMetric = (value: unknown): value is Metric =>
  typeof value === "string" && (METRICS as readonly string[]).includes(value);

export const metricName = (metric: Metric) => t(`sop.metrics.${metric}`);

const ONE_DECIMAL = new Set(["cover", "min", "max", "peak"]);
const WHOLE = new Set(["fill", "count", "row", "limit"]);

// A finding's numbers as the texts take them: months as the sheet names them, columns by their
// names, cases and months of stock rounded.
function textParams(values: Record<string, string | number | undefined>) {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (typeof value === "string")
      params[key] = isMonth(value)
        ? monthLabel(value)
        : isMetric(value)
          ? metricName(value)
          : value;
    else if (key === "percent") params[key] = `${value > 0 ? "+" : ""}${formatNumber(value, 0)}`;
    else if (ONE_DECIMAL.has(key)) params[key] = formatNumber(value, 1);
    else if (WHOLE.has(key)) params[key] = formatNumber(value, 0);
    else params[key] = cases(value);
  }
  return params;
}

export type FindingText = {
  // The rule in a few words, why it matters and what to do.
  name: string;
  why: string;
  todo: string;
  // What it is about when it is not one SKU (a factory, a row of totals, the whole sheet).
  subject: string;
  // The finding's own numbers: a summary line and a line per month.
  line: string;
  rows: string[];
};

const key = (rule: RuleId, part: string) => `sop.rules.${rule}.${part}` as TranslationKey;

export function ruleName(rule: RuleId, params: Finding["params"] = {}): string {
  return t(key(rule, "name"), textParams(params));
}

export function describeFinding(finding: Finding): FindingText {
  const { rule } = finding;
  // The texts may name the finding's month even when it is only in its rows.
  const params = textParams({ month: finding.rows[0]?.month, ...finding.params });
  const lineKey =
    rule === "subtotal" && finding.params.known === 0
      ? "lineUnknown"
      : rule === "slowStock" && Number(finding.params.cover) >= 999
        ? "lineNoSales"
        : "line";
  const rowTemplate = t(key(rule, "row"));
  return {
    name: t(key(rule, "name"), params),
    why: t(key(rule, "why"), params),
    todo: t(key(rule, "do"), params),
    subject:
      finding.sku?.name ??
      (typeof finding.params.name === "string"
        ? finding.params.name
        : typeof finding.params.label === "string"
          ? `«${finding.params.label}»`
          : (finding.factory ?? t("sop.findings.wholeSheet"))),
    line: t(key(rule, lineKey), params),
    rows: rowTemplate
      ? finding.rows.map((row) =>
          t(key(rule, "row"), { ...params, ...textParams(row as Record<string, string | number>) }),
        )
      : [],
  };
}
