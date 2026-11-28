import {
  coverOf,
  demandAt,
  isDelist,
  isNew,
  isNotLaunched,
  ownStocks,
  round,
  valueOf,
  type SopContext,
} from "./calc";
import { loadOf } from "./findings";
import { addMonths, type SopSku } from "./types";

// «Заказ»: what each factory makes and ships by month, a calculation hint for the months that
// can still be changed, and the excise stamps to buy. Pure functions.

// --- Factory months -----------------------------------------------------------------------------

export type FactoryMonth = {
  month: string;
  frozen: boolean;
  // The month whose materials are ordered at this S&OP.
  ordering: boolean;
  po: number;
  plan: number;
  out: number;
  // Trucks or containers of the shipment and how full the last one is (null: no size is set for
  // this factory).
  load: { count: number; lastFill: number; missing: number; size: number } | null;
  // The order of the line that runs every other month.
  regularPo: number;
  // SKUs ordered under the minimum batch.
  moqBreaches: number;
};

export type FactoryPlan = {
  factory: string;
  transport: "truck" | "container" | null;
  months: FactoryMonth[];
};

export function factoryMonths(ctx: SopContext): FactoryPlan[] {
  const { model, settings, horizon } = ctx;
  const factories = [...new Set(model.skus.map((s) => s.factory))].sort();
  const regularType = settings.regularType.trim().toLowerCase();
  return factories.map((factory) => {
    const skus = model.skus.filter((s) => s.factory === factory);
    const transport =
      factory === settings.truckFactory.toUpperCase()
        ? "truck"
        : factory === settings.containerFactory.toUpperCase()
          ? "container"
          : null;
    const size =
      transport === "truck"
        ? settings.truckCases
        : transport === "container"
          ? settings.containerCases
          : null;
    const sum = (metric: "po" | "plan" | "out", i: number, list = skus) =>
      round(list.reduce((total, s) => total + valueOf(s, metric, i), 0));
    return {
      factory,
      transport,
      months: horizon.map((i) => {
        const out = sum("out", i);
        return {
          month: model.months[i]!,
          frozen: ctx.frozen.includes(i),
          ordering: ctx.ordering === i,
          po: sum("po", i),
          plan: sum("plan", i),
          out,
          load: size && out > 0 ? { ...loadOf(out, size), size } : null,
          regularPo: sum(
            "po",
            i,
            skus.filter((s) => s.type.trim().toLowerCase() === regularType),
          ),
          moqBreaches: skus.filter((s) => {
            const po = valueOf(s, "po", i);
            return po > 0 && po < settings.moq;
          }).length,
        };
      }),
    };
  });
}

// --- Order hints --------------------------------------------------------------------------------

export type HintStep = {
  month: string;
  // Stock of all three places at the start of the month (with the hints of the months before).
  opening: number;
  filePo: number;
  sales: number;
  // What the stock would be at the end of the month with the file's order.
  closing: number;
  demand: number;
  cover: number | null;
  // Target cover × demand.
  target: number;
  // target − closing: above zero the stock is short of the target.
  gap: number;
  // The order the calculation comes to, and how it differs from the file's.
  suggested: number;
  change: number;
  action: "add" | "reduce" | "keep";
  // Short of the target, yet left alone: a minimum batch would be too much for now.
  waits: boolean;
  coverAfter: number | null;
};

export type OrderHint = {
  key: string;
  name: string;
  factory: string;
  type: string;
  status: string;
  steps: HintStep[];
  // The largest change of the three months, for sorting.
  weight: number;
};

// How far under the target (in months of sales) the stock may be before an order is suggested.
export const HINT_SLACK = 0.25;

// Up to a whole batch: under the minimum — the minimum, above it — to the next 50.
export function roundOrder(quantity: number, moq: number): number {
  if (quantity <= 0) return 0;
  if (quantity < moq) return moq;
  return Math.ceil(quantity / 50 - 1e-9) * 50;
}

