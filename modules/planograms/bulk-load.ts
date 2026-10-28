import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";

import { geometrySchema, parseGeometry, slotKey } from "./geometry";
import type { Layout } from "./layout";
import { saveEquipment, saveImage, savePosm, saveSku } from "./library";
import { createPriceList } from "./pricing";
import { parseShelftalkers, type Shelftalkers } from "./repository";
import { createPlanogram, saveLayout } from "./service";

// Loads a whole planogram library at once (the server's data-load script): equipment, SKUs,
// POSM with pictures, a price list, draft planograms and shelftalkers. Safe to repeat: equipment
// and SKUs are matched by code, POSM by name, planograms by title (an existing one is left as it
// is). Every part may be left out.

const image = z.string().max(4_000_000).optional();

export const planogramBundleSchema = z.object({
  equipment: z
    .array(
      z.object({
        code: z.string(),
        name: z.string(),
        channel: z.string(),
        geometry: geometrySchema,
      }),
    )
    .default([]),
  skus: z
    .array(
      z.object({
        code: z.string(),
        brand: z.string(),
        name: z.string(),
        format: z.string().nullable().default(null),
        isNew: z.boolean().default(false),
        isMandatory: z.boolean().default(false),
        defaultBadges: z.array(z.string()).default([]),
        priceStyle: z.enum(["NUMBER", "MING"]).default("NUMBER"),
        color: z.string().default("#64748b"),
        image,
      }),
    )
    .default([]),
  posm: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["HEADER", "BANNER", "STICKER", "SHELFTALKER"]),
        slotSpan: z.number().int(),
        shelfSpan: z.number().int().min(1).default(1),
        color: z.string().default("#16a34a"),
        image,
      }),
    )
    .default([]),
  priceList: z
    .object({
      name: z.string(),
      effectiveFrom: z.string(),
      prices: z.record(z.string(), z.number()),
    })
    .nullable()
    .default(null),
  planograms: z
    .array(
      z.object({
        title: z.string(),
        equipment: z.string(),
        channel: z.string(),
        project: z.string().nullable().default(null),
        notes: z.string().nullable().default(null),
        header: z.string().nullable().default(null),
        slots: z.array(
          z.object({
            shelf: z.number().int(),
            position: z.number().int(),
            sku: z.string().optional(),
            posm: z.string().optional(),
            // How many slots this POSM covers here (the same banner is wider on bigger displays).
            span: z.number().int().optional(),
            badges: z.array(z.string()).default([]),
          }),
        ),
      }),
    )
    .default([]),
  // Shelftalkers of a model: shelf number (0 = top) → POSM name. The shelves get the shelftalker
  // mark, and each draft planogram of the model without shelftalkers gets these.
  shelftalkers: z
    .array(z.object({ equipment: z.string(), shelves: z.record(z.string(), z.string()) }))
    .default([]),
});
export type PlanogramBundle = z.input<typeof planogramBundleSchema>;

const picture = (base64: string, name: string) =>
  new File([Buffer.from(base64, "base64")], name, { type: "application/octet-stream" });

