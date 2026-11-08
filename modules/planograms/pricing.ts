import { z } from "zod";

import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fromDateString, isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";

import { canApprovePlanograms, canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { mergePriceLists, priceChanges, type PriceChange } from "./prices";
import { approvePlanogram, copyPlanogram } from "./service";

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

// Planograms on a list older than this one (or on none): what this list replaces. A planogram on
// a newer list keeps it — opening an older list must never roll its prices back.
function onOlderList(list: { effectiveFrom: Date; createdAt: Date }): Prisma.PlanogramWhereInput {
  return {
    OR: [
      { priceListId: null },
      { priceList: { effectiveFrom: { lt: list.effectiveFrom } } },
      { priceList: { effectiveFrom: list.effectiveFrom, createdAt: { lt: list.createdAt } } },
    ],
  };
}

// Approved planograms on older lists whose price tags would change with this list. A planogram
// that already has a version on this list (one left a draft by an earlier apply) is skipped:
// applying again must not make a second one.
export async function previewPriceList(priceListId: string): Promise<PricePreview> {
  const list = await db.priceList.findUnique({
    where: { id: priceListId },
    include: { prices: true },
  });
  if (!list) throw new PlanogramError("notFound");
  const newPrices = new Map(list.prices.map((p) => [p.skuId, p.price]));
  const [planograms, onThisList] = await Promise.all([
    db.planogram.findMany({
      where: { status: "APPROVED", isTemplate: false, ...onOlderList(list) },
      include: {
        slots: { where: { kind: "SKU" }, select: { skuId: true } },
        priceList: { include: { prices: true } },
      },
      orderBy: { title: "asc" },
    }),
    db.planogram.findMany({
      where: { priceListId, isTemplate: false, status: { not: "ARCHIVED" } },
      select: { rootId: true, id: true },
    }),
  ]);
  const done = new Set(onThisList.map((p) => p.rootId ?? p.id));
  return planograms
    .filter((p) => !done.has(p.rootId ?? p.id))
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

// Planograms being prepared (drafts and versions waiting for approval) on a list older than this
// one. When the list is applied they move to it: otherwise a version approved later would bring
// the old prices back.
export async function draftsOnOlderLists(priceListId: string) {
  const list = await db.priceList.findUnique({ where: { id: priceListId } });
  if (!list) throw new PlanogramError("notFound");
  return db.planogram.findMany({
    where: {
      isTemplate: false,
      status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      ...onOlderList(list),
    },
    select: { id: true, title: true, version: true, status: true },
    orderBy: [{ title: "asc" }, { version: "asc" }],
  });
}

// Every affected planogram gets a new version with the new prices; old versions keep theirs. The
// version is approved only if it passes the same check as any approval: with critical violations
// it stays a draft, and the one applying the list and the planogram's author hear it. Drafts and
// versions waiting for approval on older lists move to this one (their status stays).
export async function applyPriceList(actor: Actor, priceListId: string) {
  if (!canApprovePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const preview = await previewPriceList(priceListId);
  const list = await db.priceList.findUniqueOrThrow({ where: { id: priceListId } });
  const waiting = await draftsOnOlderLists(priceListId);
  const created: string[] = [];
  const drafts: string[] = [];
  for (const item of preview) {
    const version = await copyPlanogram(actor, item.planogramId, { priceListId });
    created.push(version.id);
    try {
      await approvePlanogram(actor, version.id);
    } catch (error) {
      if (!(error instanceof PlanogramError) || error.code !== "critical") throw error;
      drafts.push(version.id);
      const previous = await db.planogram.findUniqueOrThrow({
        where: { id: item.planogramId },
        select: { createdById: true },
      });
      for (const userId of new Set([actor.id, previous.createdById]))
        await notify(userId, () => ({
          type: "planogram",
          title: t("notifications.events.planogramCriticalTitle"),
          body: t("notifications.events.planogramCriticalBody", {
            title: item.title,
            list: list.name,
          }),
          link: `/planograms/${version.id}`,
        }));
    }
  }
  const moved = waiting.map((p) => p.id);
  await db.$transaction([
    db.planogram.updateMany({ where: { id: { in: moved } }, data: { priceListId } }),
    db.priceList.update({ where: { id: priceListId }, data: { appliedAt: new Date() } }),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "price_list.applied",
    entityType: "PriceList",
    entityId: priceListId,
    details: { planograms: created.length, drafts: drafts.length, moved: moved.length },
  });
  return { created, drafts, moved };
}

export async function listPriceLists() {
  return db.priceList.findMany({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { prices: true, planograms: true } } },
  });
}
