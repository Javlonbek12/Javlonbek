import { titleKey } from "./parse";
import type { RouteZone } from "./routes";
import type { StaffKind } from "./route-codes";

// «Продажи по зонам»: Smart Up's sales report next to the route analysis (asked by the owner on
// 24.11.2026). A sale is the rep's who sold it («Штат») and the TSM's whose store it is
// («Responsible TSM»); both are named as the zones of the route analysis, so a zone's sales stand
// next to its hit rate or attendance. Pure functions; the sums come from the database
// (service.ts).

// The sales of a period summed by who sold and whose store it is.
export type SalesGroup = {
  // The period shown, or the one of the same length before it.
  period: "now" | "before";
  staff: string | null;
  tsm: string | null;
  blocks: number;
  sum: number;
  // Store-days with a sale (deliveries).
  days: number;
  // The stores sold to (the period shown only).
  stores: string[];
};

export type ZoneSalesRow = {
  zone: string;
  kind: StaffKind;
  person: string | null;
  organization: string | null;
  blocks: number;
  sum: number;
  days: number;
  // The money of the period before, and the change against it in % (null: nothing to compare with).
  before: number;
  change: number | null;
  // The zone's stores on the route, and those of them anyone sold to in the period.
  clients: number;
  buying: number;
  coverage: number | null;
  // From the route analysis: a rep's hit rate, a TSM's attendance.
  hitRate: number | null;
  attendance: number | null;
};

type Money = { blocks: number; sum: number; before: number; change: number | null };

export type ZoneSales = {
  // Everything sold in the period, whoever sold it.
  total: Money;
  // Sold by reps with no route in the analysis (operators, zones not in the route file): the
  // leadership sees how much of the sales the zones below do not explain.
  outside: { blocks: number; sum: number; share: number | null; staff: number };
  // The stores on the shown reps' routes, and those of them with a sale.
  clients: number;
  buying: number;
  rows: ZoneSalesRow[];
  // Sales stored before the rep and the money were read (24.11.2026): the report has to be
  // uploaded again for them to count.
  legacy: boolean;
};

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
// The change of a sum in %, to one decimal (null: nothing before).
const change = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;

export function zoneSales(input: {
  // The zones shown (already those the viewer may see).
  zones: RouteZone[];
  // The stores of each zone's route in the period, by titleKey of the zone.
  clients: Map<string, Set<string>>;
  groups: SalesGroup[];
  // Every rep's zone of the route analysis, whoever may see it: what is «outside» is outside of
  // these.
  repZones: string[];
  legacy?: boolean;
}): ZoneSales {
  const { zones, groups } = input;
  const sold = new Set(groups.flatMap((g) => (g.period === "now" ? g.stores : [])));
  const sums = (pick: (g: SalesGroup) => string | null) => {
    const by = new Map<string, { blocks: number; sum: number; days: number; before: number }>();
    for (const g of groups) {
      const name = pick(g);
      if (!name) continue;
      const key = titleKey(name);
      let entry = by.get(key);
      if (!entry) by.set(key, (entry = { blocks: 0, sum: 0, days: 0, before: 0 }));
      if (g.period === "now") {
        entry.blocks += g.blocks;
        entry.sum += g.sum;
        entry.days += g.days;
      } else entry.before += g.sum;
    }
    return by;
  };
  const byStaff = sums((g) => g.staff);
  const byTsm = sums((g) => g.tsm);

  const rows = zones.map((z): ZoneSalesRow => {
    const key = titleKey(z.zone);
    const sales = (z.kind === "DR" ? byStaff : byTsm).get(key) ?? {
      blocks: 0,
      sum: 0,
      days: 0,
      before: 0,
    };
    const stores = input.clients.get(key) ?? new Set<string>();
    let buying = 0;
    for (const store of stores) if (sold.has(store)) buying += 1;
    return {
      zone: z.zone,
      kind: z.kind,
      person: z.person,
      organization: z.organization,
      blocks: sales.blocks,
      sum: sales.sum,
      days: sales.days,
      before: sales.before,
      change: change(sales.sum, sales.before),
      clients: stores.size,
      buying,
      coverage: percent(buying, stores.size),
      hitRate: z.kind === "DR" ? z.hitRate : null,
      attendance: z.attendance,
    };
  });

  const now = groups.filter((g) => g.period === "now");
  const total = {
    blocks: now.reduce((a, g) => a + g.blocks, 0),
    sum: now.reduce((a, g) => a + g.sum, 0),
    before: groups.reduce((a, g) => a + (g.period === "before" ? g.sum : 0), 0),
  };
  const known = new Set(input.repZones.map(titleKey));
  const outsideGroups = now.filter((g) => g.staff && !known.has(titleKey(g.staff)));
  const outside = {
    blocks: outsideGroups.reduce((a, g) => a + g.blocks, 0),
    sum: outsideGroups.reduce((a, g) => a + g.sum, 0),
  };
  // A store on two shown reps' routes is one store.
  const repStores = new Set(
    zones.flatMap((z) => (z.kind === "DR" ? [...(input.clients.get(titleKey(z.zone)) ?? [])] : [])),
  );
  let buying = 0;
  for (const store of repStores) if (sold.has(store)) buying += 1;

  return {
    total: { ...total, change: change(total.sum, total.before) },
    outside: {
      ...outside,
      share: percent(outside.sum, total.sum),
      staff: new Set(outsideGroups.map((g) => titleKey(g.staff!))).size,
    },
    clients: repStores.size,
    buying,
    // The biggest fall first; what has nothing to compare with after, by the money.
    rows: rows.sort(
      (a, b) =>
        Number(a.kind === "DR") - Number(b.kind === "DR") ||
        (a.change ?? Infinity) - (b.change ?? Infinity) ||
        a.sum - b.sum ||
        a.zone.localeCompare(b.zone, undefined, { numeric: true }),
    ),
    legacy: input.legacy ?? false,
  };
}
