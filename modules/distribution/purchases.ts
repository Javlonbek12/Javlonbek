import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canManageDistribution, DistributionError } from "./service";
import { DIST_TYPES } from "./types";

type Viewer = Parameters<typeof canManageDistribution>[0];

// The purchase journal: what was bought of each equipment type, by hand only (uploads never
// touch it). Its sum is the ceiling of the control equation. A correction is a negative entry.
export async function listPurchases() {
  return db.distPurchase.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function addPurchase(
  actor: Actor & Viewer,
  input: { type: string; quantity: number; date: string; document: string; note?: string },
) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const document = input.document.trim();
  if (
    !DIST_TYPES.some((d) => d.code === input.type) ||
    !Number.isFinite(input.quantity) ||
    input.quantity === 0 ||
    !isDateString(input.date) ||
    !document ||
    document.length > 200
  )
    throw new DistributionError("invalid");
  const created = await db.distPurchase.create({
    data: {
      type: input.type,
      quantity: input.quantity,
      date: fromDateString(input.date),
      document,
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.purchase",
    entityType: "DistPurchase",
    entityId: created.id,
    details: { type: input.type, quantity: input.quantity, document },
  });
  return created;
}

export async function deletePurchase(actor: Actor & Viewer, id: string) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const row = await db.distPurchase.findUnique({ where: { id } });
  if (!row) throw new DistributionError("notFound");
  await db.distPurchase.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.purchaseDeleted",
    entityType: "DistPurchase",
    entityId: id,
    details: { type: row.type, quantity: row.quantity, document: row.document },
  });
}
