import { addDays } from "@/lib/dates";

import { managerOf } from "./attention";
import type { Hierarchy } from "./hierarchy";
import {
  personCode,
  skuKey,
  titleKey,
  type OosRecord,
  type OrderRecord,
  type RouteRecord,
  type SaleDayRecord,
  type SaleRecord,
} from "./parse";
import { staffKind } from "./route-codes";
import { SALES_WINDOW_DAYS, type SalesRange } from "./sales";

// «Путь OOS: от проверки до продажи», as pure functions (rules of 25.11.2026, see
// docs/DECISIONS.md). A stock check that found a product out starts a chain: the auto-stock order,
// the store's answer, the distributor rep's answer, the delivery (all from the Connect bot) — and
// whether Smart Up shows a sale of those products to that store within three days. Every check is
// its own chain, even when a store was checked several times.

// How far a chain got. The bot's export has the step in one status text and no answer times, so a
// chain has one step: the furthest reached.
export const PATH_STEPS = [
  "noOrder",
  "storeWaiting",
  "storeSilent",
  "storeRefused",
  "agentWaiting",
  "agentAccepted",
  "delivered",
  // An order whose status is not one of the known texts: shown as it is, never dropped.
  "other",
] as const;
export type PathStep = (typeof PATH_STEPS)[number];

// Were the products that were out sold to the store in the window: every one, some, none while
// other products were sold, none and nothing else either; `open` — the sales loaded do not cover
// the whole window yet («окно не закрыто»).
export const PATH_SOLD = ["all", "some", "noneOther", "noneNothing", "open"] as const;
export type PathSold = (typeof PATH_SOLD)[number];

// The chains shown on the page; the whole list is in the Excel file.
export const PATH_STORES_SHOWN = 30;

// The status texts of the Russian exports and of the English one (see localize.ts).
const DELIVERED = /^(доставлено|delivered)/i;
const NOT_DELIVERED = /^(не доставлено|not delivered)/i;
const CONFIRMED = /подтверждено|confirmed by/i;
const REFUSED = /отказ|отмен|refus|cancel/i;
const ACCEPTED = /^(агент принял|agent accepted)/i;
const AGENT_WAITING = /ожидает (агента|экспресс)|waiting for (the agent|an express)/i;
const SILENT = /не ответил|did not respond/i;
const STORE_WAITING =
  /^(ожидает ответа точки|отправлен|в ожидании|waiting for the store|sent|pending)/i;
// An answer column that says nothing yet.
const PENDING = /ожида|pending|waiting/i;

type OrderFields = Pick<
  OrderRecord,
  "status" | "storeAnswer" | "storeAnswerAt" | "agentAnswer" | "deliveredAt" | "outcome"
>;

// The step an order stands at. The separate answer columns count when the export fills them (the
// export of 11.2026 leaves them empty: the status alone says it).
export function orderStep(order: Partial<OrderFields>): {
  step: Exclude<PathStep, "noOrder">;
  confirmed: boolean;
} {
  const status = (order.status ?? "").trim();
  const outcome = (order.outcome ?? "").trim();
  const said = (answer: string | null | undefined) => Boolean(answer && !PENDING.test(answer));
  const at = (step: Exclude<PathStep, "noOrder">) => ({ step, confirmed: false });
  if (
    !NOT_DELIVERED.test(outcome) &&
    (DELIVERED.test(status) || DELIVERED.test(outcome) || order.deliveredAt)
  )
    return { step: "delivered", confirmed: CONFIRMED.test(status) || CONFIRMED.test(outcome) };
  if (REFUSED.test(status) || REFUSED.test(order.storeAnswer ?? "")) return at("storeRefused");
  if (ACCEPTED.test(status) || (said(order.agentAnswer) && !REFUSED.test(order.agentAnswer!)))
    return at("agentAccepted");
  // The store answered; the rep (or the express courier) has not.
  if (AGENT_WAITING.test(status) || said(order.storeAnswer) || order.storeAnswerAt)
    return at("agentWaiting");
  if (SILENT.test(status)) return at("storeSilent");
  if (STORE_WAITING.test(status)) return at("storeWaiting");
  return at("other");
}

