import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { parseGeometry } from "./geometry";
import { loadPlanogram, loadSkuInfos } from "./repository";
import { copyPlanogram } from "./service";
import { adaptLayout, insertSku, replaceSku } from "./transform";

function requireManager(actor: Actor) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
}

// New versions (sent for approval) of every approved planogram that contains `fromSkuId`.
export async function replaceSkuEverywhere(actor: Actor, fromSkuId: string, toSkuId: string) {
  requireManager(actor);
  if (fromSkuId === toSkuId || !(await db.sku.findUnique({ where: { id: toSkuId } })))
    throw new PlanogramError("invalid");
  const planograms = await db.planogram.findMany({
    where: { status: "APPROVED", isTemplate: false, slots: { some: { skuId: fromSkuId } } },
    select: { id: true },
  });
  const created: string[] = [];
  for (const { id } of planograms) {
    const loaded = (await loadPlanogram(id))!;
    const { layout } = replaceSku(loaded.layout, fromSkuId, toSkuId);
    created.push((await copyPlanogram(actor, id, { layout, status: "PENDING_APPROVAL" })).id);
  }
  await logActivity({
    actorId: actor.id,
    action: "planogram.mass_replace",
    entityType: "Sku",
    entityId: fromSkuId,
    details: { to: toSkuId, planograms: created.length },
  });
  return created;
}

// Puts a (new) SKU at the same place on every approved planogram of one equipment type.
export async function insertSkuEverywhere(
  actor: Actor,
  equipmentId: string,
  skuId: string,
  shelf: number,
  position: number,
) {
  requireManager(actor);
  const sku = await db.sku.findUnique({ where: { id: skuId } });
  if (!sku) throw new PlanogramError("invalid");
  const badges = [...new Set([...(sku.isNew ? ["YANGI"] : []), ...sku.defaultBadges])];
  const planograms = await db.planogram.findMany({
    where: { status: "APPROVED", isTemplate: false, equipmentId },
    select: { id: true },
  });
  const created: string[] = [];
  const skipped: string[] = [];
  for (const { id } of planograms) {
    const loaded = (await loadPlanogram(id))!;
    const result = insertSku(loaded.layout, loaded.geometry, shelf, position, skuId, badges);
    if (!result.ok) {
      skipped.push(id);
      continue;
    }
    created.push(
      (await copyPlanogram(actor, id, { layout: result.layout, status: "PENDING_APPROVAL" })).id,
    );
  }
  await logActivity({
    actorId: actor.id,
    action: "planogram.mass_insert",
    entityType: "Sku",
    entityId: skuId,
    details: { created: created.length, skipped: skipped.length },
  });
  return { created, skipped };
}

// A new planogram for other equipment (another size or channel) from an existing one.
export async function adaptPlanogram(actor: Actor, planogramId: string, equipmentId: string) {
  requireManager(actor);
  const [loaded, equipment] = await Promise.all([
    loadPlanogram(planogramId),
    db.equipment.findUnique({ where: { id: equipmentId } }),
  ]);
  if (!loaded || !equipment) throw new PlanogramError("notFound");
  const { layout, dropped } = adaptLayout(
    loaded.layout,
    loaded.geometry,
    parseGeometry(equipment.geometry),
    await loadSkuInfos(),
  );
  const created = await copyPlanogram(actor, planogramId, {
    asNew: true,
    layout,
    equipmentId,
    title: `${equipment.name} ${equipment.channel}`,
  });
  await db.planogram.update({ where: { id: created.id }, data: { channel: equipment.channel } });
  return { planogram: created, dropped };
}
