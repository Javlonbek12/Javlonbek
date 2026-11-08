import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { fromDateString, isDateString } from "@/lib/dates";
import { canUseModule } from "@/modules/core/access/actor";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { totalSlots } from "@/modules/planograms/geometry";
import { loadPlanogram } from "@/modules/planograms/repository";

import {
  controlItem,
  findings,
  planItem,
  priceTagNeed,
  regionBase,
  remainder,
  stock,
  totalUnits,
  tsmBase,
  type Count,
  type Item,
  type ItemPlan,
  type TypeFacts,
} from "./compute";
import { controlRows, hasMinus, purchaseEntries, stockByType, type ControlRow } from "./control";
import {
  DistributionParseError,
  parseEquipmentFile,
  parseOutletBase,
  parsePosmList,
  type ParsedEquipment,
  type ParsedPosm,
} from "./parse";
import { DIST_TYPES, NO_TSM, sortRegions, tsmDestination } from "./types";

type Viewer = Parameters<typeof canUseModule>[0];

// Everyone with the section sees the analysis and records shipments; uploading a new file and
// changing the items' settings are for the owner and managers.
export const canSeeDistribution = (user: Viewer) => canUseModule(user, "distribution");
export const canManageDistribution = (user: Viewer) =>
  (user.role === "OWNER" || user.role === "MANAGER") && canSeeDistribution(user);

export class DistributionError extends Error {
  constructor(
    public readonly code:
      | "forbidden"
      | "badFile"
      | "noEquipment"
      | "noPosm"
      | "noOutlets"
      | "noTemplate"
      | "tooBig"
      | "invalid"
      | "notFound"
      | "closed"
      | "hasShipments"
      | "exists"
      | "noSizes"
      | "noLines"
      | "ordered"
      | "noReplacement"
      | "elementInUse"
      | "overPlan",
  ) {
    super(code);
    this.name = "DistributionError";
  }
}

const STOCK_KEY = "distribution.includeStock";

export async function getIncludeStock(): Promise<boolean> {
  const row = await db.systemState.findUnique({ where: { key: STOCK_KEY } });
  return row ? row.value === "1" : true;
}

async function setIncludeStockValue(value: boolean) {
  await db.systemState.upsert({
    where: { key: STOCK_KEY },
    create: { key: STOCK_KEY, value: value ? "1" : "0" },
    update: { value: value ? "1" : "0" },
  });
}

export async function setIncludeStock(actor: Actor & Viewer, value: boolean) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  await setIncludeStockValue(value);
}

export type PlanogramLink = {
  type: string;
  equipmentCode: string | null;
  planogramId: string | null;
  title: string | null;
  status: string | null;
  slots: number | null;
  facings: Record<number, number>;
};

// The planogram of each equipment type (through the planogram model the type is linked to):
// the latest approved one, else the latest draft. Its facings by price tell how many price
// tags of each price one unit needs.
export async function planogramFacts(): Promise<{ facts: TypeFacts; links: PlanogramLink[] }> {
  const equipment = await db.equipment.findMany({
    where: { distTypes: { isEmpty: false } },
    select: {
      id: true,
      code: true,
      distTypes: true,
      geometry: true,
      planograms: {
        where: { isTemplate: false, status: { not: "ARCHIVED" } },
        select: { id: true, status: true, updatedAt: true },
      },
    },
  });
  const byType = new Map<string, Omit<PlanogramLink, "type">>();
  for (const e of equipment) {
    const pick = [...e.planograms].sort(
      (a, b) =>
        Number(b.status === "APPROVED") - Number(a.status === "APPROVED") ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];
    const loaded = pick ? await loadPlanogram(pick.id) : null;
    const facings: Record<number, number> = {};
    if (loaded)
      for (const cell of Object.values(loaded.layout))
        if (cell.kind === "SKU") {
          const price = loaded.prices.get(cell.skuId);
          if (price) facings[price] = (facings[price] ?? 0) + 1;
        }
    for (const type of e.distTypes)
      byType.set(type, {
        equipmentCode: e.code,
        planogramId: loaded?.record.id ?? null,
        title: loaded?.record.title ?? null,
        status: loaded?.record.status ?? null,
        slots: loaded ? totalSlots(loaded.geometry) : null,
        facings,
      });
  }
  const links = DIST_TYPES.map((t) => ({
    type: t.code,
    ...(byType.get(t.code) ?? {
      equipmentCode: null,
      planogramId: null,
      title: null,
      status: null,
      slots: null,
      facings: {},
    }),
  }));
  return {
    facts: {
      slots: Object.fromEntries(DIST_TYPES.map((t) => [t.code, t.slots])),
      facings: Object.fromEntries(links.map((l) => [l.type, l.facings])),
    },
    links,
  };
}