// Which of two steps is further along the chain.
const RANK: Record<PathStep, number> = {
  noOrder: 0,
  other: 1,
  storeWaiting: 2,
  storeSilent: 3,
  storeRefused: 3,
  agentWaiting: 4,
  agentAccepted: 5,
  delivered: 6,
};

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

// One collator for every comparison: making one per call is what takes the time.
const byName = new Intl.Collator(undefined, { numeric: true }).compare;

// A share in whole percent; null when there is nothing to take it of.
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export type PathChain = {
  check: OosRecord;
  // Who made the check: the code and the name of «CODE - Name».
  code: string | null;
  name: string | null;
  // The products the check found out («Нет в наличии»), as written.
  out: string[];
  step: PathStep;
  // Delivered and the store confirmed it.
  confirmed: boolean;
  orderNo: string | null;
  // The distributor reps' zones of the store (none: on no rep's route and without a rep in the
  // client base).
  zones: string[];
  // The check's TSM is in the viewer's scope; the zones of `zones` that are.
  mine: boolean;
  shown: string[];
};

// The products a check found out. «Недостаточно» is on the shelf and «Не было закупа» is not a
// gap: neither starts a chain.
export const outOf = (check: OosRecord) =>
  Object.keys(check.skus).filter((sku) => check.skus[sku] === "OUT");

// The distributor reps' zones of each store on a route, by month: a zone once, however many rows
// it has there (another employee in the zone).
export type RepRoutes = Map<string, Map<string, Map<string, string>>>;

export function repRoutes(routes: RouteRecord[], hierarchy?: Hierarchy | null): RepRoutes {
  const kinds = new Map<string, boolean>();
  const isRep = (zone: string) => {
    let rep = kinds.get(zone);
    if (rep === undefined) kinds.set(zone, (rep = staffKind(zone, hierarchy) === "DR"));
    return rep;
  };
  const reps: RepRoutes = new Map();
  for (const route of routes) {
    if (!route.person || !isRep(route.person)) continue;
    let months = reps.get(route.storeCode);
    if (!months) reps.set(route.storeCode, (months = new Map()));
    let zones = months.get(route.month);
    if (!zones) months.set(route.month, (zones = new Map()));
    const key = titleKey(route.person);
    if (!zones.has(key)) zones.set(key, route.person);
  }
  return reps;
}

