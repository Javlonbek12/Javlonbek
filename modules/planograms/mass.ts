import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { parseGeometry } from "./geometry";
import { loadPlanogram, loadSkuInfos, type Shelftalkers } from "./repository";
import { copyPlanogram } from "./service";
import { adaptLayout, insertSku, replaceSku } from "./transform";
import { withMandatory } from "./validate";

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
  // The pack each new version pushed off the end of the shelf: the user has to see it.
  const pushedOff: { planogramId: string; title: string; skuId: string }[] = [];
  for (const { id } of planograms) {
    const loaded = (await loadPlanogram(id))!;
    const result = insertSku(loaded.layout, loaded.geometry, shelf, position, skuId, badges);
    if (!result.ok) {
      skipped.push(id);
      continue;
    }
    const version = await copyPlanogram(actor, id, {
      layout: result.layout,
      status: "PENDING_APPROVAL",
    });
    created.push(version.id);
    if (result.droppedSkuId)
      pushedOff.push({
        planogramId: version.id,
        title: loaded.record.title,
        skuId: result.droppedSkuId,
      });
  }
  await logActivity({
    actorId: actor.id,
    action: "planogram.mass_insert",
    entityType: "Sku",
    entityId: skuId,
    details: { created: created.length, skipped: skipped.length, pushedOff: pushedOff.length },
  });
  return { created, skipped, pushedOff };
}

// A new planogram for other equipment (another size or channel) from an existing one: same title,
// the layout kept in place where it fits (see adaptLayout), the header when the new equipment has
// one, the shelftalkers of the shelves that have them there. `dropped`: SKUs that found no place.
export async function adaptPlanogram(actor: Actor, planogramId: string, equipmentId: string) {
  requireManager(actor);
  const [loaded, equipment] = await Promise.all([
    loadPlanogram(planogramId),
    db.equipment.findUnique({ where: { id: equipmentId } }),
  ]);
  if (!loaded || !equipment) throw new PlanogramError("notFound");
  const geometry = parseGeometry(equipment.geometry);
  const skus = withMandatory(await loadSkuInfos(), equipment.mandatorySkuIds);
  const { layout, dropped } = adaptLayout(loaded.layout, loaded.geometry, geometry, skus);
  const shelftalkers: Shelftalkers = {};
  for (const [shelf, posmId] of Object.entries(loaded.shelftalkers))
    if (geometry.shelves[Number(shelf)]?.talker) shelftalkers[Number(shelf)] = posmId;
  const created = await copyPlanogram(actor, planogramId, {
    asNew: true,
    layout,
    equipmentId,
    headerPosmId: geometry.header ? loaded.record.headerPosmId : null,
    shelftalkers,
  });
  await db.planogram.update({ where: { id: created.id }, data: { channel: equipment.channel } });
  const names = new Map(skus.map((s) => [s.id, s.name]));
  return { planogram: created, dropped, droppedNames: dropped.map((id) => names.get(id) ?? id) };
}
