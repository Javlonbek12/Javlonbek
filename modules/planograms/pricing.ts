import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canApprovePlanograms, canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { mergePriceLists, priceChanges, type PriceChange } from "./prices";
import { copyPlanogram } from "./service";

export type PriceRow = { code: string; price: number };

const inputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  effectiveFrom: z.string().refine(isDateString),
});

async function latestList(before?: Date) {
  return db.priceList.findFirst({
    where: before ? { createdAt: { lt: before } } : {},
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: { prices: true },
  });
}

// A new price list = the latest one + uploaded rows (unknown SKU codes are reported, not created).
export async function createPriceList(
  actor: Actor,
  input: { name: string; effectiveFrom: string },
  rows: PriceRow[],
) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const meta = inputSchema.safeParse(input);
  if (!meta.success || rows.length === 0) throw new PlanogramError("invalid");
  const skus = await db.sku.findMany({ select: { id: true, code: true } });
  const byCode = new Map(skus.map((s) => [s.code.toUpperCase(), s.id]));
  const uploaded = new Map<string, number>();
  const unknown: string[] = [];
  for (const row of rows) {
    const id = byCode.get(row.code.trim().toUpperCase());
    if (!id || !Number.isFinite(row.price) || row.price <= 0) unknown.push(row.code);
    else uploaded.set(id, Math.round(row.price));
  }
  const previous = await latestList();
  const merged = mergePriceLists(
    new Map(previous?.prices.map((p) => [p.skuId, p.price]) ?? []),
    uploaded,
  );
  const list = await db.priceList.create({
    data: {
      name: meta.data.name,
      effectiveFrom: fromDateString(meta.data.effectiveFrom),
      createdById: actor.id,
      prices: { create: [...merged].map(([skuId, price]) => ({ skuId, price })) },
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "price_list.created",
    entityType: "PriceList",
    entityId: list.id,
    details: { rows: uploaded.size, unknown: unknown.length },
  });
  return { list, unknown };
}

export type PricePreview = {
  planogramId: string;
  title: string;
  version: number;
  changes: PriceChange[];
}[];

// Active (approved) planograms whose price tags would change with this list.
export async function previewPriceList(priceListId: string): Promise<PricePreview> {
  const list = await db.priceList.findUnique({
    where: { id: priceListId },
    include: { prices: true },
  });
  if (!list) throw new PlanogramError("notFound");
  const newPrices = new Map(list.prices.map((p) => [p.skuId, p.price]));
  const planograms = await db.planogram.findMany({
    where: { status: "APPROVED", isTemplate: false, NOT: { priceListId } },
    include: {
      slots: { where: { kind: "SKU" }, select: { skuId: true } },
      priceList: { include: { prices: true } },
    },
    orderBy: { title: "asc" },
  });
  return planograms
    .map((p) => {
      const old = new Map(p.priceList?.prices.map((x) => [x.skuId, x.price]) ?? []);
      return {
        planogramId: p.id,
        title: p.title,
        version: p.version,
        changes: priceChanges(
          p.slots.map((s) => s.skuId!),
          old,
          newPrices,
        ),
      };
    })
    .filter((p) => p.changes.length > 0);
}

// Every affected planogram gets a new approved version with the new prices; old versions keep theirs.
export async function applyPriceList(actor: Actor, priceListId: string) {
  if (!canApprovePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const preview = await previewPriceList(priceListId);
  const created: string[] = [];
  for (const item of preview) {
    const version = await copyPlanogram(actor, item.planogramId, {
      priceListId,
      status: "APPROVED",
    });
    created.push(version.id);
  }
  await db.priceList.update({ where: { id: priceListId }, data: { appliedAt: new Date() } });
  await logActivity({
    actorId: actor.id,
    action: "price_list.applied",
    entityType: "PriceList",
    entityId: priceListId,
    details: { planograms: created.length },
  });
  return created;
}

export async function listPriceLists() {
  return db.priceList.findMany({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { prices: true, planograms: true } } },
  });
}
