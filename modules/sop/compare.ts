import { round, valueOf } from "./calc";
import { addMonths, FLOWS, type Flow, type SopKind, type SopModel } from "./types";

// «Сравнение»: two uploads side by side — what changed in the order, the plan, the shipments and
// the sales; the 1:1 check of HQ's final against what we sent; and how the forecasts of the older
// upload came true. Pure functions.

export type CompareSide = { model: SopModel; cycle: string; kind: SopKind };

export type CellChange = {
  key: string;
  name: string;
  factory: string;
  month: string;
  metric: Flow;
  was: number;
  now: number;
  delta: number;
};

export type Comparison = {
  months: string[];
  changes: CellChange[];
  // By metric and month: the whole sheet before and after.
  totals: { metric: Flow; month: string; was: number; now: number; delta: number }[];
  // Rows that are only in the newer or only in the older upload.
  added: { key: string; name: string; factory: string }[];
  removed: { key: string; name: string; factory: string }[];
  // The older one is ours and the newer one HQ's final of the same cycle: every difference is a
  // cell where the final is not what we sent.
  reconcile: boolean;
};

const TOLERANCE = 0.5;

export function compareUploads(older: CompareSide, newer: CompareSide): Comparison {
  // From the closed month of the earlier cycle on: what is before it is history in both.
  const from = addMonths(older.cycle < newer.cycle ? older.cycle : newer.cycle, -1);
  const months = newer.model.months.filter(
    (month) => month >= from && older.model.months.includes(month),
  );
  const before = new Map(older.model.skus.map((s) => [s.key, s]));
  const changes: CellChange[] = [];
  const totals: Comparison["totals"] = [];
  for (const metric of FLOWS) {
    for (const month of months) {
      const i = older.model.months.indexOf(month);
      const j = newer.model.months.indexOf(month);
      let was = 0;
      let now = 0;
      for (const sku of older.model.skus) was += valueOf(sku, metric, i);
      for (const sku of newer.model.skus) {
        const value = valueOf(sku, metric, j);
        now += value;
        const old = before.get(sku.key);
        if (!old) continue;
        const previous = valueOf(old, metric, i);
        if (Math.abs(value - previous) > TOLERANCE)
          changes.push({
            key: sku.key,
            name: sku.name,
            factory: sku.factory,
            month,
            metric,
            was: previous,
            now: value,
            delta: round(value - previous),
          });
      }
      totals.push({ metric, month, was: round(was), now: round(now), delta: round(now - was) });
    }
  }
  const after = new Set(newer.model.skus.map((s) => s.key));
  const pick = (s: { key: string; name: string; factory: string }) => ({
    key: s.key,
    name: s.name,
    factory: s.factory,
  });
  return {
    months,
    changes: changes.sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.month.localeCompare(b.month) ||
        FLOWS.indexOf(a.metric) - FLOWS.indexOf(b.metric),
    ),
    totals,
    added: newer.model.skus.filter((s) => !before.has(s.key)).map(pick),
    removed: older.model.skus.filter((s) => !after.has(s.key)).map(pick),
    reconcile: older.kind === "OURS" && newer.kind === "HQ_FINAL" && older.cycle === newer.cycle,
  };
}

// --- Forecast accuracy --------------------------------------------------------------------------

export const ACCURACY_METRICS = ["sellIn", "sellThru"] as const;
export type AccuracyMetric = (typeof ACCURACY_METRICS)[number];
export const ACCURACY_BAND = { low: 80, high: 120 };

export type AccuracyRow = {
  key: string;
  name: string;
  factory: string;
  month: string;
  metric: AccuracyMetric;
  forecast: number;
  actual: number;
  // Actual as % of the forecast; null when nothing was forecast.
  percent: number | null;
  off: boolean;
};

export type Accuracy = {
  months: string[];
  rows: AccuracyRow[];
  totals: Omit<AccuracyRow, "key" | "name" | "factory">[];
};

const accuracy = (forecast: number, actual: number) => {
  const percent = forecast > 0.0001 ? Math.round((actual / forecast) * 1000) / 10 : null;
  return {
    forecast: round(forecast),
    actual: round(actual),
    percent,
    off:
      percent === null ? actual >= 1 : percent < ACCURACY_BAND.low || percent > ACCURACY_BAND.high,
  };
};

// The months the older upload forecast (from its M on) that the newer one has as closed (before
// its M): what was planned against what happened.
export function forecastAccuracy(older: CompareSide, newer: CompareSide): Accuracy {
  const months = newer.model.months.filter(
    (month) => month >= older.cycle && month < newer.cycle && older.model.months.includes(month),
  );
  const before = new Map(older.model.skus.map((s) => [s.key, s]));
  const rows: AccuracyRow[] = [];
  const totals: Accuracy["totals"] = [];
  for (const month of months) {
    const i = older.model.months.indexOf(month);
    const j = newer.model.months.indexOf(month);
    for (const metric of ACCURACY_METRICS) {
      let forecastTotal = 0;
      let actualTotal = 0;
      for (const sku of newer.model.skus) {
        const old = before.get(sku.key);
        const forecast = old ? valueOf(old, metric, i) : 0;
        const actual = valueOf(sku, metric, j);
        forecastTotal += forecast;
        actualTotal += actual;
        // Nothing planned and nothing sold: not a forecast to judge.
        if (forecast < 1 && actual < 1) continue;
        rows.push({
          key: sku.key,
          name: sku.name,
          factory: sku.factory,
          month,
          metric,
          ...accuracy(forecast, actual),
        });
      }
      totals.push({ month, metric, ...accuracy(forecastTotal, actualTotal) });
    }
  }
  return { months, rows, totals };
}
