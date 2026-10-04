import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";

import { parseGeometry, slotKey } from "./geometry";
import type { Layout, SkuInfo } from "./layout";
import type { Rule } from "./validate";

export const planogramInclude = {
  equipment: true,
  slots: true,
  rules: true,
  headerPosm: true,
  priceList: { select: { id: true, name: true, effectiveFrom: true } },
} satisfies Prisma.PlanogramInclude;

export type PlanogramRecord = Prisma.PlanogramGetPayload<{ include: typeof planogramInclude }>;

export function layoutFromSlots(
  slots: PlanogramRecord["slots"],
  posmSpans: Map<string, number>,
): Layout {
  const layout: Layout = {};
  for (const slot of slots) {
    const key = slotKey(slot.shelf, slot.position);
    if (slot.kind === "SKU" && slot.skuId)
      layout[key] = { kind: "SKU", skuId: slot.skuId, badges: slot.badges };
    else if (slot.kind === "POSM" && slot.posmId)
      layout[key] = { kind: "POSM", posmId: slot.posmId, span: posmSpans.get(slot.posmId) ?? 1 };
    else layout[key] = { kind: "EMPTY" };
  }
  return layout;
}

export function slotsFromLayout(
  planogramId: string,
  layout: Layout,
): Prisma.PlanogramSlotCreateManyInput[] {
  return Object.entries(layout).map(([key, content]) => {
    const [shelf, position] = key.split(":").map(Number);
    return {
      planogramId,
      shelf,
      position,
      kind: content.kind,
      skuId: content.kind === "SKU" ? content.skuId : null,
      posmId: content.kind === "POSM" ? content.posmId : null,
      badges: content.kind === "SKU" ? content.badges : [],
    };
  });
}

export function rulesFromRecords(rules: PlanogramRecord["rules"]): Rule[] {
  return rules.map((r) => ({
    kind: r.kind,
    severity: r.severity,
    enabled: r.enabled,
    params: (r.params ?? {}) as Record<string, unknown>,
  }));
}

export async function loadSkuInfos(): Promise<
  (SkuInfo & {
    color: string;
    priceStyle: "NUMBER" | "MING";
    imagePath: string | null;
    archived: boolean;
  })[]
> {
  const skus = await db.sku.findMany({ orderBy: [{ brand: "asc" }, { code: "asc" }] });
  return skus.map((s) => ({
    id: s.id,
    code: s.code,
    brand: s.brand,
    name: s.name,
    isNew: s.isNew,
    isMandatory: s.isMandatory,
    defaultBadges: s.defaultBadges,
    color: s.color,
    priceStyle: s.priceStyle,
    imagePath: s.imagePath,
    archived: s.archived,
  }));
}

export async function posmSpans() {
  const posm = await db.posm.findMany({ select: { id: true, slotSpan: true } });
  return new Map(posm.map((p) => [p.id, p.slotSpan]));
}

export async function priceMap(priceListId: string | null): Promise<Map<string, number>> {
  if (!priceListId) return new Map();
  const prices = await db.skuPrice.findMany({ where: { priceListId } });
  return new Map(prices.map((p) => [p.skuId, p.price]));
}

// Everything the editor, the validator and the exports need about one planogram.
export async function loadPlanogram(id: string) {
  const record = await db.planogram.findUnique({ where: { id }, include: planogramInclude });
  if (!record) return null;
  const spans = await posmSpans();
  return {
    record,
    geometry: parseGeometry(record.equipment.geometry),
    layout: layoutFromSlots(record.slots, spans),
    rules: rulesFromRecords(record.rules),
    prices: await priceMap(record.priceListId),
  };
}

export type LoadedPlanogram = NonNullable<Awaited<ReturnType<typeof loadPlanogram>>>;

export function periodLabel(record: Pick<PlanogramRecord, "validFrom" | "validTo">): string {
  const from = record.validFrom ? toDateString(record.validFrom) : null;
  const to = record.validTo ? toDateString(record.validTo) : null;
  return [from, to].filter(Boolean).join(" – ");
}
