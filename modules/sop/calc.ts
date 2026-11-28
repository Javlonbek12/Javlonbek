import type { SopSettings } from "./settings";
import { addMonths, type Metric, type SopKind, type SopModel, type SopSku } from "./types";

// The engine's own arithmetic. The sheet's computed cells (stocks of the forecast months, months
// of stock) are not trusted: the balances and the cover are counted here from what was typed —
// the closed month's stocks, the shipments and the sales. Pure functions.

export type SopContext = {
  model: SopModel;
  settings: SopSettings;
  kind: SopKind;
  // M, the month being planned, and its place among the model's months.
  cycle: string;
  m: number;
  // M-1, the last closed month (-1 when the file starts at M).
  m1: number;
  // The months of the plan: M … the end of the file.
  horizon: number[];
  // The months already in production (M, M+1, M+2): not to be changed.
  frozen: number[];
  // The month whose materials are ordered at this S&OP (M + lead time); null beyond the file.
  ordering: number | null;
  // The last three closed months (fewer at the start of the file), oldest first.
  closed: number[];
};

export class SopCycleError extends Error {
  constructor() {
    super("cycle");
    this.name = "SopCycleError";
  }
}

export function buildContext(
  model: SopModel,
  settings: SopSettings,
  cycle: string,
  kind: SopKind = "OURS",
): SopContext {
  const m = model.months.indexOf(cycle);
  if (m < 0) throw new SopCycleError();
  const horizon = model.months.map((_, i) => i).slice(m, m + 12);
  const ordering = m + settings.leadTime;
  return {
    model,
    settings,
    kind,
    cycle,
    m,
    m1: m - 1,
    horizon,
    frozen: horizon.slice(0, settings.frozenMonths),
    ordering: ordering < model.months.length ? ordering : null,
    closed: [m - 3, m - 2, m - 1].filter((i) => i >= 0),
  };
}

export const valueOf = (sku: SopSku, metric: Metric, index: number): number =>
  sku.values[metric][index] ?? 0;

const clean = (text: string) => text.trim().toLowerCase();
// «Delist…»: the product is being taken off the market.
export const isDelist = (status: string) => clean(status).startsWith("delist");
// «Considering Delist» and the like: for the «выводятся» filter.
export const mentionsDelist = (status: string) => clean(status).includes("delist");
export const isNew = (status: string) => clean(status).startsWith("new");
export const isNotLaunched = (status: string) => /not\s*launched/i.test(status);

// Own stocks by month: what the file has in the closed months, and from M on the balance
// «entity = previous entity + shipped from the factory − sold to the distributor»,
// «distributor = previous distributor + sold to the distributor − sold to the market».
export function ownStocks(ctx: SopContext, sku: SopSku) {
  const entity = [...sku.values.entityStock];
  const dist = [...sku.values.distStock];
  for (const i of ctx.horizon) {
    const previousEntity = i > 0 ? (entity[i - 1] ?? 0) : 0;
    const previousDist = i > 0 ? (dist[i - 1] ?? 0) : 0;
    entity[i] = round(previousEntity + valueOf(sku, "out", i) - valueOf(sku, "sellIn", i));
    dist[i] = round(previousDist + valueOf(sku, "sellIn", i) - valueOf(sku, "sellThru", i));
  }
  return { entity, dist };
}

export const round = (value: number) => Math.round(value * 1000) / 1000;

// The demand a stock is measured against: the average Sell-thru of the month and the next two;
// at the end of the file — of the months that exist.
export function demandAt(sku: SopSku, index: number): number {
  const values = sku.values.sellThru.slice(index, index + 3);
  if (values.length === 0) return 0;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0) / values.length;
}

// How a month's stock stands against the norms. A cover is compared the way it is shown, to
// one decimal: 1.96 reads «2,0» and is not «below 2».
export function coverFlags(
  cover: { entity: number | null; dist: number | null; total: number | null },
  settings: Pick<SopSettings, "entityMin" | "distMin" | "maxTotal">,
) {
  const shown = (value: number | null) => Math.round((value ?? 0) * 10) / 10;
  return {
    entityLow: shown(cover.entity) < settings.entityMin,
    distLow: shown(cover.dist) < settings.distMin,
    high: shown(cover.total) > settings.maxTotal,
  };
}

