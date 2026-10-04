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
import { geometrySchema } from "./geometry";

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
});

export type EquipmentInput = z.input<typeof equipmentSchema>;

export async function saveEquipment(actor: Actor, id: string | null, input: EquipmentInput) {
  requireManager(actor);
  const parsed = equipmentSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
  const data = { ...parsed.data, geometry: parsed.data.geometry as Prisma.InputJsonValue };
  if (!id) return db.equipment.create({ data });
  // The shape of equipment that already has planograms can't change: their slots would break.
  const used = await db.planogram.count({ where: { equipmentId: id } });
  const current = await db.equipment.findUnique({ where: { id } });
  if (!current) throw new PlanogramError("notFound");
  if (used > 0 && JSON.stringify(current.geometry) !== JSON.stringify(parsed.data.geometry))
    throw new PlanogramError("inUse");
  const saved = await db.equipment.update({ where: { id }, data });
  await logActivity({
    actorId: actor.id,
    action: "equipment.saved",
    entityType: "Equipment",
    entityId: saved.id,
  });
  return saved;
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
  type: z.enum(["HEADER", "BANNER", "STICKER"]),
  slotSpan: z.number().int().min(1).max(40),
  color,
  archived: z.boolean().default(false),
});

export type PosmInput = z.input<typeof posmSchema>;

export async function savePosm(actor: Actor, id: string | null, input: PosmInput) {
  requireManager(actor);
  const parsed = posmSchema.safeParse(input);
  if (!parsed.success) throw new PlanogramError("invalid");
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
  if (kind === "sku") await db.sku.update({ where: { id }, data: { imagePath: relative } });
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
