// The POSM distribution model, as in the customer's workbook: every item goes to the equipment
// types marked for it; regions get shares by their weight (units of those types, or their slots,
// or — for price tags — the facings with that price on the type's planogram); rounding is down
// and the rest stays at the central warehouse. Each region's share is then broken down between
// its TSMs by the units they are responsible for (the TSM comes from the outlet base; units it
// has no TSM for are the «TSM не назначен» row); what falls to the region's warehouse stock and
// the rounding rest stay at the region's warehouse.
// Pure functions: no database, so they are easy to test.
import {
  byTsmName,
  NO_TSM,
  parseDestination,
  sortRegions,
  tagPrice,
  tsmDestination,
  typeInfo,
  TYPE_CODES,
  type DistType,
} from "./types";

export type Count = {
  kind: "INSTALLED" | "STOCK";
  region: string;
  tsm: string;
  type: string;
  count: number;
};

export type Item = {
  id: string;
  position: number;
  name: string;
  category: string;
  orderedFor: number;
  inStock: number;
  ordered: number;
  reservePct: number;
  base: "UNITS" | "SLOTS" | "PLANOGRAM";
  norm: number | null;
  normReserve: number;
  types: string[];
};

export type Shipment = { posmId: string; destination: string; quantity: number };

// Per equipment type: slots on one unit, and how many facings carry each price on its planogram.
export type TypeFacts = {
  slots: Record<string, number>;
  facings: Partial<Record<string, Record<number, number>>>;
};

export type Units = Record<string, number>; // type → units

const add = (units: Units, type: string, n: number) => (units[type] = (units[type] ?? 0) + n);
export const sumUnits = (units: Units | undefined) =>
  Object.values(units ?? {}).reduce((a, b) => a + b, 0);

// Units per region that POSM goes to: installed, plus the warehouse stock when it is included.
export function regionBase(counts: Count[], includeStock: boolean): Map<string, Units> {
  const out = new Map<string, Units>();
  for (const c of counts) {
    if (c.tsm !== "" || (c.kind === "STOCK" && !includeStock)) continue;
    const units = out.get(c.region) ?? {};
    add(units, c.type, c.count);
    out.set(c.region, units);
  }
  return new Map(sortRegions(out.keys()).map((r) => [r, out.get(r)!]));
}

// Installed units by region and responsible TSM (with «TSM не назначен» last).
export function tsmBase(counts: Count[]): Map<string, Map<string, Units>> {
  const out = new Map<string, Map<string, Units>>();
  for (const c of counts) {
    if (c.tsm === "" || c.kind !== "INSTALLED") continue;
    const region = out.get(c.region) ?? new Map<string, Units>();
    const units = region.get(c.tsm) ?? {};
    add(units, c.type, c.count);
    region.set(c.tsm, units);
    out.set(c.region, region);
  }
  return new Map(
    sortRegions(out.keys()).map((r) => {
      const byTsm = out.get(r)!;
      const names = [...byTsm.keys()].sort(byTsmName);
      return [r, new Map(names.map((t) => [t, byTsm.get(t)!]))];
    }),
  );
}

export function totalUnits(base: Map<string, Units>): Units {
  const total: Units = {};
  for (const units of base.values()) for (const [t, n] of Object.entries(units)) add(total, t, n);
  return total;
}

// What one unit of a type weighs for this item.
export function unitWeight(item: Item, type: string, facts: TypeFacts): number {
  if (!item.types.includes(type)) return 0;
  if (item.base === "SLOTS") return facts.slots[type] ?? 0;
  if (item.base === "PLANOGRAM") {
    const price = tagPrice(item.name);
    return price === null ? 0 : (facts.facings[type]?.[price] ?? 0);
  }
  return 1;
}

export const weightOf = (item: Item, units: Units | undefined, facts: TypeFacts) =>
  Object.entries(units ?? {}).reduce((sum, [t, n]) => sum + n * unitWeight(item, t, facts), 0);

export const available = (item: Item) => item.inStock + item.ordered;
export const toShip = (item: Item) => Math.floor(available(item) * (1 - item.reservePct) + 1e-9);

// Splits `total` by weights, rounding down; what's left over is returned as `rest`.
export function split(total: number, weights: Map<string, number>) {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  const shares = new Map<string, number>();
  for (const [key, w] of weights)
    shares.set(key, sum === 0 ? 0 : Math.floor((total * w) / sum + 1e-9));
  const given = [...shares.values()].reduce((a, b) => a + b, 0);
  return { shares, rest: total - given, weight: sum };
}

