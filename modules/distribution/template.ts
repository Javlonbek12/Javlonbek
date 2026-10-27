import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { parseLaunchTemplate } from "./parse";
import { canManageDistribution, DistributionError, parsed } from "./service";

type Viewer = Parameters<typeof canManageDistribution>[0];

// A POSM launch template («POSM_ESSE_Change_1_28-06.xlsx»), uploaded on purpose:
// - «Parameters» → the purchase journal: each equipment line (Display L = DG L + Metawerk L, …)
//   is one entry for its group, document = the file name; uploading the same file again replaces
//   its entries, nothing else in the journal changes;
// - «BOM Matrix» → the size catalog: each element's print size and pieces per unit on each type
//   (shelftalkers by shelf: «Shelftalker №1», «№2»…); new element names become new elements.
export async function importLaunchTemplate(
  actor: Actor & Viewer,
  buffer: Buffer,
  input: { fileName: string; date: string },
) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
  const document = input.fileName.trim().slice(0, 200);
  if (!document || !isDateString(input.date)) throw new DistributionError("invalid");
  const file = await parsed(buffer, parseLaunchTemplate);
  const date = fromDateString(input.date);

  let created = 0;
  await db.$transaction(async (tx) => {
    if (file.equipment.length) {
      await tx.distPurchase.deleteMany({ where: { document } });
      await tx.distPurchase.createMany({
        data: file.equipment
          .filter((e) => e.count !== 0)
          .map((e) => ({
            types: e.types,
            quantity: e.count,
            date,
            document,
            note: [file.launch, e.label].filter(Boolean).join(" · ") || null,
            createdById: actor.id,
          })),
      });
    }
    const elements = new Map(
      (await tx.distElement.findMany()).map((e) => [e.name.toLowerCase(), e]),
    );
    let position = Math.max(0, ...[...elements.values()].map((e) => e.position));
    for (const s of file.sizes) {
      let element = elements.get(s.element.toLowerCase());
      if (!element) {
        position += 1;
        element = await tx.distElement.create({
          data: { name: s.element, position, material: s.material },
        });
        elements.set(s.element.toLowerCase(), element);
        created += 1;
      }
      const data = {
        heightMm: s.heightMm,
        widthMm: s.widthMm,
        perUnit: s.perUnit,
        material: s.material,
        verified: true,
      };
      await tx.distElementSize.upsert({
        where: { elementId_type: { elementId: element.id, type: s.type } },
        create: { elementId: element.id, type: s.type, ...data },
        update: data,
      });
    }
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.template",
    entityType: "DistPurchase",
    entityId: "file",
    details: {
      document,
      purchases: file.equipment.length,
      sizes: file.sizes.length,
      elements: created,
    },
  });
  return {
    launch: file.launch,
    purchases: file.equipment.filter((e) => e.count !== 0).length,
    bought: file.equipment.reduce((s, e) => s + e.count, 0),
    sizes: file.sizes.length,
    elements: created,
    skipped: file.skipped,
  };
}
