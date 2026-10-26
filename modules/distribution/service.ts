import { db } from "@/lib/db";
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
  stock,
  totalUnits,
  tsmBase,
  type Count,
  type Item,
  type TypeFacts,
} from "./compute";
import { DistributionParseError, parseDistributionWorkbook } from "./parse";
import { DIST_TYPES, sortRegions, tsmDestination } from "./types";

type Viewer = Parameters<typeof canUseModule>[0];

// Everyone with the section sees the analysis and records shipments; uploading a new file and
// changing the items' settings are for the owner and managers.
export const canSeeDistribution = (user: Viewer) => canUseModule(user, "distribution");
export const canManageDistribution = (user: Viewer) =>
  (user.role === "OWNER" || user.role === "MANAGER") && canSeeDistribution(user);

export class DistributionError extends Error {
  constructor(
    public readonly code:
      "forbidden" | "badFile" | "noEquipment" | "noPosm" | "tooBig" | "invalid" | "notFound",
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
  equipmentCode: string;
  planogramId: string | null;
  title: string | null;
  status: string | null;
  slots: number | null;
  facings: Record<number, number>;
};

// The planogram of each equipment type: the latest approved one, else the latest draft. Its
// facings by price tell how many price tags of each price one unit needs.
export async function planogramFacts(): Promise<{ facts: TypeFacts; links: PlanogramLink[] }> {
  const codes = [...new Set(DIST_TYPES.map((t) => t.equipment))];
  const equipment = await db.equipment.findMany({
    where: { code: { in: codes } },
    select: {
      id: true,
      code: true,
      geometry: true,
      planograms: {
        where: { isTemplate: false, status: { not: "ARCHIVED" } },
        select: { id: true, status: true, updatedAt: true },
      },
    },
  });
  const byCode = new Map<string, Omit<PlanogramLink, "type">>();
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
    byCode.set(e.code, {
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
    ...(byCode.get(t.equipment) ?? {
      equipmentCode: t.equipment,
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

// Everything the pages need, computed once per request.
export async function loadDistribution() {
  const [counts, rows, shipments, includeStock, planogram, lastImport] = await Promise.all([
    db.distEquipmentCount.findMany(),
    db.distPosm.findMany({ orderBy: { position: "asc" } }),
    db.distShipment.findMany({
      orderBy: [{ shippedOn: "desc" }, { createdAt: "desc" }],
      include: {
        posm: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    }),
    getIncludeStock(),
    planogramFacts(),
    db.activityLog.findFirst({
      where: { action: "distribution.imported" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const items: Item[] = rows.map((r) => ({ ...r }));
  const regions = regionBase(counts, includeStock);
  const tsms = tsmBase(counts);
  const total = totalUnits(regions);
  const { facts, links } = planogram;
  const plans = items.map((item) => planItem(item, regions, tsms, facts));
  const controls = items.map((item) => controlItem(item, total));
  const tags = priceTagNeed(items, total, facts);
  return {
    counts: counts as Count[],
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
    importedAt: lastImport?.createdAt ?? null,
    destinations: [
      ...sortRegions(regions.keys()),
      ...[...tsms.keys()].map((t) => tsmDestination(t)),
    ],
  };
}

export type Distribution = Awaited<ReturnType<typeof loadDistribution>>;

const MAX_FILE = 20 * 1024 * 1024;

// A new file replaces the equipment counts and updates the items by name; items missing from the
// file stay (with their shipments) so the history isn't lost.
export async function importDistributionFile(actor: Actor & Viewer, buffer: Buffer) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  if (buffer.length > MAX_FILE) throw new DistributionError("tooBig");
  let parsed;
  try {
    parsed = await parseDistributionWorkbook(buffer);
  } catch (error) {
    if (error instanceof DistributionParseError) throw new DistributionError(error.code);
    throw error;
  }
  await db.$transaction(async (tx) => {
    await tx.distEquipmentCount.deleteMany({});
    await tx.distEquipmentCount.createMany({ data: parsed.counts });
    for (const p of parsed.posm)
      await tx.distPosm.upsert({ where: { name: p.name }, create: p, update: p });
  });
  if (parsed.includeStock !== null) await setIncludeStockValue(parsed.includeStock);
  await logActivity({
    actorId: actor.id,
    action: "distribution.imported",
    entityType: "DistPosm",
    entityId: "file",
    details: { counts: parsed.counts.length, posm: parsed.posm.length },
  });
  return { counts: parsed.counts.length, posm: parsed.posm.length };
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
  if (!(await db.distPosm.findUnique({ where: { id } }))) throw new DistributionError("notFound");
  await db.distPosm.update({ where: { id }, data: input });
  await logActivity({
    actorId: actor.id,
    action: "distribution.posm",
    entityType: "DistPosm",
    entityId: id,
  });
}

export async function addShipment(
  actor: Actor & Viewer,
  input: {
    posmId: string;
    destination: string;
    quantity: number;
    shippedOn: string;
    note?: string;
  },
  destinations: string[],
) {
  if (!canSeeDistribution(actor)) throw new DistributionError("forbidden");
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0 ||
    !isDateString(input.shippedOn) ||
    !destinations.includes(input.destination)
  )
    throw new DistributionError("invalid");
  if (!(await db.distPosm.findUnique({ where: { id: input.posmId } })))
    throw new DistributionError("notFound");
  const created = await db.distShipment.create({
    data: {
      posmId: input.posmId,
      destination: input.destination,
      quantity: input.quantity,
      shippedOn: fromDateString(input.shippedOn),
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.shipped",
    entityType: "DistShipment",
    entityId: created.id,
    details: { destination: input.destination, quantity: input.quantity },
  });
  return created;
}

// A whole waybill at once: every item of a destination with its planned quantity.
export async function shipWaybill(
  actor: Actor & Viewer,
  destination: string,
  lines: { posmId: string; quantity: number }[],
  shippedOn: string,
  destinations: string[],
) {
  const created = [];
  for (const line of lines.filter((l) => l.quantity > 0))
    created.push(await addShipment(actor, { ...line, destination, shippedOn }, destinations));
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
