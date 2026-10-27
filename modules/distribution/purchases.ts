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
  input: { types: string[]; quantity: number; date: string; document: string; note?: string },
) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const document = input.document.trim();
  // In the order of the type list, each once.
  const types = DIST_TYPES.map((d) => d.code).filter((c) => input.types.includes(c));
  if (
    types.length === 0 ||
    types.length !== new Set(input.types).size ||
    !Number.isFinite(input.quantity) ||
    input.quantity === 0 ||
    !isDateString(input.date) ||
    !document ||
    document.length > 200
  )
    throw new DistributionError("invalid");
  const created = await db.distPurchase.create({
    data: {
      types,
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
    details: { types, quantity: input.quantity, document },
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
    details: { types: row.types, quantity: row.quantity, document: row.document },
  });
}