export const ORDER_COOKIE = "dist-order";

export async function listOrders() {
  const orders = await db.distOrder.findMany({
    orderBy: [{ orderedOn: "desc" }, { createdAt: "desc" }],
    // The frozen split is big and only the order on screen needs it (loadDistribution).
    omit: { frozenBase: true },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      _count: { select: { posm: true, elements: true } },
    },
  });
  const shipped = await db.distShipment.groupBy({
    by: ["posmId"],
    _sum: { quantity: true },
  });
  const posm = await db.distPosm.findMany({ select: { id: true, orderId: true } });
  const orderOf = new Map(posm.map((p) => [p.id, p.orderId]));
  const byOrder = new Map<string, number>();
  for (const s of shipped) {
    const order = orderOf.get(s.posmId);
    if (order) byOrder.set(order, (byOrder.get(order) ?? 0) + (s._sum.quantity ?? 0));
  }
  return orders.map((o) => ({ ...o, items: o._count.posm, shipped: byOrder.get(o.id) ?? 0 }));
}

export type OrderRow = Awaited<ReturnType<typeof listOrders>>[number];

// The order the pages show: the one picked (kept in a cookie), else the latest open one.
export async function currentOrder(orders?: OrderRow[]) {
  const list = orders ?? (await listOrders());
  // Outside a request (scripts, tests) there are no cookies.
  let picked: string | undefined;
  try {
    picked = (await cookies()).get(ORDER_COOKIE)?.value;
  } catch {
    picked = undefined;
  }
  return list.find((o) => o.id === picked) ?? list.find((o) => !o.closed) ?? list[0] ?? null;
}

// The pick itself is a cookie, set by the page's action.
export async function checkOrder(id: string) {
  if (!(await db.distOrder.findUnique({ where: { id } }))) throw new DistributionError("notFound");
}

export async function posmOrderId(id: string) {
  const item = await db.distPosm.findUnique({ where: { id }, select: { orderId: true } });
  return item?.orderId ?? null;
}

// Installed equipment: unit by unit from the equipment file, the TSM looked up in the outlet base
// now (so a new base re-splits at once); units it has none for are «TSM не назначен». Before the
// first equipment file, the counts of the old format.
async function equipmentCounts(): Promise<Count[]> {
  const [grouped, stored] = await Promise.all([
    db.$queryRaw<{ region: string; type: string; tsm: string; count: number }[]>`
      SELECT u."region", u."type", COALESCE(NULLIF(o."tsm", ''), ${NO_TSM}) AS "tsm",
             SUM(u."units")::float8 AS "count"
      FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
      GROUP BY 1, 2, 3`,
    db.distEquipmentCount.findMany(),
  ]);
  const counts: Count[] = stored.map((c) => ({ ...c }));
  if (grouped.length === 0) return counts;
  const byRegion = new Map<string, Count>();
  const out = counts.filter((c) => c.kind === "STOCK");
  for (const g of grouped) {
    const key = `${g.region}|${g.type}`;
    const region = byRegion.get(key) ?? {
      kind: "INSTALLED" as const,
      region: g.region,
      tsm: "",
      type: g.type,
      count: 0,
    };
    region.count += g.count;
    byRegion.set(key, region);
    if (g.tsm)
      out.push({ kind: "INSTALLED", region: g.region, tsm: g.tsm, type: g.type, count: g.count });
  }
  return [...byRegion.values(), ...out];
}

