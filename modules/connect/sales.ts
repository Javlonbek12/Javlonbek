import { addDays } from "@/lib/dates";

import { percent } from "./analytics";
import { skuKey, type OrderRecord, type SaleRecord } from "./parse";

// Auto-stock orders × the CRM's sales, as pure functions (rules approved by the owner on
// 09.11.2026, see docs/DECISIONS.md): after an OOS check made an order, were the ordered SKUs
// sold to that store within the order day … order day + 3? Sales are in blocks of 10 packs.

export const PACKS_PER_BLOCK = 10;
export const SALES_WINDOW_DAYS = 3;

// The days the loaded sales cover (first and last delivery day).
export type SalesRange = { from: string; to: string };

export type SalesData = {
  range: SalesRange;
  // store|SKU key → packs sold by delivery day.
  byKey: Map<string, { day: string; packs: number }[]>;
};

const lineKey = (storeCode: string, sku: string) => `${storeCode}|${skuKey(sku)}`;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// The sales of the stores ordered from, ready to look up; null when no sales are loaded.
export function indexSales(sales: SaleRecord[], range: SalesRange | null): SalesData | null {
  if (!range) return null;
  const byKey = new Map<string, { day: string; packs: number }[]>();
  for (const s of sales) {
    const key = lineKey(s.storeCode, s.sku);
    const list = byKey.get(key) ?? [];
    list.push({ day: s.day, packs: s.blocks * PACKS_PER_BLOCK });
    byKey.set(key, list);
  }
  return { range, byKey };
}

// One ordered SKU: packs ordered, packs sold in the window (raw) and sold up to what was ordered.
export type OrderLine = { sku: string; ordered: number; sold: number; covered: number };
export type SalesResult = "all" | "partial" | "none";

export type OrderCheck = {
  order: OrderRecord;
  until: string;
  // The sales loaded cover the whole window (order day … day + 3); otherwise «окно не закрыто»
  // and the order stays out of the shares.
  closed: boolean;
  lines: OrderLine[];
  // Every ordered SKU sold / some / none (a SKU is sold when any of it was sold in the window).
  result: SalesResult;
};

export function checkOrder(order: OrderRecord, sales: SalesData): OrderCheck {
  const until = addDays(order.day, SALES_WINDOW_DAYS);
  const lines = Object.entries(order.skus)
    .filter(([, packs]) => packs > 0)
    .map(([sku, ordered]) => {
      const sold = Math.max(
        0,
        sum(
          (sales.byKey.get(lineKey(order.storeCode, sku)) ?? [])
            .filter((s) => s.day >= order.day && s.day <= until)
            .map((s) => s.packs),
        ),
      );
      return { sku, ordered, sold, covered: Math.min(sold, ordered) };
    });
  const sold = lines.filter((l) => l.sold > 0).length;
  return {
    order,
    until,
    closed: order.day >= sales.range.from && until <= sales.range.to,
    lines,
    result: sold === 0 ? "none" : sold === lines.length ? "all" : "partial",
  };
}

// Auto-stock orders (express orders are not) with at least one SKU line.
export function checkOrders(orders: OrderRecord[], sales: SalesData): OrderCheck[] {
  return orders
    .filter((o) => !o.express)
    .map((o) => checkOrder(o, sales))
    .filter((c) => c.lines.length > 0);
}

export type SalesCounts = {
  // Orders looked at, those with the window closed (checked) and not closed yet.
  orders: number;
  checked: number;
  notClosed: number;
  anySold: number;
  allSold: number;
  lines: number;
  linesSold: number;
  packsOrdered: number;
  // Sold up to the packs ordered, and all that was sold.
  packsSold: number;
  packsSoldRaw: number;
};

export const SALES_COUNTS: (keyof SalesCounts)[] = [
  "orders",
  "checked",
  "notClosed",
  "anySold",
  "allSold",
  "lines",
  "linesSold",
  "packsOrdered",
  "packsSold",
  "packsSoldRaw",
];

// Lines, packs and results count only orders whose window is closed.
export function salesCounts(checks: OrderCheck[]): SalesCounts {
  const closed = checks.filter((c) => c.closed);
  const lines = closed.flatMap((c) => c.lines);
  return {
    orders: checks.length,
    checked: closed.length,
    notClosed: checks.length - closed.length,
    anySold: closed.filter((c) => c.result !== "none").length,
    allSold: closed.filter((c) => c.result === "all").length,
    lines: lines.length,
    linesSold: lines.filter((l) => l.sold > 0).length,
    packsOrdered: sum(lines.map((l) => l.ordered)),
    packsSold: sum(lines.map((l) => l.covered)),
    packsSoldRaw: sum(lines.map((l) => l.sold)),
  };
}

export function salesRates(c: SalesCounts) {
  return {
    anyRate: percent(c.anySold, c.checked),
    allRate: percent(c.allSold, c.checked),
    linesRate: percent(c.linesSold, c.lines),
    packsRate: percent(c.packsSold, c.packsOrdered),
  };
}

// The sales block of the «Автосток (OOS) и заказы» section: counts and shares, every delivery
// status on its own, the SKUs most often ordered and not sold. `light` leaves out the lists.
export function salesSummary(checks: OrderCheck[], sales: SalesData, light = false) {
  const counts = salesCounts(checks);
  const byStatus = new Map<string, OrderCheck[]>();
  for (const c of checks) {
    const status = c.order.status ?? "";
    byStatus.set(status, [...(byStatus.get(status) ?? []), c]);
  }
  const unsold = new Map<string, { sku: string; ordered: number; unsold: number }>();
  for (const line of checks.filter((c) => c.closed).flatMap((c) => c.lines)) {
    const key = skuKey(line.sku);
    const entry = unsold.get(key) ?? { sku: line.sku, ordered: 0, unsold: 0 };
    entry.ordered++;
    if (line.sold === 0) entry.unsold++;
    unsold.set(key, entry);
  }
  return {
    ...counts,
    ...salesRates(counts),
    from: sales.range.from,
    to: sales.range.to,
    byStatus: light
      ? []
      : [...byStatus.entries()]
          .map(([status, list]) => {
            const c = salesCounts(list);
            return { status, ...c, ...salesRates(c) };
          })
          .sort((a, b) => b.orders - a.orders || a.status.localeCompare(b.status)),
    topUnsold: light
      ? []
      : [...unsold.values()]
          .filter((s) => s.unsold > 0)
          .map((s) => ({ ...s, rate: percent(s.unsold, s.ordered) }))
          .sort((a, b) => b.unsold - a.unsold || a.sku.localeCompare(b.sku))
          .slice(0, 10),
  };
}
export type SalesSummary = ReturnType<typeof salesSummary>;

// One TSM's orders with nothing sold in a closed window: what to ask the store about.
export function unsoldOrders(checks: OrderCheck[]) {
  return checks
    .filter((c) => c.closed && c.result === "none")
    .map((c) => ({
      id: c.order.id,
      store: c.order.storeName,
      storeCode: c.order.storeCode,
      day: c.order.day,
      until: c.until,
      status: c.order.status,
      skus: c.lines.map((l) => l.sku),
    }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.store.localeCompare(y.store));
}