export type ItemPlan = {
  item: Item;
  available: number;
  toShip: number;
  weight: number;
  byRegion: Map<string, number>;
  distributed: number;
  // Rounding rest + the reserve: stays at the central warehouse.
  central: number;
  // By "Region · TSM".
  byTsm: Map<string, number>;
  // Per region, what is left after the TSM breakdown: stays at the region's warehouse.
  tsmRest: Map<string, number>;
};

export function planItem(
  item: Item,
  regions: Map<string, Units>,
  tsms: Map<string, Map<string, Units>>,
  facts: TypeFacts,
): ItemPlan {
  const weights = new Map([...regions].map(([r, u]) => [r, weightOf(item, u, facts)]));
  const ship = toShip(item);
  const { shares, rest, weight } = split(ship, weights);
  const byTsm = new Map<string, number>();
  const tsmRest = new Map<string, number>();
  for (const [region, people] of tsms) {
    const share = shares.get(region) ?? 0;
    const own = new Map([...people].map(([t, u]) => [t, weightOf(item, u, facts)]));
    const assigned = [...own.values()].reduce((a, b) => a + b, 0);
    // The region's stock weighs too: its part stays at the region's warehouse.
    const unassigned = Math.max(0, (weights.get(region) ?? 0) - assigned);
    const { shares: perTsm } = split(share, new Map([...own, ["", unassigned]]));
    let given = 0;
    for (const [tsm, n] of perTsm)
      if (tsm !== "") {
        byTsm.set(tsmDestination(region, tsm), n);
        given += n;
      }
    tsmRest.set(region, share - given);
  }
  return {
    item,
    available: available(item),
    toShip: ship,
    weight,
    byRegion: shares,
    distributed: ship - rest,
    central: available(item) - ship + rest,
    byTsm,
    tsmRest,
  };
}

export type ItemControl = {
  item: Item;
  typesMarked: number;
  // Units of the marked types (the base, whatever the distribution base is).
  covered: number;
  available: number;
  need: number | null;
  // available − need: + surplus, − deficit; null without a norm.
  balance: number | null;
  perUnit: number;
};

export function controlItem(item: Item, total: Units): ItemControl {
  const covered = item.types.reduce((sum, t) => sum + (total[t] ?? 0), 0);
  const need =
    item.norm === null ? null : Math.ceil(covered * item.norm * (1 + item.normReserve) - 1e-9);
  return {
    item,
    typesMarked: item.types.length,
    covered,
    available: available(item),
    need,
    balance: need === null ? null : available(item) - need,
    perUnit: covered === 0 ? 0 : available(item) / covered,
  };
}

// Per category: how many items go to each type (0 where there is equipment = a gap).
export function coverage(items: Item[]) {
  const categories = [...new Set(items.map((i) => i.category))];
  return categories.map((category) => ({
    category,
    byType: Object.fromEntries(
      TYPE_CODES.map((t) => [
        t,
        items.filter((i) => i.category === category && i.types.includes(t)).length,
      ]),
    ) as Record<DistType, number>,
  }));
}

// Per category and region: units left without any item of that category.
export function gaps(items: Item[], regions: Map<string, Units>) {
  return coverage(items).map(({ category, byType }) => ({
    category,
    types: TYPE_CODES.filter((t) => byType[t] === 0),
    byRegion: new Map(
      [...regions].map(([region, units]) => {
        const missing = TYPE_CODES.reduce((s, t) => s + (byType[t] === 0 ? (units[t] ?? 0) : 0), 0);
        return [region, { missing, share: sumUnits(units) ? missing / sumUnits(units) : 0 }];
      }),
    ),
  }));
}

export type TagNeed = {
  price: number;
  // Facings with this price on all installed (+ stock) units, by the planograms.
  need: number;
  available: number;
  items: string[];
  byType: Partial<Record<string, number>>;
};

