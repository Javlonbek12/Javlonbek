import { addDays, daysBetween, startOfMonth } from "@/lib/dates";

import type { Hierarchy } from "./hierarchy";
import { personCode, skuKey, titleKey, type OosRecord, type RouteRecord } from "./parse";
import { isOrder, routeDays, staffKind } from "./route-codes";
import { finalOosChecks } from "./visits";

// «Восстановление наличия» and «Заказ дистрибьютора после OOS», as pure functions (rules of
// 23.11.2026, see docs/DECISIONS.md). A stock check says which products are out; the next check of
// the same store says which of them came back. The TSM finds and reports; the distributor's rep
// brings the order — so the second question is whether a rep's visit with an order followed.

// What a store's last check of the period is compared with: the check before it, or the store's
// first check of that month.
export const RECOVERY_BASES = ["prev", "month"] as const;
export type RecoveryBase = (typeof RECOVERY_BASES)[number];

// The check before may be older than the period, but not older than this.
export const RECOVERY_LOOKBACK_DAYS = 45;
// The stores shown on the page; the whole list is in the Excel file.
export const RECOVERY_STORES_SHOWN = 20;

// From which day the checks are needed for a period: the lookback, and the start of its month.
export function recoveryFrom(from: string) {
  const back = addDays(from, -RECOVERY_LOOKBACK_DAYS);
  const month = startOfMonth(from);
  return back < month ? back : month;
}

// A share in whole percent; null when there is nothing to take it of.
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// The codes a block is counted for (null: everyone), compared like everywhere on the page.
type Scope = Set<string> | null;
const scopeTest = (scope: Scope) => {
  if (!scope) return () => true;
  const keys = new Set([...scope].map(titleKey));
  return (code: string | null) => keys.has(titleKey(code ?? ""));
};

// A product's name key, made once per name (there are a few dozen products and many checks).
const keys = new Map<string, string>();
function keyOf(sku: string) {
  let key = keys.get(sku);
  if (key === undefined) keys.set(sku, (key = skuKey(sku)));
  return key;
}

// The products out of stock in a check, by name key. «Недостаточно» is on the shelf and «Не было
// закупа» is not a gap: neither is out.
function outOf(check: OosRecord) {
  const out = new Map<string, string>();
  for (const sku in check.skus) if (check.skus[sku] === "OUT") out.set(keyOf(sku), sku);
  return out;
}

// One collator for every comparison: making one per call is what takes the time.
const byName = new Intl.Collator(undefined, { numeric: true }).compare;

export type RecoveryStore = {
  storeCode: string;
  store: string;
  // Who made the last check ("CODE - Name" as the bot writes it) and their code.
  person: string | null;
  code: string | null;
  baseDay: string;
  lastDay: string;
  days: number;
  restored: string[];
  stillOut: string[];
  newlyOut: string[];
  // More products out than at the baseline.
  worse: boolean;
};

type Counts = { stores: number; restored: number; stillOut: number; newlyOut: number };
const withRate = <T extends Counts>(c: T) => ({
  ...c,
  wasOut: c.restored + c.stillOut,
  rate: rate(c.restored, c.restored + c.stillOut),
});