// The chains of a period: every stock check that found a product out, with the step its order
// stands at and the reps of its store. A chain counts when its TSM or a rep's zone of its store is
// in the scope (as «Заказ дистрибьютора после OOS» does).
export function pathChains(input: {
  // The period's checks and orders (test stores left out by the loader).
  oos: OosRecord[];
  orders: OrderRecord[];
  // Smart Up's route analysis of the period's months, by store.
  reps: RepRoutes;
  // The «DR» of Smart Up's client base, for the stores on no rep's route.
  clients?: Map<string, { dr: string | null }>;
  scope?: Scope;
}): PathChain[] {
  const inScope = scopeTest(input.scope ?? null);
  const found = input.oos
    .map((check) => ({ check, out: outOf(check) }))
    .filter((c) => c.out.length > 0);
  if (!found.length) return [];

  // An order names the check it came from; a check names its order.
  const bySource = new Map<string, OrderRecord[]>();
  const byNo = new Map<string, OrderRecord>();
  for (const order of input.orders) {
    byNo.set(order.id, order);
    if (order.sourceCheck)
      bySource.set(order.sourceCheck, [...(bySource.get(order.sourceCheck) ?? []), order]);
  }

  // Whose store it was when it was checked: the reps whose route had it in the check's month;
  // without one, in any month loaded; on no route at all, the rep the client base names.
  const zonesOf = (check: OosRecord) => {
    const months = input.reps.get(check.storeCode);
    if (!months) {
      const rep = input.clients?.get(check.storeCode)?.dr?.trim();
      return rep ? [rep] : [];
    }
    const own = months.get(check.day.slice(0, 7));
    if (own) return [...own.values()].sort(byName);
    const all = new Map<string, string>();
    for (const zones of months.values())
      for (const [key, zone] of zones) if (!all.has(key)) all.set(key, zone);
    return [...all.values()].sort(byName);
  };

  const chains: PathChain[] = [];
  for (const { check, out } of found) {
    const code = personCode(check.person);
    const zones = zonesOf(check);
    const mine = inScope(code);
    const shown = input.scope ? zones.filter(inScope) : zones;
    if (!mine && !shown.length) continue;

    const named = check.orderNo ? byNo.get(check.orderNo) : undefined;
    const orders = [...(bySource.get(check.id) ?? [])];
    if (named && !orders.includes(named)) orders.push(named);
    // The check's own row says where its order stands as well: that is all there is when the
    // order's row is not loaded (another period, no orders file), and the fresher of the two
    // exports is the further step.
    const states = orders.map((order) => ({ ...orderStep(order), orderNo: order.id }));
    if (check.orderCreated || check.orderNo || check.delivery)
      states.push({ ...orderStep({ status: check.delivery }), orderNo: check.orderNo ?? "" });
    const last = states.sort((a, b) => RANK[b.step] - RANK[a.step])[0];
    chains.push({
      check,
      code,
      name: check.person?.split(" - ").slice(1).join(" - ").trim() || null,
      out,
      step: last?.step ?? "noOrder",
      confirmed: last?.confirmed ?? false,
      orderNo: last ? last.orderNo || (orders[0]?.id ?? null) : null,
      zones,
      mine,
      shown,
    });
  }
  return chains;
}

// The sales of the checked stores, ready to look up.
export type PathSales = {
  range: SalesRange;
  // store|product key → blocks by delivery day; store → the days anything was sold to it.
  byKey: Map<string, { day: string; blocks: number }[]>;
  byStore: Map<string, Set<string>>;
};

// Takes the report's lines and whole store-days alike; null when no sales are loaded.
export function indexPathSales(
  sales: (SaleRecord | SaleDayRecord)[],
  range: SalesRange | null | undefined,
): PathSales | null {
  if (!range) return null;
  const byKey = new Map<string, { day: string; blocks: number }[]>();
  const byStore = new Map<string, Set<string>>();
  const add = (storeCode: string, day: string, sku: string, blocks: number) => {
    const key = `${storeCode}|${keyOf(sku)}`;
    const list = byKey.get(key);
    if (list) list.push({ day, blocks });
    else byKey.set(key, [{ day, blocks }]);
    if (blocks > 0) {
      const days = byStore.get(storeCode);
      if (days) days.add(day);
      else byStore.set(storeCode, new Set([day]));
    }
  };
  for (const sale of sales) {
    if ("skus" in sale)
      for (const sku in sale.skus) add(sale.storeCode, sale.day, sku, sale.skus[sku]!);
    else add(sale.storeCode, sale.day, sale.sku, sale.blocks);
  }
  return { range, byKey, byStore };
}

// Were the chain's products sold to its store on the check's day or the next three (a sale is
// counted on its delivery day; a product is sold when more of it was sold than returned).
export function chainSold(chain: PathChain, sales: PathSales | null): PathSold {
  const { check } = chain;
  const until = addDays(check.day, SALES_WINDOW_DAYS);
  if (!sales || check.day < sales.range.from || until > sales.range.to) return "open";
  const inWindow = (day: string) => day >= check.day && day <= until;
  let sold = 0;
  for (const sku of chain.out) {
    let blocks = 0;
    for (const line of sales.byKey.get(`${check.storeCode}|${keyOf(sku)}`) ?? [])
      if (inWindow(line.day)) blocks += line.blocks;
    if (blocks > 0) sold++;
  }
  if (sold === chain.out.length) return "all";
  if (sold > 0) return "some";
  for (const day of sales.byStore.get(check.storeCode) ?? []) if (inWindow(day)) return "noneOther";
  return "noneNothing";
}