// Price tags by the planograms: one tag per facing, so the need for a price is
// Σ units of a type × facings with that price on its planogram.
export function priceTagNeed(items: Item[], total: Units, facts: TypeFacts): TagNeed[] {
  const prices = new Set<number>();
  for (const f of Object.values(facts.facings))
    for (const p of Object.keys(f ?? {})) prices.add(Number(p));
  const tags = items.filter((i) => tagPrice(i.name) !== null);
  for (const t of tags) prices.add(tagPrice(t.name)!);
  return [...prices]
    .sort((a, b) => a - b)
    .map((price) => {
      const byType: Partial<Record<string, number>> = {};
      for (const t of TYPE_CODES) {
        const n = (total[t] ?? 0) * (facts.facings[t]?.[price] ?? 0);
        if (n) byType[t] = n;
      }
      const same = tags.filter((t) => tagPrice(t.name) === price);
      return {
        price,
        need: sumUnits(byType as Units),
        available: same.reduce((s, t) => s + available(t), 0),
        items: same.map((t) => t.name),
        byType,
      };
    });
}

export type StockLine = {
  item: Item;
  available: number;
  planned: number;
  shipped: number;
  // Still at the central warehouse.
  onHand: number;
  // Planned but not shipped yet.
  toSend: number;
  byDestination: Map<string, number>;
};

// What left the central warehouse and where to, against the plan.
export function stock(plans: ItemPlan[], shipments: Shipment[]): StockLine[] {
  return plans.map((plan) => {
    const mine = shipments.filter((s) => s.posmId === plan.item.id);
    const byDestination = new Map<string, number>();
    for (const s of mine)
      byDestination.set(s.destination, (byDestination.get(s.destination) ?? 0) + s.quantity);
    const shipped = mine.reduce((sum, s) => sum + s.quantity, 0);
    return {
      item: plan.item,
      available: plan.available,
      planned: plan.distributed,
      shipped,
      onHand: plan.available - shipped,
      toSend: Math.max(0, plan.distributed - shipped),
      byDestination,
    };
  });
}

// The plan for a destination: a region (its whole share), or "Region · TSM".
export function plannedFor(plan: ItemPlan, destination: string): number {
  if (parseDestination(destination).tsm !== null) return plan.byTsm.get(destination) ?? 0;
  return plan.byRegion.get(destination) ?? 0;
}

// A share typed in percent on a form. The form shows it rounded (9.1 for 0.0909…); when the field
// comes back as shown, the stored share is kept, so saving other fields doesn't move quantities.
export function typedShare(typed: string, shown: string, stored: string): number {
  const text = typed.trim().replace(",", ".");
  if (text === shown.trim() && stored !== "" && Number.isFinite(Number(stored)))
    return Number(stored);
  return Number(text || 0) / 100;
}

export type Remainder = {
  planned: number;
  // Shipped to this destination itself.
  shipped: number;
  // For a region: what went straight to its TSMs (it comes out of the region's share).
  viaTsm: number;
  toSend: number;
};

// What is still to send to a destination. A region's share covers its TSMs, so shipments to the
// region and to its TSMs both come out of it; a TSM never gets more than its own plan nor more
// than what is left of the region's share.
export function remainder(plan: ItemPlan, destination: string, shipments: Shipment[]): Remainder {
  const { region, tsm } = parseDestination(destination);
  const sum = (list: Shipment[]) => list.reduce((s, x) => s + x.quantity, 0);
  const inRegion = shipments.filter(
    (s) => s.posmId === plan.item.id && parseDestination(s.destination).region === region,
  );
  const own = sum(inRegion.filter((s) => s.destination === destination));
  const regionShare = plan.byRegion.get(region) ?? 0;
  const regionLeft = Math.max(0, regionShare - sum(inRegion));
  if (tsm === null)
    return { planned: regionShare, shipped: own, viaTsm: sum(inRegion) - own, toSend: regionLeft };
  const planned = plan.byTsm.get(destination) ?? 0;
  return {
    planned,
    shipped: own,
    viaTsm: 0,
    toSend: Math.max(0, Math.min(planned - own, regionLeft)),
  };
}

export type Finding = {
  tone: "bad" | "warn" | "info";
  key: string;
  params: Record<string, string | number>;
};

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