export function analyzeRecovery(
  oos: OosRecord[],
  options: { from: string; to: string; baseline?: RecoveryBase; scope?: Scope },
) {
  const { from, to } = options;
  const baseline = options.baseline ?? "prev";
  const inScope = scopeTest(options.scope ?? null);

  // One check per store-day (the latest), each store's days in order.
  const byStore = new Map<string, OosRecord[]>();
  for (const { final } of finalOosChecks(oos).values())
    byStore.set(final.storeCode, [...(byStore.get(final.storeCode) ?? []), final]);

  const stores: RecoveryStore[] = [];
  for (const list of byStore.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const last = list.findLast((c) => c.day >= from && c.day <= to);
    if (!last) continue;
    const code = personCode(last.person);
    if (!inScope(code)) continue;
    const earlier = list.filter((c) => c.day < last.day);
    const base =
      baseline === "prev"
        ? earlier.findLast((c) => daysBetween(c.day, last.day) <= RECOVERY_LOOKBACK_DAYS)
        : earlier.find((c) => c.day.slice(0, 7) === last.day.slice(0, 7));
    if (!base) continue;
    const [was, now] = [outOf(base), outOf(last)];
    const names = (map: Map<string, string>, keep: (key: string) => boolean) =>
      [...map.entries()]
        .filter(([key]) => keep(key))
        .map(([, sku]) => sku)
        .sort();
    stores.push({
      storeCode: last.storeCode,
      store: last.storeName,
      person: last.person,
      code,
      baseDay: base.day,
      lastDay: last.day,
      days: daysBetween(base.day, last.day),
      restored: names(was, (key) => !now.has(key)),
      stillOut: names(was, (key) => now.has(key)),
      newlyOut: names(now, (key) => !was.has(key)),
      worse: now.size > was.size,
    });
  }

  const count = (list: RecoveryStore[]) =>
    withRate({
      stores: list.length,
      restored: list.reduce((a, s) => a + s.restored.length, 0),
      stillOut: list.reduce((a, s) => a + s.stillOut.length, 0),
      newlyOut: list.reduce((a, s) => a + s.newlyOut.length, 0),
      worse: list.filter((s) => s.worse).length,
    });

  // By who made the last check; those with the most products still out first.
  const people = new Map<string, { code: string; person: string | null; list: RecoveryStore[] }>();
  for (const s of stores) {
    const key = titleKey(s.code ?? "");
    const entry = people.get(key) ?? { code: s.code ?? "", person: s.person, list: [] };
    entry.list.push(s);
    people.set(key, entry);
  }
  const byTsm = [...people.values()]
    .map(({ code, person, list }) => ({
      code,
      name: person?.split(" - ").slice(1).join(" - ").trim() || null,
      ...count(list),
    }))
    .sort((a, b) => b.stillOut - a.stillOut || byName(a.code, b.code));

  // By product: in how many stores it was out and in how many of them it came back; the worst
  // share first.
  const products = new Map<string, { sku: string; restored: number; stillOut: number }>();
  const product = (sku: string) => {
    const key = keyOf(sku);
    let entry = products.get(key);
    if (!entry) products.set(key, (entry = { sku, restored: 0, stillOut: 0 }));
    return entry;
  };
  for (const s of stores) {
    for (const sku of s.restored) product(sku).restored++;
    for (const sku of s.stillOut) product(sku).stillOut++;
  }
  const bySku = [...products.values()]
    .map((p) => ({
      ...p,
      wasOut: p.restored + p.stillOut,
      rate: rate(p.restored, p.restored + p.stillOut)!,
    }))
    .sort((a, b) => a.rate - b.rate || b.stillOut - a.stillOut || byName(a.sku, b.sku));

  return {
    baseline,
    totals: count(stores),
    byTsm,
    bySku,
    // Those with something to act on, the most products still out first.
    stores: stores
      .filter((s) => s.stillOut.length + s.newlyOut.length > 0)
      .sort(
        (a, b) =>
          b.stillOut.length - a.stillOut.length ||
          b.newlyOut.length - a.newlyOut.length ||
          byName(a.store, b.store),
      ),
  };
}
export type Recovery = ReturnType<typeof analyzeRecovery>;

// --- Did the distributor follow up? -------------------------------------------------------------

// A rep's visit with an order counts on the day of the check and the next three calendar days.
export const FOLLOW_UP_DAYS = 3;

type FollowCounts = { checks: number; followed: number };
const followRate = <T extends FollowCounts>(c: T) => ({ ...c, rate: rate(c.followed, c.checks) });

