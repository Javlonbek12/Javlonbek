import type { SkuStats } from "./calc";
import { isChecklistItem } from "./calendar";
import { RULES, type Finding, type Severity } from "./findings";

// The filters of «Ошибки и риски» and «Запасы и прогноз», read from the page's address. Pure.

export type FindingsFilter = {
  severity: Severity | null;
  factory: string | null;
  // A part of an SKU's name or code.
  q: string;
  hideMarked: boolean;
  // Only the findings behind this point of the checklist.
  item: number | null;
  // Only one SKU (its key).
  sku: string | null;
};

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export function parseFindingsFilter(
  params: Record<string, string | string[] | undefined>,
): FindingsFilter {
  const severity = one(params.severity);
  const item = Number(one(params.item));
  return {
    severity: severity === "error" || severity === "risk" || severity === "note" ? severity : null,
    factory: one(params.factory).toUpperCase().slice(0, 20) || null,
    q: one(params.q).slice(0, 100),
    hideMarked: one(params.hide) === "1",
    item: isChecklistItem(item) ? item : null,
    sku: one(params.sku).slice(0, 300) || null,
  };
}

export function filterFindings(
  findings: Finding[],
  filter: FindingsFilter,
  marked: ReadonlySet<string>,
): Finding[] {
  const q = filter.q.toLowerCase();
  const matches = (sku: { name: string; code: string }) =>
    sku.name.toLowerCase().includes(q) || sku.code.toLowerCase().includes(q);
  return findings.filter((f) => {
    if (filter.severity && f.severity !== filter.severity) return false;
    if (filter.factory && f.factory !== filter.factory) return false;
    if (filter.hideMarked && marked.has(f.key)) return false;
    if (filter.item !== null && RULES[f.rule].checklist !== filter.item) return false;
    if (filter.sku && f.sku?.key !== filter.sku && !f.skus.some((s) => s.key === filter.sku))
      return false;
    if (q && !(f.sku && matches(f.sku)) && !f.skus.some(matches)) return false;
    return true;
  });
}

export const STOCK_VIEWS = ["all", "short", "excess", "slow", "fresh", "leaving"] as const;
export type StockView = (typeof STOCK_VIEWS)[number];

export const parseStockView = (value: string | string[] | undefined): StockView =>
  STOCK_VIEWS.find((view) => view === one(value)) ?? "all";

export function inStockView(stats: SkuStats, view: StockView): boolean {
  switch (view) {
    case "short":
      return stats.short;
    case "excess":
      return stats.excess;
    case "slow":
      return stats.slow;
    case "fresh":
      return stats.isNew;
    case "leaving":
      return stats.leaving;
    default:
      return true;
  }
}

export function filterStock(stats: SkuStats[], view: StockView, search: string): SkuStats[] {
  const q = search.trim().toLowerCase();
  return stats.filter(
    (s) =>
      inStockView(s, view) &&
      (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)),
  );
}