// The findings of the analysis, most important first.
export function findings(input: {
  items: Item[];
  regions: Map<string, Units>;
  tsms: Map<string, Map<string, Units>>;
  counts: Count[];
  includeStock: boolean;
  plans: ItemPlan[];
  controls: ItemControl[];
  tags: TagNeed[];
  facts: TypeFacts;
}): Finding[] {
  const { items, regions, tsms, counts, includeStock, plans, controls, tags, facts } = input;
  const total = totalUnits(regions);
  const out: Finding[] = [];

  for (const c of controls)
    if (c.balance !== null && c.balance < 0)
      out.push({
        tone: "bad",
        key: "deficit",
        params: { name: c.item.name, count: fmt(-c.balance), need: fmt(c.need!) },
      });

  for (const g of gaps(items, regions)) {
    const missing = g.types.reduce((s, t) => s + (total[t] ?? 0), 0);
    if (missing > 0 && g.types.length < TYPE_CODES.length)
      out.push({
        tone: "warn",
        key: "gap",
        params: {
          category: g.category,
          count: fmt(missing),
          types: g.types
            .filter((t) => total[t])
            .map((t) => `${typeInfo(t)?.label ?? t} — ${fmt(total[t]!)}`)
            .join(", "),
        },
      });
  }

  for (const c of controls)
    if (c.need === null && c.covered > 0 && c.perUnit < 0.9 && tagPrice(c.item.name) === null)
      out.push({
        tone: "warn",
        key: "thin",
        params: {
          name: c.item.name,
          perUnit: c.perUnit.toFixed(2),
          count: fmt(c.covered - available(c.item)),
        },
      });

  for (const c of controls) {
    // Price tags are ordered per price, not per unit: their order base says nothing here.
    if (!c.item.orderedFor || !c.covered || /ценник|price tag/i.test(c.item.name)) continue;
    const diff = c.covered - c.item.orderedFor;
    if (Math.abs(diff) / c.covered > 0.1)
      out.push({
        tone: "info",
        key: "orderedFor",
        params: { name: c.item.name, orderedFor: fmt(c.item.orderedFor), covered: fmt(c.covered) },
      });
  }

  const planned = tags.filter((t) => t.need > 0);
  if (planned.length > 0) {
    for (const t of planned)
      if (t.available < t.need)
        out.push({
          tone: "bad",
          key: "tagShort",
          params: { price: fmt(t.price), need: fmt(t.need), available: fmt(t.available) },
        });
    for (const t of tags)
      if (t.available > 0 && t.need === 0)
        out.push({
          tone: "warn",
          key: "tagUnused",
          params: { price: fmt(t.price), available: fmt(t.available) },
        });
    const uniform = items.filter((i) => tagPrice(i.name) !== null && i.base !== "PLANOGRAM").length;
    if (uniform > 0) out.push({ tone: "info", key: "tagUniform", params: { count: uniform } });
  } else if (items.some((i) => tagPrice(i.name) !== null)) {
    out.push({ tone: "info", key: "tagNoPlanogram", params: {} });
  }

  // Installed units the outlet base has no TSM for: the «TSM не назначен» rows.
  const missing = [...tsms.values()].reduce((s, people) => s + sumUnits(people.get(NO_TSM)), 0);
  if (missing >= 1) out.push({ tone: "warn", key: "noTsm", params: { count: fmt(missing) } });

  const stockUnits = counts
    .filter((c) => c.kind === "STOCK" && c.tsm === "")
    .reduce((s, c) => s + c.count, 0);
  if (stockUnits > 0)
    out.push({
      tone: "info",
      key: includeStock ? "stockIn" : "stockOut",
      params: { count: fmt(stockUnits) },
    });

  const slotGaps = TYPE_CODES.filter((t) => total[t] && facts.slots[t] === undefined);
  if (slotGaps.length)
    out.push({ tone: "info", key: "noSlots", params: { types: slotGaps.join(", ") } });

  const central = plans.reduce((s, p) => s + p.central, 0);
  if (central > 0) out.push({ tone: "info", key: "central", params: { count: fmt(central) } });

  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

export type BreakdownRow = {
  kind: "region" | "tsm" | "rest";
  region: string;
  // "Region · TSM" for a TSM row.
  destination: string;
  label: string;
  values: number[];
};

// The TSM breakdown as rows: each region's share, its TSMs, and what stays at its warehouse.
export function tsmBreakdown(plans: ItemPlan[], tsms: Map<string, Map<string, Units>>) {
  const rows: BreakdownRow[] = [];
  for (const [region, people] of tsms) {
    rows.push({
      kind: "region",
      region,
      destination: region,
      label: region,
      values: plans.map((p) => p.byRegion.get(region) ?? 0),
    });
    for (const tsm of people.keys()) {
      const destination = tsmDestination(region, tsm);
      rows.push({
        kind: "tsm",
        region,
        destination,
        label: tsm,
        values: plans.map((p) => p.byTsm.get(destination) ?? 0),
      });
    }
    rows.push({
      kind: "rest",
      region,
      destination: region,
      label: region,
      values: plans.map((p) => p.tsmRest.get(region) ?? 0),
    });
  }
  return rows;
}
