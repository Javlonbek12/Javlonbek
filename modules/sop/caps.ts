import { ownStocks, round, valueOf, type SopContext } from "./calc";
import type { SopSku } from "./types";

// «Лимиты отгрузки»: how much of each SKU may go to the main distributor in M and M+1 so that
// the key accounts are not left without stock. The sheet has one Sell-in cell for both channels;
// the key accounts' part is taken from the closed months typed as «=distributor+KA», or from the
// share set in the settings.

export type CapSource = "file" | "share" | "none";

export type CapMonth = {
  month: string;
  sellIn: number;
  // The key accounts' part and the most the distributor may take; null: nothing to count from.
  ka: number | null;
  cap: number | null;
  // Entity stock at the end of the month, and how many months of key-account sales it is.
  entityStock: number;
  kaMonths: number | null;
  warn: boolean;
};

export type CapRow = {
  key: string;
  name: string;
  factory: string;
  status: string;
  source: CapSource;
  // The key accounts' average of the closed months (when the file has it).
  kaAverage: number | null;
  months: CapMonth[];
};

// Entity stock under this many months of key-account sales is a warning.
export const KA_MIN_MONTHS = 3;

// The second addend of «=a+b» in Sell-in of the closed months: the key accounts' cases.
function kaFromFile(ctx: SopContext, sku: SopSku): number | null {
  const parts = ctx.closed
    .map((i) => sku.parts[`sellIn:${i}`])
    .filter((p): p is number[] => Array.isArray(p) && p.length >= 2);
  if (parts.length === 0) return null;
  return parts.reduce((sum, p) => sum + p[1]!, 0) / parts.length;
}

export function shipmentCaps(ctx: SopContext): CapRow[] {
  const { model, settings } = ctx;
  const months = ctx.horizon.slice(0, 2);
  const rows: CapRow[] = [];
  for (const sku of model.skus) {
    if (!months.some((i) => valueOf(sku, "sellIn", i) > 0)) continue;
    const own = ownStocks(ctx, sku);
    const average = kaFromFile(ctx, sku);
    const source: CapSource =
      average !== null ? "file" : settings.kaShare !== null ? "share" : "none";
    rows.push({
      key: sku.key,
      name: sku.name,
      factory: sku.factory,
      status: sku.status,
      source,
      kaAverage: average === null ? null : round(average),
      months: months.map((i) => {
        const sellIn = valueOf(sku, "sellIn", i);
        const ka =
          average !== null
            ? Math.min(sellIn, average)
            : settings.kaShare !== null
              ? (sellIn * settings.kaShare) / 100
              : null;
        const entityStock = own.entity[i] ?? 0;
        const kaMonths = ka !== null && ka > 0.0001 ? entityStock / ka : null;
        return {
          month: model.months[i]!,
          sellIn,
          ka: ka === null ? null : round(ka),
          cap: ka === null ? null : round(Math.max(0, sellIn - ka)),
          entityStock,
          kaMonths,
          warn: kaMonths !== null && kaMonths < KA_MIN_MONTHS,
        };
      }),
    });
  }
  return rows;
}
