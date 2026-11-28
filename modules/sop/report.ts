import {
  buildContext,
  coverOf,
  demandAt,
  isDelist,
  round,
  skuStats,
  totalsByMonth,
  valueOf,
  type SkuStats,
  type SopContext,
  type TotalsMonth,
} from "./calc";
import { shipmentCaps, type CapRow } from "./caps";
import { findIssues, MATERIAL_LEFTOVER_MIN, type Finding, type Severity } from "./findings";
import {
  exciseStamps,
  factoryMonths,
  orderHints,
  type FactoryPlan,
  type OrderHint,
  type StampMonth,
} from "./order";
import type { SopSettings } from "./settings";
import type { SopKind, SopMaterial, SopModel } from "./types";

// Everything the pages of «S&OP» show for one upload, counted in one place so that the page, the
// Excel file and the tests see the same numbers. Pure: the uploads come from service.ts.

export type MaterialRow = SopMaterial & {
  // Cases of materials the six months of the plan do not use (below zero: more is planned than
  // there are materials for).
  leftover: number;
  flag: "delist" | "leftover" | null;
  skuKey: string | null;
};

export type Overview = {
  // The month whose materials are ordered now and its order, by factory.
  ordering: { month: string; po: number; byFactory: { factory: string; po: number }[] } | null;
  // Stocks at the end of the closed month and how many months of sales they are.
  entity: { stock: number; cover: number | null };
  dist: { stock: number; cover: number | null };
  // The closed month's sales against what the upload before forecast for it.
  closed: {
    month: string;
    sellIn: number;
    sellThru: number;
    forecastSellIn: number | null;
    forecastSellThru: number | null;
  } | null;
  counts: Record<Severity, number>;
};

export type SopReport = {
  ctx: SopContext;
  months: { cycle: string; closed: string | null; horizon: string[]; frozen: string[] };
  findings: Finding[];
  stats: SkuStats[];
  totals: TotalsMonth[];
  factories: FactoryPlan[];
  hints: OrderHint[];
  stamps: StampMonth[];
  caps: CapRow[];
  materials: MaterialRow[] | null;
  overview: Overview;
};

export type ReportInput = {
  model: SopModel;
  cycle: string;
  kind: SopKind;
  settings: SopSettings;
  // The upload before this one (see baselineOf in service.ts).
  baseline: { model: SopModel; cycle: string } | null;
  today: string;
};

const nameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

export function materialRows(model: SopModel): MaterialRow[] | null {
  if (!model.materials) return null;
  return model.materials.rows.map((row) => {
    const leftover = round((row.totalBox ?? 0) - (row.planTotal ?? 0));
    const sku = model.skus.find(
      (s) => s.factory === row.factory && nameKey(s.name) === nameKey(row.name),
    );
    const has = (row.totalBox ?? 0) >= 1;
    return {
      ...row,
      leftover,
      flag:
        has && isDelist(row.status)
          ? "delist"
          : has && leftover >= MATERIAL_LEFTOVER_MIN
            ? "leftover"
            : null,
      skuKey: sku?.key ?? null,
    };
  });
}

export function buildSopReport(input: ReportInput): SopReport {
  const { model, settings, baseline } = input;
  const ctx = buildContext(model, settings, input.cycle, input.kind);
  const findings = findIssues(ctx, baseline);
  const totals = totalsByMonth(ctx);
  const { m1 } = ctx;

  const stockAt = (metric: "entityStock" | "distStock") =>
    m1 >= 0 ? round(model.skus.reduce((total, s) => total + valueOf(s, metric, m1), 0)) : 0;
  const demand = m1 >= 0 ? model.skus.reduce((total, sku) => total + demandAt(sku, m1), 0) : 0;
  const forecastOf = (metric: "sellIn" | "sellThru"): number | null => {
    // Only when the upload before had this month as a forecast.
    if (!baseline || m1 < 0 || baseline.cycle > model.months[m1]!) return null;
    const j = baseline.model.months.indexOf(model.months[m1]!);
    if (j < 0) return null;
    return round(baseline.model.skus.reduce((total, sku) => total + valueOf(sku, metric, j), 0));
  };
  const factories = factoryMonths(ctx);
  const ordering = ctx.ordering;

  return {
    ctx,
    months: {
      cycle: ctx.cycle,
      closed: m1 >= 0 ? model.months[m1]! : null,
      horizon: ctx.horizon.map((i) => model.months[i]!),
      frozen: ctx.frozen.map((i) => model.months[i]!),
    },
    findings,
    stats: model.skus.map((sku) => skuStats(ctx, sku)),
    totals,
    factories,
    hints: orderHints(ctx),
    stamps: exciseStamps(ctx, input.today),
    caps: shipmentCaps(ctx),
    materials: materialRows(model),
    overview: {
      ordering:
        ordering === null
          ? null
          : {
              month: model.months[ordering]!,
              po: totals[ordering]!.po,
              byFactory: factories
                .map((f) => ({
                  factory: f.factory,
                  po: f.months.find((x) => x.month === model.months[ordering])?.po ?? 0,
                }))
                .filter((f) => f.po > 0),
            },
      entity: { stock: stockAt("entityStock"), cover: coverOf(stockAt("entityStock"), demand) },
      dist: { stock: stockAt("distStock"), cover: coverOf(stockAt("distStock"), demand) },
      closed:
        m1 >= 0
          ? {
              month: model.months[m1]!,
              sellIn: totals[m1]!.sellIn,
              sellThru: totals[m1]!.sellThru,
              forecastSellIn: forecastOf("sellIn"),
              forecastSellThru: forecastOf("sellThru"),
            }
          : null,
      counts: {
        error: findings.filter((f) => f.severity === "error").length,
        risk: findings.filter((f) => f.severity === "risk").length,
        note: findings.filter((f) => f.severity === "note").length,
      },
    },
  };
}
