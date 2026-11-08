import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { DIST_TYPES, TYPE_CODES } from "@/modules/distribution/types";

import { geometrySchema } from "./geometry";
import { sideColorOf } from "./side-color";

const MAX_IMAGE_MB = 10;

function requireManager(actor: Actor) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------- equipment ----------

const equipmentSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_\-×x]{2,40}$/),
  name: z.string().trim().min(1).max(100),
  channel: z.string().trim().min(1).max(40),
  geometry: geometrySchema,
  // Types of the equipment file (BW) this model is.
  distTypes: z
    .array(z.string())
    .default([])
    .refine((list) => list.every((t) => TYPE_CODES.includes(t as never))),
  // The SKUs mandatory on this model; empty = the SKUs marked «обязательный».
  mandatorySkuIds: z.array(z.string().max(64)).max(500).default([]),
});

export type EquipmentInput = z.input<typeof equipmentSchema>;

export async function saveEquipment(actor: Actor, id: string | null, input: EquipmentInput) {
  requireManager(actor);
  const parsed = equipmentSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
  const known = new Set(
    (
      await db.sku.findMany({
        where: { id: { in: parsed.data.mandatorySkuIds } },
        select: { id: true },
      })
    ).map((s) => s.id),
  );
  const data = {
    ...parsed.data,
    geometry: parsed.data.geometry as Prisma.InputJsonValue,
    mandatorySkuIds: [...new Set(parsed.data.mandatorySkuIds)].filter((s) => known.has(s)),
  };
  // A type is one model: taking it here takes it from any other.
  const release = async (keep: string | null) => {
    if (data.distTypes.length === 0) return;
    const others = await db.equipment.findMany({
      where: { distTypes: { hasSome: data.distTypes }, ...(keep ? { id: { not: keep } } : {}) },
    });
    for (const o of others)
      await db.equipment.update({
        where: { id: o.id },
        data: { distTypes: o.distTypes.filter((t) => !data.distTypes.includes(t)) },
      });
  };
  if (!id) {
    await release(null);
    return db.equipment.create({ data });
  }
  // The shape of equipment that already has planograms can't change: their slots would break.
  const used = await db.planogram.count({ where: { equipmentId: id } });
  const current = await db.equipment.findUnique({ where: { id } });
  if (!current) throw new PlanogramError("notFound");
  // Shelftalkers on the shelves don't move any slot: they may change anyway.
  const shape = (g: unknown) => {
    const parsed = geometrySchema.parse(g);
    return JSON.stringify({
      ...parsed,
      shelves: parsed.shelves.map((shelf) => ({ ...shelf, talker: undefined })),
    });
  };
  if (used > 0 && shape(current.geometry) !== shape(parsed.data.geometry))
    throw new PlanogramError("inUse");
  await release(id);
  const saved = await db.equipment.update({ where: { id }, data });
  await logActivity({
    actorId: actor.id,
    action: "equipment.saved",
    entityType: "Equipment",
    entityId: saved.id,
  });
  return saved;
}

// Every type of the equipment file (BW) with the planogram model it is now (if any).
export async function distTypeOptions() {
  const models = await db.equipment.findMany({
    where: { distTypes: { isEmpty: false } },
    select: { name: true, distTypes: true },
  });
  return DIST_TYPES.map((t) => ({
    code: t.code,
    label: t.label,
    owner: models.find((m) => m.distTypes.includes(t.code))?.name ?? null,
  }));
}

// The SKUs to pick a model's mandatory ones from: the current assortment, plus archived ones
// already picked (so they can be unticked).
export async function mandatorySkuOptions(selected: string[]) {
  const skus = await db.sku.findMany({
    where: { OR: [{ archived: false }, { id: { in: selected } }] },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
    select: { id: true, name: true, brand: true, isMandatory: true, archived: true },
  });
  return skus.map((s) => ({
    id: s.id,
    label: s.name,
    brand: s.brand,
    mandatory: s.isMandatory,
    archived: s.archived,
  }));
}

export async function listEquipment() {
  return db.equipment.findMany({
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { planograms: true } } },
  });
}

// ---------- SKU ----------