// ——— The split's base, frozen when a campaign is ordered ———

// What the regional split is computed from: equipment counts by region and TSM, whether the
// warehouses count, and the planograms' facts (slots, facings by price).
export type SplitBase = {
  counts: Count[];
  includeStock: boolean;
  facts: TypeFacts;
  links: PlanogramLink[];
};
export type FrozenBase = SplitBase & { at: string };

export function parseFrozen(value: unknown): FrozenBase | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<FrozenBase>;
  return Array.isArray(v.counts) && v.facts && typeof v.at === "string"
    ? {
        counts: v.counts,
        includeStock: v.includeStock ?? true,
        facts: v.facts,
        links: v.links ?? [],
        at: v.at,
      }
    : null;
}

// A campaign made from a composition counts the warehouses as it chose; an order loaded from a
// POSM list file follows the common setting.
async function stockChoice(order: { withStock: boolean; _count?: { elements: number } } | null) {
  if (order && (order._count?.elements ?? 0) > 0) return order.withStock;
  return getIncludeStock();
}

async function liveBase(
  order: { withStock: boolean; _count?: { elements: number } } | null,
): Promise<SplitBase> {
  const [counts, includeStock, planogram] = await Promise.all([
    equipmentCounts(),
    stockChoice(order),
    planogramFacts(),
  ]);
  return { counts, includeStock, ...planogram };
}

// Fixes the split of an ordered campaign: from now on a new equipment file, outlet base or
// planogram doesn't move its plan (the POSM is printed for these numbers).
export async function freezeOrder(id: string) {
  const order = await db.distOrder.findUnique({
    where: { id },
    include: { _count: { select: { elements: true } } },
  });
  if (!order) return;
  const base: FrozenBase = { ...(await liveBase(order)), at: new Date().toISOString() };
  await db.distOrder.update({
    where: { id },
    data: { frozenBase: base as unknown as Prisma.InputJsonValue },
  });
}

// Ordered campaigns not frozen yet (ordered before freezing existed) get their split fixed as it
// is now: called before new equipment data replaces the old.
export async function freezeOrdered() {
  const open = await db.distOrder.findMany({
    where: { orderedOn: { not: null }, frozenBase: { equals: Prisma.DbNull } },
    select: { id: true },
  });
  for (const o of open) await freezeOrder(o.id);
}

