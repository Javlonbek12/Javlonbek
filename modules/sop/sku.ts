import {
  coverOf,
  demandAt,
  isDelist,
  isNotLaunched,
  ownStocks,
  valueOf,
  type SkuStats,
} from "./calc";
import type { Finding } from "./findings";
import type { OrderHint } from "./order";
import type { MaterialRow, SopReport } from "./report";

// One SKU's card: its months (a year of actuals and the plan), its findings, the order hint with
// its arithmetic, its materials and the split of Sell-in by channel. Pure.

export type SkuMonth = {
  month: string;
  forecast: boolean;
  frozen: boolean;
  ordering: boolean;
  po: number;
  plan: number;
  out: number;
  sellIn: number;
  sellThru: number;
  factoryStock: number;
  // Own stocks; the file's number when it says something else (undefined: the same; null: the
  // file's cell is empty).
  entity: number;
  dist: number;
  fileEntity?: number | null;
  fileDist?: number | null;
  cover: { entity: number | null; dist: number | null; total: number | null };
};

export type SkuCard = {
  stats: SkuStats;
  months: SkuMonth[];
  findings: Finding[];
  hint: OrderHint | null;
  // Why there is no hint.
  noHint: "delist" | "notLaunched" | "noDemand" | "beyond" | null;
  material: MaterialRow | null;
  // The closed months whose Sell-in is typed as «=distributor+KA».
  split: { month: string; distributor: number; ka: number }[];
};

const HISTORY = 12;
// How many closed months the table of numbers shows (the chart has the whole year).
export const TABLE_HISTORY = 6;

export function skuCard(report: SopReport, key: string): SkuCard | null {
  const { ctx } = report;
  const sku = ctx.model.skus.find((s) => s.key === key);
  const stats = report.stats.find((s) => s.key === key);
  if (!sku || !stats) return null;
  const own = ownStocks(ctx, sku);
  const last = ctx.horizon.at(-1) ?? ctx.m;
  const months: SkuMonth[] = [];
  for (let i = Math.max(0, ctx.m - HISTORY); i <= last; i++) {
    const forecast = i >= ctx.m;
    const entity = own.entity[i] ?? 0;
    const dist = own.dist[i] ?? 0;
    const factoryStock = valueOf(sku, "factoryStock", i);
    const demand = demandAt(sku, i);
    const differs = (mine: number, theirs: number | null | undefined) =>
      forecast && Math.abs(mine - (theirs ?? 0)) > 1 ? (theirs ?? null) : undefined;
    months.push({
      month: ctx.model.months[i]!,
      forecast,
      frozen: ctx.frozen.includes(i),
      ordering: ctx.ordering === i,
      po: valueOf(sku, "po", i),
      plan: valueOf(sku, "plan", i),
      out: valueOf(sku, "out", i),
      sellIn: valueOf(sku, "sellIn", i),
      sellThru: valueOf(sku, "sellThru", i),
      factoryStock,
      entity,
      dist,
      fileEntity: differs(entity, sku.values.entityStock[i]),
      fileDist: differs(dist, sku.values.distStock[i]),
      cover: {
        entity: coverOf(entity, demand),
        dist: coverOf(dist, demand),
        total: coverOf(factoryStock + entity + dist, demand),
      },
    });
  }
  const hint = report.hints.find((h) => h.key === key) ?? null;
  const split = ctx.model.months
    .map((month, i) => ({ month, parts: i < ctx.m ? sku.parts[`sellIn:${i}`] : undefined }))
    .filter((x) => x.parts && x.parts.length >= 2)
    .slice(-HISTORY)
    .map((x) => ({ month: x.month, distributor: x.parts![0]!, ka: x.parts![1]! }));
  return {
    stats,
    months,
    findings: report.findings.filter(
      (f) => f.sku?.key === key || f.skus.some((s) => s.key === key),
    ),
    hint,
    noHint: hint
      ? null
      : isDelist(sku.status)
        ? "delist"
        : isNotLaunched(sku.status)
          ? "notLaunched"
          : ctx.horizon.length <= ctx.frozen.length
            ? "beyond"
            : "noDemand",
    material: report.materials?.find((row) => row.skuKey === key) ?? null,
    split,
  };
}