const skuSchema = z.object({
  code: z.string().trim().min(1).max(40),
  brand: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  format: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  defaultBadges: z.array(z.string().trim().min(1).max(12)).max(5),
  isNew: z.boolean(),
  newSince: z
    .string()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateString(v)),
  isMandatory: z.boolean(),
  priceStyle: z.enum(["NUMBER", "MING"]),
  color,
  archived: z.boolean().default(false),
});

export type SkuInput = z.input<typeof skuSchema>;

export async function saveSku(actor: Actor, id: string | null, input: SkuInput) {
  requireManager(actor);
  const parsed = skuSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
  const data = {
    ...parsed.data,
    newSince: parsed.data.newSince ? fromDateString(parsed.data.newSince) : null,
  };
  const clash = await db.sku.findUnique({ where: { code: data.code } });
  if (clash && clash.id !== id) throw new PlanogramError("invalid");
  const saved = id ? await db.sku.update({ where: { id }, data }) : await db.sku.create({ data });
  await logActivity({
    actorId: actor.id,
    action: "sku.saved",
    entityType: "Sku",
    entityId: saved.id,
  });
  return saved;
}

// ---------- POSM ----------

const posmSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["HEADER", "BANNER", "STICKER", "SHELFTALKER"]),
  slotSpan: z.number().int().min(1).max(40),
  shelfSpan: z.number().int().min(1).max(20).default(1),
  color,
  archived: z.boolean().default(false),
});

export type PosmInput = z.input<typeof posmSchema>;

// Planograms (approved or waiting for approval) a POSM item stands on: its size is the shape of
// their shelves, so it is locked while they use it (like the shape of equipment in use).
export async function posmInUse(id: string) {
  return db.planogram.count({
    where: {
      status: { in: ["APPROVED", "PENDING_APPROVAL"] },
      slots: { some: { posmId: id } },
    },
  });
}

export async function savePosm(actor: Actor, id: string | null, input: PosmInput) {
  requireManager(actor);
  const parsed = posmSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
  if (id) {
    const current = await db.posm.findUnique({ where: { id } });
    if (!current) throw new PlanogramError("notFound");
    const resized =
      current.slotSpan !== parsed.data.slotSpan || current.shelfSpan !== parsed.data.shelfSpan;
    if (resized && (await posmInUse(id)) > 0) throw new PlanogramError("posmInUse");
  }
  const saved = id
    ? await db.posm.update({ where: { id }, data: parsed.data })
    : await db.posm.create({ data: parsed.data });
  await logActivity({
    actorId: actor.id,
    action: "posm.saved",
    entityType: "Posm",
    entityId: saved.id,
  });
  return saved;
}

// ---------- pictures ----------

const uploadRoot = () => path.resolve(getEnv().UPLOAD_DIR);

// Stores a pack / POSM picture as PNG (max 600 px high), replacing the previous one.
export async function saveImage(actor: Actor, kind: "sku" | "posm", id: string, file: File) {
  requireManager(actor);
  if (file.size === 0 || file.size > MAX_IMAGE_MB * 1024 * 1024)
    throw new PlanogramError("fileTooLarge");
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ height: 600, withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new PlanogramError("badFile");
  }
  const relative = path.join("planograms", kind, `${id}-${Date.now()}.png`);
  await mkdir(path.dirname(path.join(uploadRoot(), relative)), { recursive: true });
  await writeFile(path.join(uploadRoot(), relative), png);
  const previous =
    kind === "sku"
      ? (await db.sku.findUniqueOrThrow({ where: { id } })).imagePath
      : (await db.posm.findUniqueOrThrow({ where: { id } })).imagePath;
  if (kind === "sku")
    await db.sku.update({
      where: { id },
      data: { imagePath: relative, sideColor: await sideColorOf(png) },
    });
  else await db.posm.update({ where: { id }, data: { imagePath: relative } });
  if (previous) await rm(path.join(uploadRoot(), previous), { force: true });
}

export async function readImage(relative: string | null): Promise<Buffer | null> {
  if (!relative) return null;
  const absolute = path.join(uploadRoot(), relative);
  if (!absolute.startsWith(uploadRoot() + path.sep)) return null;
  try {
    return await readFile(absolute);
  } catch {
    return null;
  }
}