// Everything the pages need for one order, computed once per request.
export async function loadDistribution(orderId?: string) {
  const orders = await listOrders();
  const order = orderId
    ? (orders.find((o) => o.id === orderId) ?? null)
    : await currentOrder(orders);
  // An ordered campaign keeps the split it was ordered with; one ordered before freezing existed
  // is frozen now, as it stands.
  const storedBase = async (id: string) =>
    parseFrozen(
      (await db.distOrder.findUnique({ where: { id }, select: { frozenBase: true } }))?.frozenBase,
    );
  let frozen = order ? await storedBase(order.id) : null;
  if (order?.orderedOn && !frozen) {
    await freezeOrder(order.id);
    frozen = await storedBase(order.id);
  }
  const posmIds = order
    ? (await db.distPosm.findMany({ where: { orderId: order.id }, select: { id: true } })).map(
        (p) => p.id,
      )
    : [];
  const [base, rows, shipments, sources] = await Promise.all([
    frozen ?? liveBase(order),
    order
      ? db.distPosm.findMany({ where: { orderId: order.id }, orderBy: { position: "asc" } })
      : Promise.resolve([]),
    db.distShipment.findMany({
      where: { posmId: { in: posmIds } },
      orderBy: [{ shippedOn: "desc" }, { createdAt: "desc" }],
      include: {
        posm: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    }),
    dataSources(),
  ]);
  const { counts, includeStock, facts, links } = base;
  const items: Item[] = rows.map((r) => ({ ...r }));
  const regions = regionBase(counts, includeStock);
  const tsms = tsmBase(counts);
  const total = totalUnits(regions);
  const plans = items.map((item) => planItem(item, regions, tsms, facts));
  const controls = items.map((item) => controlItem(item, total));
  const tags = priceTagNeed(items, total, facts);
  return {
    orders,
    order,
    counts,
    items,
    regions,
    tsms,
    total,
    includeStock,
    facts,
    links,
    plans,
    controls,
    tags,
    shipments,
    stock: stock(plans, shipments),
    findings: findings({
      items,
      regions,
      tsms,
      counts,
      includeStock,
      plans,
      controls,
      tags,
      facts,
    }),
    sources,
    importedAt: sources.equipment?.at ?? null,
    // When the split was fixed (the campaign was ordered); null = computed from the data now.
    frozenAt: frozen ? new Date(frozen.at) : null,
    destinations: [
      ...sortRegions(regions.keys()),
      ...[...tsms].flatMap(([region, people]) =>
        [...people.keys()].map((t) => tsmDestination(region, t)),
      ),
    ],
  };
}

export type Distribution = Awaited<ReturnType<typeof loadDistribution>>;

// When each file was last loaded, and what it held.
export async function dataSources() {
  const [equipment, outlets, units, outletCount] = await Promise.all([
    db.activityLog.findFirst({
      where: { action: { in: ["distribution.equipment", "distribution.imported"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.activityLog.findFirst({
      where: { action: "distribution.outlets" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.distUnit.count(),
    db.distOutlet.count(),
  ]);
  return {
    equipment: equipment ? { at: equipment.createdAt, units } : null,
    outlets: outlets ? { at: outlets.createdAt, count: outletCount } : null,
  };
}

const MAX_FILE = 20 * 1024 * 1024;

export async function parsed<T>(buffer: Buffer, parse: (b: Buffer) => Promise<T>): Promise<T> {
  if (buffer.length > MAX_FILE) throw new DistributionError("tooBig");
  try {
    return await parse(buffer);
  } catch (error) {
    if (error instanceof DistributionParseError) throw new DistributionError(error.code);
    throw error;
  }
}

const CHUNK = 2000;
const chunks = <T>(list: T[]) =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) =>
    list.slice(i * CHUNK, (i + 1) * CHUNK),
  );

// What the control equation would be with this file: its rows and its stock (or the stock
// loaded now, when the file has no «Current stock» block).
async function previewControl(file: ParsedEquipment): Promise<ControlRow[]> {
  const installed: Record<string, number> = {};
  for (const u of file.units) installed[u.type] = (installed[u.type] ?? 0) + u.units;
  const stock: Record<string, number> = {};
  for (const c of file.stock) stock[c.type] = (stock[c.type] ?? 0) + c.count;
  const [purchased, current] = await Promise.all([purchaseEntries(), stockByType()]);
  return controlRows(purchased, installed, file.stock.length ? stock : current);
}

export type EquipmentImport =
  | {
      status: "saved";
      rows: number;
      units: number;
      stock: number;
      skipped: number;
      noId: number;
      control: ControlRow[];
    }
  | { status: "pending"; id: string; control: ControlRow[] };

// The equipment file replaces the installed equipment; its «Current stock» block, when there is
// one, replaces the warehouse counts. The control table comes back at once; when it has a minus
// the file waits (DistPendingImport) until the user confirms it.
export async function importEquipmentFile(
  actor: Actor & Viewer,
  buffer: Buffer,
): Promise<EquipmentImport> {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const file = await parsed(buffer, parseEquipmentFile);
  const control = await previewControl(file);
  if (hasMinus(control)) {
    // One waiting file per day is plenty: older ones are dropped.
    await db.distPendingImport.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    });
    const pending = await db.distPendingImport.create({
      data: { payload: file as unknown as Prisma.InputJsonValue, createdById: actor.id },
    });
    return { status: "pending", id: pending.id, control };
  }
  return { status: "saved", ...(await saveEquipment(actor, file)), control };
}

export async function pendingImport(id: string) {
  const row = await db.distPendingImport.findUnique({ where: { id } });
  if (!row) return null;
  const file = row.payload as unknown as ParsedEquipment;
  return {
    id,
    createdAt: row.createdAt,
    rows: file.units.length,
    skipped: file.skipped.length,
    control: await previewControl(file),
  };
}

// Saves a waiting file despite its minus (the user saw the table), or drops it.
export async function resolvePendingImport(actor: Actor & Viewer, id: string, save: boolean) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const row = await db.distPendingImport.findUnique({ where: { id } });
  if (!row) throw new DistributionError("notFound");
  await db.distPendingImport.delete({ where: { id } });
  if (!save) return null;
  return saveEquipment(actor, row.payload as unknown as ParsedEquipment, true);
}

async function saveEquipment(actor: Actor & Viewer, file: ParsedEquipment, confirmed = false) {
  // Ordered campaigns keep the split they were ordered with.
  await freezeOrdered();
  const seen = [...new Map(file.units.filter((u) => u.outletId).map((u) => [u.outletId, u]))].map(
    ([outletId, u]) => ({ outletId, posName: u.posName, tin: u.tin }),
  );
  await db.$transaction(
    async (tx) => {
      await tx.distUnit.deleteMany({});
      for (const part of chunks(file.units)) await tx.distUnit.createMany({ data: part });
      for (const part of chunks(seen))
        await tx.distSeenOutlet.createMany({ data: part, skipDuplicates: true });
      await tx.distSkippedRow.deleteMany({});
      if (file.skipped.length) await tx.distSkippedRow.createMany({ data: file.skipped });
      await tx.distEquipmentCount.deleteMany({
        where: file.stock.length ? {} : { kind: "INSTALLED" },
      });
      if (file.stock.length)
        await tx.distEquipmentCount.createMany({
          data: file.stock.map((s) => ({ kind: "STOCK" as const, tsm: "", ...s })),
        });
    },
    { timeout: 60_000 },
  );
  const units = file.units.reduce((s, u) => s + u.units, 0);
  const noId = new Set(file.units.filter((u) => !u.outletId).map((u) => u.outletKey)).size;
  await logActivity({
    actorId: actor.id,
    action: "distribution.equipment",
    entityType: "DistUnit",
    entityId: "file",
    details: {
      rows: file.units.length,
      stock: file.stock.length,
      skipped: file.skipped.length,
      noId,
      ...(confirmed ? { confirmedMinus: true } : {}),
    },
  });
  return {
    rows: file.units.length,
    units: Math.round(units),
    stock: Math.round(file.stock.reduce((s, c) => s + c.count, 0)),
    skipped: file.skipped.length,
    noId,
  };
}

// The outlet base replaces the responsible TSMs (only «ID → TSM» is used; its region only shows
// outlets the file puts elsewhere).
export async function importOutletBase(actor: Actor & Viewer, buffer: Buffer) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const outlets = await parsed(buffer, parseOutletBase);
  await freezeOrdered();
  const unique = [...new Map(outlets.map((o) => [o.outletId, o])).values()];
  await db.$transaction(
    async (tx) => {
      await tx.distOutlet.deleteMany({});
      for (const part of chunks(unique)) await tx.distOutlet.createMany({ data: part });
    },
    { timeout: 60_000 },
  );
  const [matched] = await db.$queryRaw<
    { units: number; withTsm: number; missing: number; mismatched: number }[]
  >`
    SELECT COUNT(*)::int AS "units",
           COUNT(*) FILTER (WHERE NULLIF(o."tsm", '') IS NOT NULL)::int AS "withTsm",
           COUNT(DISTINCT u."outletId")
             FILTER (WHERE u."outletId" <> '' AND o."outletId" IS NULL)::int AS "missing",
           COUNT(DISTINCT u."outletId")
             FILTER (WHERE o."region" IS NOT NULL AND NOT (u."region" = ANY(string_to_array(o."region", ', '))))::int AS "mismatched"
    FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"`;
  await logActivity({
    actorId: actor.id,
    action: "distribution.outlets",
    entityType: "DistOutlet",
    entityId: "file",
    details: { outlets: unique.length, missing: matched?.missing ?? 0 },
  });
  return {
    outlets: unique.length,
    withTsm: unique.filter((o) => o.tsm).length,
    units: matched?.units ?? 0,
    unitsWithTsm: matched?.withTsm ?? 0,
    // Outlets of the equipment file (with an ID) the base does not have.
    missing: matched?.missing ?? 0,
    mismatched: matched?.mismatched ?? 0,
  };
}

// Items of a POSM list go into an order, matched by name; items missing from the list stay
// (with their shipments).
async function savePosm(orderId: string, list: ParsedPosm[]) {
  await db.$transaction(async (tx) => {
    for (const p of list)
      await tx.distPosm.upsert({
        where: { orderId_name: { orderId, name: p.name } },
        create: { ...p, orderId },
        update: p,
      });
  });
}

export async function createOrder(
  actor: Actor & Viewer,
  input: { name: string; orderedOn: string; note?: string; copyFrom?: string | null },
  file: Buffer | null,
) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const name = input.name.trim();
  if (!name || name.length > 120 || !isDateString(input.orderedOn))
    throw new DistributionError("invalid");
  const list = file ? await parsed(file, parsePosmList) : null;
  let copied: ParsedPosm[] = [];
  if (!list && input.copyFrom) {
    // A new order from the last one: the same items and settings; what is still on hand there
    // becomes the stock, the new quantities are entered (or uploaded) after.
    const previous = await loadDistribution(input.copyFrom);
    if (!previous.order) throw new DistributionError("notFound");
    copied = previous.stock.map((line) => ({
      ...pick(line.item),
      inStock: Math.max(0, line.onHand),
      ordered: 0,
    }));
  }
  if (!list && copied.length === 0) throw new DistributionError("noPosm");
  const order = await db.distOrder.create({
    data: {
      name,
      orderedOn: fromDateString(input.orderedOn),
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
  });
  await savePosm(order.id, list ?? copied);
  // An order loaded from a file is ordered already: its split is fixed now.
  await freezeOrder(order.id);
  await logActivity({
    actorId: actor.id,
    action: "distribution.order",
    entityType: "DistOrder",
    entityId: order.id,
    details: { name, items: (list ?? copied).length },
  });
  return order;
}

const pick = (item: Item): ParsedPosm => {
  const row = item as Item & Partial<ParsedPosm>;
  return {
    position: item.position,
    name: item.name,
    category: item.category,
    equipmentLabel: row.equipmentLabel ?? null,
    size: row.size ?? null,
    material: row.material ?? null,
    orderedFor: item.orderedFor,
    inStock: item.inStock,
    ordered: item.ordered,
    reservePct: item.reservePct,
    base: item.base as ParsedPosm["base"],
    norm: item.norm,
    normReserve: item.normReserve,
    types: item.types as ParsedPosm["types"],
  };
};

// A refreshed POSM list for an existing order.
export async function importPosmList(actor: Actor & Viewer, orderId: string, buffer: Buffer) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const order = await db.distOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new DistributionError("notFound");
  if (order.closed) throw new DistributionError("closed");
  const list = await parsed(buffer, parsePosmList);
  await savePosm(orderId, list);
  await logActivity({
    actorId: actor.id,
    action: "distribution.imported",
    entityType: "DistOrder",
    entityId: orderId,
    details: { posm: list.length },
  });
  return list.length;
}

export async function setOrderClosed(actor: Actor & Viewer, id: string, closed: boolean) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  if (!(await db.distOrder.findUnique({ where: { id } }))) throw new DistributionError("notFound");
  await db.distOrder.update({ where: { id }, data: { closed } });
  await logActivity({
    actorId: actor.id,
    action: closed ? "distribution.orderClosed" : "distribution.orderOpened",
    entityType: "DistOrder",
    entityId: id,
  });
}

// Only an order nothing was shipped from can be deleted: shipments are history.
export async function deleteOrder(actor: Actor & Viewer, id: string) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  if (!(await db.distOrder.findUnique({ where: { id } }))) throw new DistributionError("notFound");
  if (await db.distShipment.count({ where: { posm: { orderId: id } } }))
    throw new DistributionError("hasShipments");
  await db.distOrder.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.orderDeleted",
    entityType: "DistOrder",
    entityId: id,
  });
}