// Months of stock; null when there is no demand to measure against.
export const coverOf = (stock: number, demand: number): number | null =>
  demand > 0.0001 ? stock / demand : null;

// The actual sales of the last closed months (up to three), counted from the product's first
// sale so that a launch in the middle of them is not averaged with empty months. Null when there
// are no closed months.
export function runRateOf(ctx: SopContext, sku: SopSku): number | null {
  if (ctx.closed.length === 0) return null;
  const firstSale = sku.values.sellThru.findIndex((v) => (v ?? 0) > 0);
  const months = ctx.closed.filter((i) => firstSale >= 0 && i >= firstSale);
  if (months.length === 0) return 0;
  return months.reduce((sum, i) => sum + valueOf(sku, "sellThru", i), 0) / months.length;
}

// The planned sales to the market: the average of M, M+1, M+2.
export function planRateOf(ctx: SopContext, sku: SopSku): number {
  const months = ctx.horizon.slice(0, 3);
  if (months.length === 0) return 0;
  return months.reduce((sum, i) => sum + valueOf(sku, "sellThru", i), 0) / months.length;
}

// The first month the product exists in: it has stock, a shipment or a sale. Before it a zero
// stock is not a shortage.
export function launchIndex(sku: SopSku, own: { entity: (number | null)[] }): number {
  const total = sku.values.sellThru.length;
  for (let i = 0; i < total; i++) {
    if (
      (own.entity[i] ?? 0) > 0 ||
      valueOf(sku, "distStock", i) > 0 ||
      valueOf(sku, "sellIn", i) > 0 ||
      valueOf(sku, "sellThru", i) > 0 ||
      valueOf(sku, "out", i) > 0
    )
      return i;
  }
  return total;
}

export type CoverMonth = {
  month: string;
  index: number;
  factoryStock: number;
  entityStock: number;
  distStock: number;
  demand: number;
  entity: number | null;
  dist: number | null;
  total: number | null;
  // Whether the stock norms apply to this month: the product sells, stays and is launched.
  judged: boolean;
};

export type SkuStats = {
  key: string;
  row: number;
  name: string;
  code: string;
  factory: string;
  type: string;
  status: string;
  delist: boolean;
  leaving: boolean;
  isNew: boolean;
  notLaunched: boolean;
  // The stocks at the end of the closed month.
  stock: { factory: number; entity: number; dist: number };
  covers: CoverMonth[];
  // The first month a stock is under its minimum, and which one.
  riskMonth: string | null;
  riskWhat: "entity" | "dist" | "both" | null;
  // The month Entity stock runs out: inside the plan, or up to three months after it when
  // nothing new is produced.
  runOut: { month: string; beyond: boolean } | null;
  runRate: number | null;
  planRate: number;
  // Plan against the actual run-rate, % (null without a run-rate).
  deviation: number | null;
  // Months the current stock lasts at the actual run-rate (null: no sales at all).
  slowCover: number | null;
  slow: boolean;
  short: boolean;
  excess: boolean;
};

// Under this demand (cases a month) a cover in months says nothing: the SKU is skipped by the
// stock norms.
export const MIN_DEMAND = 5;
// Stock under this is not worth calling slow.
export const SLOW_MIN_STOCK = 50;
// How far after the plan the stock is projected.
export const PROJECTION_MONTHS = 3;