// Chains counted by step and by what was sold.
type Tally = {
  checks: number;
  confirmed: number;
  cross: Record<PathStep, Record<PathSold, number>>;
};
const emptySold = (): Record<PathSold, number> => ({
  all: 0,
  some: 0,
  noneOther: 0,
  noneNothing: 0,
  open: 0,
});
const emptyTally = (): Tally => ({
  checks: 0,
  confirmed: 0,
  cross: Object.fromEntries(PATH_STEPS.map((step) => [step, emptySold()])) as Tally["cross"],
});
function count(tally: Tally, chain: PathChain, sold: PathSold) {
  tally.checks++;
  if (chain.confirmed) tally.confirmed++;
  tally.cross[chain.step][sold]++;
}

const sumSold = (c: Record<PathSold, number>) => c.all + c.some + c.noneOther + c.noneNothing;
const any = (c: Record<PathSold, number>) => c.all + c.some;
const none = (c: Record<PathSold, number>) => c.noneOther + c.noneNothing;

// The numbers of a row (a TSM, a rep's zone, a region, a manager, everyone): the steps, what was
// sold, and the two mismatches between the bot and Smart Up.
function rowOf(tally: Tally) {
  const steps = Object.fromEntries(
    PATH_STEPS.map((step) => [step, sumSold(tally.cross[step]) + tally.cross[step].open]),
  ) as Record<PathStep, number>;
  const sold = emptySold();
  for (const step of PATH_STEPS) for (const key of PATH_SOLD) sold[key] += tally.cross[step][key];
  const closed = tally.checks - sold.open;
  return {
    checks: tally.checks,
    orders: tally.checks - steps.noOrder,
    // «Не создал заказ»: the check found a product out and no order followed.
    noOrder: steps.noOrder,
    noOrderRate: rate(steps.noOrder, tally.checks),
    storeWaiting: steps.storeWaiting,
    storeSilent: steps.storeSilent,
    storeRefused: steps.storeRefused,
    // «DR не ответил»: the store chose a date, the rep (or the courier) has not answered.
    agentWaiting: steps.agentWaiting,
    agentAccepted: steps.agentAccepted,
    delivered: steps.delivered,
    confirmed: tally.confirmed,
    other: steps.other,
    // The window is closed: the shares of what was sold are of these.
    closed,
    open: sold.open,
    soldAll: sold.all,
    soldSome: sold.some,
    anySold: any(sold),
    soldRate: rate(any(sold), closed),
    notSold: none(sold),
    noneOther: sold.noneOther,
    noneNothing: sold.noneNothing,
    // Delivered in the bot, nothing of it sold in Smart Up.
    deliveredNoSale: none(tally.cross.delivered),
    // No order, or the store never answered — and the product was sold all the same (it came by
    // the rep's ordinary route).
    soldAnyway: any(tally.cross.noOrder) + any(tally.cross.storeSilent),
  };
}
export type PathRow = ReturnType<typeof rowOf>;

// The stages of the funnel tiles, each a part of the one before it.
export const PATH_STAGES = ["found", "order", "store", "agent", "delivered", "sold"] as const;
export type PathStage = (typeof PATH_STAGES)[number];

function funnelOf(tally: Tally) {
  const r = rowOf(tally);
  const store = r.agentWaiting + r.agentAccepted + r.delivered;
  const agent = r.agentAccepted + r.delivered;
  // Sold is asked of the deliveries whose window is closed.
  const deliveredClosed = r.delivered - tally.cross.delivered.open;
  const stage = (key: PathStage, value: number, of: number | null, stopped: number) => ({
    key,
    count: value,
    // The stage before it, and this one's share of it.
    of,
    rate: of === null ? null : rate(value, of),
    // The chains that went no further than the stage before.
    stopped,
  });
  return [
    stage("found", r.checks, null, 0),
    stage("order", r.orders, r.checks, r.noOrder),
    stage("store", store, r.orders, r.orders - store),
    stage("agent", agent, store, r.agentWaiting),
    stage("delivered", r.delivered, agent, r.agentAccepted),
    stage("sold", any(tally.cross.delivered), deliveredClosed, r.deliveredNoSale),
  ];
}