export async function deletePosm(actor: Actor & Viewer, id: string) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const item = await db.distPosm.findUnique({ where: { id }, include: { order: true } });
  if (!item) throw new DistributionError("notFound");
  if (item.order.closed) throw new DistributionError("closed");
  if (await db.distShipment.count({ where: { posmId: id } }))
    throw new DistributionError("hasShipments");
  await db.distPosm.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.posmDeleted",
    entityType: "DistPosm",
    entityId: id,
    details: { name: item.name },
  });
  return item.orderId;
}

export type PosmSettings = {
  inStock: number;
  ordered: number;
  reservePct: number;
  base: "UNITS" | "SLOTS" | "PLANOGRAM";
  norm: number | null;
  normReserve: number;
  types: string[];
};

export async function updatePosmSettings(actor: Actor & Viewer, id: string, input: PosmSettings) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const valid =
    [input.inStock, input.ordered].every((n) => Number.isInteger(n) && n >= 0) &&
    input.reservePct >= 0 &&
    input.reservePct <= 1 &&
    (input.norm === null || input.norm >= 0) &&
    input.normReserve >= 0 &&
    input.types.every((t) => DIST_TYPES.some((d) => d.code === t));
  if (!valid) throw new DistributionError("invalid");
  const item = await db.distPosm.findUnique({ where: { id }, include: { order: true } });
  if (!item) throw new DistributionError("notFound");
  if (item.order.closed) throw new DistributionError("closed");
  await db.distPosm.update({ where: { id }, data: input });
  await logActivity({
    actorId: actor.id,
    action: "distribution.posm",
    entityType: "DistPosm",
    entityId: id,
  });
}