export function skuStats(ctx: SopContext, sku: SopSku): SkuStats {
  const { settings, model } = ctx;
  const own = ownStocks(ctx, sku);
  const launch = launchIndex(sku, own);
  const delist = isDelist(sku.status);
  const covers: CoverMonth[] = ctx.horizon.map((i) => {
    const demand = demandAt(sku, i);
    const factoryStock = valueOf(sku, "factoryStock", i);
    const entityStock = own.entity[i] ?? 0;
    const distStock = own.dist[i] ?? 0;
    return {
      month: model.months[i]!,
      index: i,
      factoryStock,
      entityStock,
      distStock,
      demand,
      entity: coverOf(entityStock, demand),
      dist: coverOf(distStock, demand),
      total: coverOf(factoryStock + entityStock + distStock, demand),
      // The norms are for products that sell and stay: no «Delist…», no months before the launch.
      judged: !delist && demand >= MIN_DEMAND && i >= launch,
    };
  });
  const judged = covers.filter((c) => c.judged);
  const low = judged.find(
    (c) => coverFlags(c, settings).entityLow || coverFlags(c, settings).distLow,
  );
  const lowEntity = low ? coverFlags(low, settings).entityLow : false;
  const lowDist = low ? coverFlags(low, settings).distLow : false;

  // When Entity stock is gone: a negative month of the plan, or — nothing new produced, the
  // factory's leftover shipped, sales as in the last three months of the plan — a month after it.
  let runOut: SkuStats["runOut"] = null;
  const negative = covers.find((c) => c.entityStock < -0.5);
  if (negative) runOut = { month: negative.month, beyond: false };
  else if (covers.length > 0 && !delist) {
    const tail = covers.slice(-3);
    const demand =
      tail.reduce((sum, c) => sum + valueOf(sku, "sellThru", c.index), 0) / tail.length;
    const last = covers.at(-1)!;
    let stock = last.entityStock + last.factoryStock;
    if (demand >= 1)
      for (let step = 1; step <= PROJECTION_MONTHS; step++) {
        stock -= demand;
        if (stock < 0) {
          runOut = { month: addMonths(last.month, step), beyond: true };
          break;
        }
      }
  }

  const runRate = runRateOf(ctx, sku);
  const planRate = planRateOf(ctx, sku);
  const at = ctx.m1 >= 0 ? ctx.m1 : -1;
  const stock = {
    factory: at >= 0 ? valueOf(sku, "factoryStock", at) : 0,
    entity: at >= 0 ? valueOf(sku, "entityStock", at) : 0,
    dist: at >= 0 ? valueOf(sku, "distStock", at) : 0,
  };
  const sellable = stock.entity + stock.dist;
  const slowCover = runRate && runRate > 0 ? sellable / runRate : null;
  const notLaunched = isNotLaunched(sku.status);
  const slow =
    sellable >= SLOW_MIN_STOCK &&
    runRate !== null &&
    !notLaunched &&
    (slowCover === null ? !isNew(sku.status) : slowCover > settings.slowMonths);
  return {
    key: sku.key,
    row: sku.row,
    name: sku.name,
    code: sku.code,
    factory: sku.factory,
    type: sku.type,
    status: sku.status,
    delist,
    leaving: mentionsDelist(sku.status),
    isNew: isNew(sku.status),
    notLaunched,
    stock,
    covers,
    riskMonth: low?.month ?? null,
    riskWhat: low ? (lowEntity && lowDist ? "both" : lowEntity ? "entity" : "dist") : null,
    runOut,
    runRate,
    planRate,
    deviation: runRate && runRate > 0 ? (planRate / runRate - 1) * 100 : null,
    slowCover,
    slow,
    short: low !== undefined || negative !== undefined,
    excess: judged.some((c) => coverFlags(c, settings).high),
  };
}

// The whole sheet by month, for the overview's chart and tiles.
export type TotalsMonth = {
  month: string;
  forecast: boolean;
  po: number;
  plan: number;
  out: number;
  sellIn: number;
  sellThru: number;
  factoryStock: number;
  entityStock: number;
  distStock: number;
};

export function totalsByMonth(ctx: SopContext): TotalsMonth[] {
  const own = ctx.model.skus.map((sku) => ownStocks(ctx, sku));
  const sum = (metric: Metric, i: number) =>
    round(ctx.model.skus.reduce((total, sku) => total + valueOf(sku, metric, i), 0));
  return ctx.model.months.map((month, i) => ({
    month,
    forecast: i >= ctx.m,
    po: sum("po", i),
    plan: sum("plan", i),
    out: sum("out", i),
    sellIn: sum("sellIn", i),
    sellThru: sum("sellThru", i),
    factoryStock: sum("factoryStock", i),
    entityStock: round(own.reduce((total, o) => total + (o.entity[i] ?? 0), 0)),
    distStock: round(own.reduce((total, o) => total + (o.dist[i] ?? 0), 0)),
  }));
}