// Why a chain is in the list to act on.
export const PATH_REASONS = ["deliveredNoSale", "agentWaiting", "noOrderNoSale"] as const;
export type PathReason = (typeof PATH_REASONS)[number];

function reasonOf(chain: PathChain, sold: PathSold): PathReason | null {
  const unsold = sold === "noneOther" || sold === "noneNothing";
  if (chain.step === "delivered" && unsold) return "deliveredNoSale";
  if (chain.step === "agentWaiting") return "agentWaiting";
  if (chain.step === "noOrder" && unsold) return "noOrderNoSale";
  return null;
}

export function oosPath(
  chains: PathChain[],
  options: {
    // The sales of the chains' stores (null: none loaded — the steps only).
    sales: PathSales | null;
    hierarchy?: Hierarchy | null;
    // The region each TSM is counted in, by titleKey of the code (see tsmRegions in visits.ts).
    regions?: Map<string, string> | null;
    // The viewer sees every zone: the chains of stores on no rep's route get a row of their own.
    scope?: Scope;
  },
) {
  const { sales, hierarchy } = options;
  const all = emptyTally();
  const stores = new Set<string>();
  const people = new Map<string, Tally & { code: string; name: string | null }>();
  const zones = new Map<string, Tally & { zone: string }>();
  const noZone = emptyTally();
  const regions = new Map<string, Tally & { region: string; people: Set<string> }>();
  const managers = new Map<
    string,
    Tally & { title: string | null; name: string | null; people: Set<string> }
  >();
  const managerOfCode = new Map<string, ReturnType<typeof managerOf>>();
  const list: {
    id: string;
    reason: PathReason;
    store: string;
    storeCode: string;
    day: string;
    code: string | null;
    name: string | null;
    zones: string[];
    out: string[];
    step: PathStep;
    orderNo: string | null;
    sold: PathSold;
  }[] = [];
  let several = 0;

  for (const chain of chains) {
    const sold = chainSold(chain, sales);
    count(all, chain, sold);
    stores.add(chain.check.storeCode);
    if (chain.zones.length > 1) several++;

    for (const zone of chain.shown) {
      const key = titleKey(zone);
      let entry = zones.get(key);
      if (!entry) zones.set(key, (entry = { zone, ...emptyTally() }));
      count(entry, chain, sold);
    }
    if (!chain.zones.length) count(noZone, chain, sold);

    if (chain.mine) {
      const key = titleKey(chain.code ?? "");
      let person = people.get(key);
      if (!person)
        people.set(key, (person = { code: chain.code ?? "", name: chain.name, ...emptyTally() }));
      count(person, chain, sold);

      const region = options.regions?.get(key) ?? "—";
      let ofRegion = regions.get(region);
      if (!ofRegion)
        regions.set(region, (ofRegion = { region, people: new Set(), ...emptyTally() }));
      ofRegion.people.add(key);
      count(ofRegion, chain, sold);

      if (hierarchy) {
        let manager = managerOfCode.get(key);
        if (manager === undefined)
          managerOfCode.set(key, (manager = chain.code ? managerOf(hierarchy, chain.code) : null));
        const title = manager ? titleKey(manager.title) : "";
        let entry = managers.get(title);
        if (!entry)
          managers.set(
            title,
            (entry = {
              title: manager?.title ?? null,
              name: manager?.name ?? null,
              people: new Set(),
              ...emptyTally(),
            }),
          );
        entry.people.add(key);
        count(entry, chain, sold);
      }
    }

    const reason = reasonOf(chain, sold);
    if (reason)
      list.push({
        id: chain.check.id,
        reason,
        store: chain.check.storeName,
        storeCode: chain.check.storeCode,
        day: chain.check.day,
        code: chain.code,
        name: chain.name,
        zones: chain.zones,
        out: chain.out,
        step: chain.step,
        orderNo: chain.orderNo,
        sold,
      });
  }

  // The worst first. A TSM: the most checks left without an order. A rep: the most orders not
  // answered and deliveries without a sale. A region, a manager: the highest share without an order.
  const byNoOrder = (a: PathRow, b: PathRow) =>
    b.noOrder - a.noOrder || (b.noOrderRate ?? 0) - (a.noOrderRate ?? 0);
  const byShare = (a: PathRow, b: PathRow) =>
    (b.noOrderRate ?? 0) - (a.noOrderRate ?? 0) || b.checks - a.checks;
  const byTsm = [...people.values()]
    .map(({ code, name, ...tally }) => ({ code, name, ...rowOf(tally) }))
    .sort((a, b) => byNoOrder(a, b) || byName(a.code, b.code));
  const reps = [...zones.values()]
    .map(({ zone, ...tally }) => ({ zone, ...rowOf(tally) }))
    .sort(
      (a, b) =>
        b.agentWaiting + b.deliveredNoSale - (a.agentWaiting + a.deliveredNoSale) ||
        b.agentWaiting - a.agentWaiting ||
        b.checks - a.checks ||
        byName(a.zone, b.zone),
    );
  // «DR не определён» (zone null), last: the store is on no rep's route in the route analysis
  // loaded and the client base names no rep for it. Shown with the reps' rows the viewer has
  // (everyone's, or those of the zones in their scope).
  const byDr: ({ zone: string | null } & PathRow)[] =
    noZone.checks && (!options.scope || reps.length)
      ? [...reps, { zone: null, ...rowOf(noZone) }]
      : reps;

  const order: Record<PathReason, number> = {
    deliveredNoSale: 0,
    agentWaiting: 1,
    noOrderNoSale: 2,
  };
  return {
    days: SALES_WINDOW_DAYS,
    // The days the loaded sales cover (null: no sales loaded, the steps only).
    sales: sales?.range ?? null,
    totals: {
      ...rowOf(all),
      stores: stores.size,
      tsms: new Set(chains.map((c) => titleKey(c.code ?? ""))).size,
      // Chains whose store is on no rep's route, and on the routes of several.
      noZone: noZone.checks,
      severalZones: several,
    },
    funnel: funnelOf(all),
    // Step × sold, the steps in the chain's order; a step nobody stands at is left out.
    cross: PATH_STEPS.map((step) => {
      const c = all.cross[step];
      const checks = sumSold(c) + c.open;
      return { step, checks, anySold: any(c), anyRate: rate(any(c), checks - c.open), ...c };
    }).filter((row) => row.checks > 0),
    byTsm,
    byDr,
    byRegion: [...regions.values()]
      .map(({ region, people: ofRegion, ...tally }) => ({
        region,
        people: ofRegion.size,
        ...rowOf(tally),
      }))
      .sort((a, b) => byShare(a, b) || byName(a.region, b.region)),
    byManager: [...managers.values()]
      .map(({ title, name, people: under, ...tally }) => ({
        title,
        name,
        people: under.size,
        ...rowOf(tally),
      }))
      .sort((a, b) => byShare(a, b) || byName(a.title ?? "", b.title ?? "")),
    // The chains to act on: delivered and nothing sold, then waiting for the rep (the longest
    // first), then no order and nothing sold; within a group the most products out first.
    stores: list.sort(
      (a, b) =>
        order[a.reason] - order[b.reason] ||
        (a.reason === "agentWaiting" ? a.day.localeCompare(b.day) : 0) ||
        b.out.length - a.out.length ||
        b.day.localeCompare(a.day) ||
        byName(a.store, b.store),
    ),
  };
}
export type OosPath = ReturnType<typeof oosPath>;