// One shipment typed in on «Склад». It is checked against what the plan leaves for that
// destination (a waybill is capped the same way): more than that needs «сверх плана» ticked, so
// a typo can't eat another region's share. A second click with the same line within a minute
// records nothing new.
export async function addShipment(
  actor: Actor & Viewer,
  input: {
    posmId: string;
    destination: string;
    quantity: number;
    shippedOn: string;
    note?: string;
    overPlan?: boolean;
  },
  plan: { plans: ItemPlan[]; destinations: string[] },
  now = new Date(),
) {
  if (!canSeeDistribution(actor)) throw new DistributionError("forbidden");
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0 ||
    !isDateString(input.shippedOn) ||
    !plan.destinations.includes(input.destination)
  )
    throw new DistributionError("invalid");
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "DistPosm" WHERE "id" = ${input.posmId} FOR UPDATE`;
    const item = await tx.distPosm.findUnique({
      where: { id: input.posmId },
      include: { order: { select: { closed: true } } },
    });
    if (!item) throw new DistributionError("notFound");
    if (item.order.closed) throw new DistributionError("closed");
    const shippedOn = fromDateString(input.shippedOn);
    const repeat = await tx.distShipment.findFirst({
      where: {
        posmId: input.posmId,
        destination: input.destination,
        quantity: input.quantity,
        shippedOn,
        createdById: actor.id,
        createdAt: { gte: new Date(now.getTime() - 60_000) },
      },
    });
    if (repeat) return null;
    const itemPlan = plan.plans.find((p) => p.item.id === input.posmId);
    if (itemPlan && !input.overPlan) {
      const shipments = await tx.distShipment.findMany({
        where: { posmId: input.posmId },
        select: { posmId: true, destination: true, quantity: true },
      });
      if (input.quantity > remainder(itemPlan, input.destination, shipments).toSend)
        throw new DistributionError("overPlan");
    }
    return tx.distShipment.create({
      data: {
        posmId: input.posmId,
        destination: input.destination,
        quantity: input.quantity,
        shippedOn,
        note: input.note?.trim() || null,
        createdById: actor.id,
      },
    });
  });
  if (!created) return null;
  await logActivity({
    actorId: actor.id,
    action: "distribution.shipped",
    entityType: "DistShipment",
    entityId: created.id,
    details: {
      destination: input.destination,
      quantity: input.quantity,
      ...(input.overPlan ? { overPlan: true } : {}),
    },
  });
  return created;
}

// A whole waybill at once: every item of a destination with what is left to send. The quantities
// are capped to that remainder inside one transaction, with the items locked, so a second click
// (or someone else shipping meanwhile) can't record the same POSM twice.
export async function shipWaybill(
  actor: Actor & Viewer,
  destination: string,
  lines: { posmId: string; quantity: number }[],
  shippedOn: string,
  plan: { plans: ItemPlan[]; destinations: string[] },
) {
  if (!canSeeDistribution(actor)) throw new DistributionError("forbidden");
  if (!isDateString(shippedOn) || !plan.destinations.includes(destination))
    throw new DistributionError("invalid");
  const wanted = lines.filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  const ids = [...new Set(wanted.map((l) => l.posmId))];
  if (ids.length === 0) return 0;
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "DistPosm" WHERE "id" = ANY(${ids}) FOR UPDATE`;
    const items = await tx.distPosm.findMany({
      where: { id: { in: ids } },
      include: { order: { select: { closed: true } } },
    });
    if (items.some((i) => i.order.closed)) throw new DistributionError("closed");
    const shipments = await tx.distShipment.findMany({
      where: { posmId: { in: ids } },
      select: { posmId: true, destination: true, quantity: true },
    });
    const out: { id: string; quantity: number }[] = [];
    for (const line of wanted) {
      const p = plan.plans.find((x) => x.item.id === line.posmId);
      if (!p || !items.some((i) => i.id === line.posmId)) continue;
      const quantity = Math.min(line.quantity, remainder(p, destination, shipments).toSend);
      if (quantity <= 0) continue;
      const row = await tx.distShipment.create({
        data: {
          posmId: line.posmId,
          destination,
          quantity,
          shippedOn: fromDateString(shippedOn),
          createdById: actor.id,
        },
      });
      shipments.push({ posmId: line.posmId, destination, quantity });
      out.push({ id: row.id, quantity });
    }
    return out;
  });
  for (const row of created)
    await logActivity({
      actorId: actor.id,
      action: "distribution.shipped",
      entityType: "DistShipment",
      entityId: row.id,
      details: { destination, quantity: row.quantity },
    });
  return created.length;
}

// Removing a wrong record: its author, or the owner/managers.
export async function deleteShipment(actor: Actor & Viewer, id: string) {
  const shipment = await db.distShipment.findUnique({ where: { id } });
  if (!shipment) throw new DistributionError("notFound");
  if (shipment.createdById !== actor.id && !canManageDistribution(actor))
    throw new DistributionError("forbidden");
  await db.distShipment.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.unshipped",
    entityType: "DistShipment",
    entityId: id,
  });
}