// For the first month that can still be changed and the two after it: the order that brings the
// total stock (factory + entity + distributor) at the end of the month to the target cover. A
// month's hint is carried into the next one. Only a calculation: it knows nothing of promos,
// price changes, line schedules or agreements with the factory.
export function orderHint(ctx: SopContext, sku: SopSku): OrderHint | null {
  const { model, settings, horizon } = ctx;
  if (isDelist(sku.status) || isNotLaunched(sku.status)) return null;
  const first = ctx.frozen.length;
  // A new product is ordered no further than M + newPoHorizon.
  const limit = isNew(sku.status) ? ctx.m + settings.newPoHorizon : Infinity;
  const months = horizon.slice(first, first + 3).filter((i) => i <= limit);
  if (months.length === 0) return null;
  if (!months.some((i) => demandAt(sku, i) >= 1)) return null;
  const own = ownStocks(ctx, sku);
  const before = months[0]! - 1;
  let stock =
    before >= 0
      ? valueOf(sku, "factoryStock", before) + (own.entity[before] ?? 0) + (own.dist[before] ?? 0)
      : 0;
  const steps: HintStep[] = months.map((i) => {
    const filePo = valueOf(sku, "po", i);
    const sales = valueOf(sku, "sellThru", i);
    const demand = demandAt(sku, i);
    const opening = stock;
    const closing = opening + filePo - sales;
    const target = settings.targetTotal * demand;
    const gap = target - closing;
    const cover = coverOf(closing, demand);
    let suggested = filePo;
    let waits = false;
    // Within a week of sales of the target the order is left alone.
    if (demand >= 1 && gap > HINT_SLACK * demand) {
      const batch = roundOrder(filePo + gap, settings.moq);
      // A slow seller is ordered a whole batch at a time: when the batch would lift the stock
      // above the maximum, it waits until the stock is down to the minimum (the «saw-tooth»).
      const withBatch = (closing + batch - filePo) / demand;
      waits =
        withBatch > settings.maxTotal &&
        cover !== null &&
        cover >= settings.entityMin + settings.distMin;
      if (!waits) suggested = batch;
    } else if (demand >= 1 && filePo > 0 && cover !== null && cover > settings.maxTotal)
      suggested = Math.min(filePo, roundOrder(filePo + gap, settings.moq));
    const change = suggested - filePo;
    stock = closing + change;
    return {
      month: model.months[i]!,
      opening: round(opening),
      filePo,
      sales,
      closing: round(closing),
      demand: round(demand),
      cover,
      target: round(target),
      gap: round(gap),
      suggested,
      change,
      action: change > 0 ? "add" : change < 0 ? "reduce" : "keep",
      waits,
      coverAfter: coverOf(stock, demand),
    };
  });
  return {
    key: sku.key,
    name: sku.name,
    factory: sku.factory,
    type: sku.type,
    status: sku.status,
    steps,
    weight: Math.max(...steps.map((s) => Math.abs(s.change))),
  };
}

export const orderHints = (ctx: SopContext): OrderHint[] =>
  ctx.model.skus
    .map((sku) => orderHint(ctx, sku))
    .filter((hint): hint is OrderHint => hint !== null)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

// --- Excise stamps --------------------------------------------------------------------------------

export type StampMonth = {
  // The month of production and the day the stamps must be at the factory by.
  month: string;
  deadline: string;
  status: "overdue" | "soon" | "ok";
  daysLeft: number;
  byFactory: { factory: string; cases: number; packs: number }[];
  cases: number;
  packs: number;
};

const DAY = 24 * 60 * 60 * 1000;
export const STAMP_DEADLINE_DAY = 21;
export const STAMP_SOON_DAYS = 10;

// For the production of M+1 … M+4: packs = ordered cases × packs in a case, by factory. The
// stamps must reach the factory by the third week of the month before the production.
export function exciseStamps(ctx: SopContext, today: string): StampMonth[] {
  const { model, settings } = ctx;
  const factories = [...new Set(model.skus.map((s) => s.factory))].sort();
  return [1, 2, 3, 4]
    .map((step) => ctx.m + step)
    .filter((i) => i < model.months.length)
    .map((i) => {
      const month = model.months[i]!;
      const deadline = `${addMonths(month, -1)}-${STAMP_DEADLINE_DAY}`;
      const daysLeft = Math.round((Date.parse(deadline) - Date.parse(today)) / DAY);
      const byFactory = factories
        .map((factory) => {
          const cases = round(
            model.skus
              .filter((s) => s.factory === factory)
              .reduce((sum, s) => sum + valueOf(s, "po", i), 0),
          );
          return { factory, cases, packs: Math.round(cases * settings.packsPerCase) };
        })
        .filter((f) => f.cases > 0);
      return {
        month,
        deadline,
        daysLeft,
        status: daysLeft < 0 ? "overdue" : daysLeft <= STAMP_SOON_DAYS ? "soon" : "ok",
        byFactory,
        cases: round(byFactory.reduce((sum, f) => sum + f.cases, 0)),
        packs: byFactory.reduce((sum, f) => sum + f.packs, 0),
      };
    });
}