export function followUps(
  oos: OosRecord[],
  routes: RouteRecord[],
  options: {
    from: string;
    to: string;
    days?: number;
    hierarchy?: Hierarchy | null;
    // A check counts when its TSM or a rep's zone of its store is in the scope; rows are shown
    // only for the zones in it.
    scope?: Scope;
  },
) {
  const { from, to } = options;
  const window = options.days ?? FOLLOW_UP_DAYS;
  const inScope = scopeTest(options.scope ?? null);

  // The period's final checks that found a product out.
  const found = [...finalOosChecks(oos).values()]
    .map((f) => f.final)
    .filter((c) => c.day >= from && c.day <= to && Object.values(c.skus).includes("OUT"));
  const stores = new Set(found.map((c) => c.storeCode));

  // The last day each loaded month covers, and the reps' routes of those stores: the days a rep
  // took an order there.
  const loaded = new Map<string, string>();
  for (const r of routes) if (r.day > (loaded.get(r.month) ?? "")) loaded.set(r.month, r.day);
  const covered = (day: string) => day <= (loaded.get(day.slice(0, 7)) ?? "");
  const kinds = new Map<string, boolean>();
  const isRep = (zone: string) => {
    let rep = kinds.get(zone);
    if (rep === undefined) kinds.set(zone, (rep = staffKind(zone, options.hierarchy) === "DR"));
    return rep;
  };
  const byStore = new Map<string, { zone: string; orders: string[] }[]>();
  for (const r of routes) {
    if (!r.person || !stores.has(r.storeCode) || !isRep(r.person)) continue;
    const orders = routeDays(r, from, addDays(to, window))
      .filter((d) => isOrder(d.code))
      .map((d) => d.day);
    byStore.set(r.storeCode, [...(byStore.get(r.storeCode) ?? []), { zone: r.person, orders }]);
  }

  let open = 0;
  const all: FollowCounts = { checks: 0, followed: 0 };
  const zones = new Map<string, FollowCounts & { zone: string }>();
  const people = new Map<string, FollowCounts & { code: string; person: string | null }>();
  const add = (c: FollowCounts, followed: boolean) => {
    c.checks++;
    if (followed) c.followed++;
  };
  for (const check of found) {
    const until = addDays(check.day, window);
    // The reps whose route the store is on: a zone once, however many rows it has there (another
    // month, another employee in the zone).
    const reps = byStore.get(check.storeCode) ?? [];
    const lines = reps.filter(
      (line, i) => reps.findIndex((l) => titleKey(l.zone) === titleKey(line.zone)) === i,
    );
    if (!lines.length) continue;
    const code = personCode(check.person);
    const mine = inScope(code);
    const shown = lines.filter((line) => inScope(line.zone));
    if (!mine && !shown.length) continue;
    // The routes loaded must cover the whole window; otherwise «окно не закрыто».
    if (!covered(check.day) || !covered(until)) {
      open++;
      continue;
    }
    const followed = reps.some((line) =>
      line.orders.some((day) => day >= check.day && day <= until),
    );
    add(all, followed);
    for (const line of shown) {
      const key = titleKey(line.zone);
      const entry = zones.get(key) ?? { zone: line.zone, checks: 0, followed: 0 };
      add(entry, followed);
      zones.set(key, entry);
    }
    if (mine && code) {
      const key = titleKey(code);
      const entry = people.get(key) ?? { code, person: check.person, checks: 0, followed: 0 };
      add(entry, followed);
      people.set(key, entry);
    }
  }

  // The worst share first.
  const order = (a: { rate: number | null; checks: number }, b: typeof a) =>
    (a.rate ?? 0) - (b.rate ?? 0) || b.checks - a.checks;
  return {
    days: window,
    // The last day of the routes loaded («данные маршрутов по …»); null: none loaded.
    routesTo: [...loaded.values()].sort().at(-1) ?? null,
    totals: { ...followRate(all), open },
    byDr: [...zones.values()].map(followRate).sort((a, b) => order(a, b) || byName(a.zone, b.zone)),
    byTsm: [...people.values()]
      .map(({ person, ...c }) => ({
        ...followRate(c),
        name: person?.split(" - ").slice(1).join(" - ").trim() || null,
      }))
      .sort((a, b) => order(a, b) || byName(a.code, b.code)),
  };
}
export type FollowUps = ReturnType<typeof followUps>;