export async function loadPlanogramBundle(actor: Actor, input: unknown) {
  const bundle = planogramBundleSchema.parse(input);
  const report: string[] = [];

  const equipmentIds = new Map<string, string>();
  for (const e of bundle.equipment) {
    const existing = await db.equipment.findUnique({ where: { code: e.code } });
    // Equipment that already has planograms keeps its shape (saveEquipment refuses changes).
    const saved =
      existing && (await db.planogram.count({ where: { equipmentId: existing.id } }))
        ? existing
        : await saveEquipment(actor, existing?.id ?? null, e);
    equipmentIds.set(e.code, saved.id);
  }
  report.push(`equipment: ${bundle.equipment.length}`);

  const skuIds = new Map<string, string>();
  for (const s of bundle.skus) {
    const existing = await db.sku.findUnique({ where: { code: s.code } });
    const saved = await saveSku(actor, existing?.id ?? null, {
      code: s.code,
      brand: s.brand,
      name: s.name,
      format: s.format,
      isNew: s.isNew,
      newSince: null,
      isMandatory: existing?.isMandatory ?? s.isMandatory,
      defaultBadges: s.defaultBadges,
      priceStyle: s.priceStyle,
      color: s.color,
    });
    if (s.image) await saveImage(actor, "sku", saved.id, picture(s.image, `${s.code}.png`));
    skuIds.set(s.code, saved.id);
  }
  report.push(`skus: ${bundle.skus.length}`);

  const posmIds = new Map<string, string>();
  for (const p of bundle.posm) {
    const existing = await db.posm.findFirst({ where: { name: p.name } });
    const saved = await savePosm(actor, existing?.id ?? null, {
      name: p.name,
      type: p.type,
      slotSpan: p.slotSpan,
      shelfSpan: p.shelfSpan,
      color: p.color,
    });
    if (p.image) await saveImage(actor, "posm", saved.id, picture(p.image, "posm.png"));
    posmIds.set(p.name, saved.id);
  }
  report.push(`posm: ${bundle.posm.length}`);

  let priceListId: string | null = null;
  if (bundle.priceList) {
    const existing = await db.priceList.findFirst({ where: { name: bundle.priceList.name } });
    if (existing) priceListId = existing.id;
    else {
      const { list, unknown } = await createPriceList(
        actor,
        { name: bundle.priceList.name, effectiveFrom: bundle.priceList.effectiveFrom },
        Object.entries(bundle.priceList.prices).map(([code, price]) => ({ code, price })),
      );
      priceListId = list.id;
      if (unknown.length) report.push(`prices for unknown codes: ${unknown.join(", ")}`);
    }
  }

  let created = 0;
  for (const p of bundle.planograms) {
    if (await db.planogram.findFirst({ where: { title: p.title } })) {
      report.push(`kept as is: ${p.title}`);
      continue;
    }
    const equipmentId = equipmentIds.get(p.equipment);
    if (!equipmentId) throw new Error(`Unknown equipment ${p.equipment}`);
    const planogram = await createPlanogram(actor, {
      title: p.title,
      channel: p.channel,
      project: p.project,
      validFrom: null,
      validTo: null,
      priceListId,
      notes: p.notes,
      equipmentId,
      fill: "empty",
    });
    const geometry = parseGeometry(
      (await db.equipment.findUniqueOrThrow({ where: { id: equipmentId } })).geometry,
    );
    const layout: Layout = {};
    for (const slot of p.slots) {
      const key = slotKey(slot.shelf, slot.position);
      if (slot.sku) {
        const skuId = skuIds.get(slot.sku);
        if (!skuId) throw new Error(`Unknown SKU ${slot.sku}`);
        layout[key] = { kind: "SKU", skuId, badges: slot.badges };
      } else if (slot.posm) {
        const posmId = posmIds.get(slot.posm);
        if (!posmId) throw new Error(`Unknown POSM ${slot.posm}`);
        const posm = bundle.posm.find((x) => x.name === slot.posm)!;
        const span = slot.span ?? posm.slotSpan;
        layout[key] = {
          kind: "POSM",
          posmId,
          span: Math.min(span, geometry.shelves[slot.shelf]!.slots - slot.position),
          rows: Math.min(posm.shelfSpan, geometry.shelves.length - slot.shelf),
        };
      } else layout[key] = { kind: "EMPTY" };
    }
    await saveLayout(
      actor,
      planogram.id,
      layout,
      p.header ? (posmIds.get(p.header) ?? null) : null,
    );
    created++;
  }
  report.push(`planograms created: ${created}`);

  for (const t of bundle.shelftalkers) {
    const equipment = await db.equipment.findUnique({ where: { code: t.equipment } });
    if (!equipment) throw new Error(`Unknown equipment ${t.equipment}`);
    const shelftalkers: Shelftalkers = {};
    for (const [shelf, name] of Object.entries(t.shelves)) {
      const posm = await db.posm.findFirst({ where: { name, type: "SHELFTALKER" } });
      if (!posm) throw new Error(`Unknown shelftalker ${name}`);
      shelftalkers[Number(shelf)] = posm.id;
    }
    // The mark on the shelves moves no slot, so it may change on equipment in use.
    const geometry = parseGeometry(equipment.geometry);
    if (Object.keys(shelftalkers).some((shelf) => !geometry.shelves[Number(shelf)]))
      throw new Error(`No such shelf on ${t.equipment}`);
    await db.equipment.update({
      where: { id: equipment.id },
      data: {
        geometry: {
          ...geometry,
          shelves: geometry.shelves.map((shelf, i) =>
            String(i) in shelftalkers ? { ...shelf, talker: true } : shelf,
          ),
        } as Prisma.InputJsonValue,
      },
    });
    // Only drafts that have none yet: what is approved or chosen by hand stays as it is.
    const planograms = await db.planogram.findMany({
      where: { equipmentId: equipment.id, status: { not: "ARCHIVED" } },
    });
    let filled = 0;
    for (const p of planograms) {
      if (p.status !== "DRAFT" || Object.keys(parseShelftalkers(p.shelftalkers)).length) continue;
      await db.planogram.update({
        where: { id: p.id },
        data: { shelftalkers: shelftalkers as Prisma.InputJsonValue },
      });
      filled++;
    }
    report.push(
      `shelftalkers ${t.equipment}: shelves ${Object.keys(shelftalkers).join(",")}, planograms ${filled} of ${planograms.length}`,
    );
  }
  return report;
}
