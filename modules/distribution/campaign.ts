import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { DistFileKind } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { detectFile } from "@/modules/content/files";
import { safeFileName } from "@/modules/tasks/attachment-service";

import { buildOrder, mm, perUnitKey, reserveLabel, typeLabel, type BuilderLine } from "./builder";
import { equipmentUnits, loadCatalog } from "./catalog";
import { canManageDistribution, canSeeDistribution, DistributionError } from "./service";
import { byTsmName, NO_TSM, sortRegions, TYPE_CODES } from "./types";

// A POSM campaign, step by step: concept → key visual → what to order on which equipment (+ the
// reserve) → the list → the printer's prices → ordered → split by region and TSM → replacement
// in the shops. The steps' state is read from the data, nothing to switch by hand.

type Viewer = Parameters<typeof canManageDistribution>[0];

function assertManager(actor: Actor & Viewer) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
}

async function loadOpen(id: string) {
  const order = await db.distOrder.findUnique({ where: { id } });
  if (!order) throw new DistributionError("notFound");
  if (order.closed) throw new DistributionError("closed");
  return order;
}

export async function createCampaign(
  actor: Actor & Viewer,
  input: { name: string; description?: string; projectId?: string | null },
) {
  assertManager(actor);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new DistributionError("invalid");
  if (input.projectId && !(await db.project.findUnique({ where: { id: input.projectId } })))
    throw new DistributionError("invalid");
  const order = await db.distOrder.create({
    data: {
      name,
      description: input.description?.trim() || null,
      projectId: input.projectId || null,
      createdById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.campaign",
    entityType: "DistOrder",
    entityId: order.id,
    details: { name },
  });
  return order;
}

export async function updateConcept(
  actor: Actor & Viewer,
  id: string,
  input: { name: string; description: string; projectId: string | null; approved: boolean },
) {
  assertManager(actor);
  const order = await loadOpen(id);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new DistributionError("invalid");
  if (input.projectId && !(await db.project.findUnique({ where: { id: input.projectId } })))
    throw new DistributionError("invalid");
  await db.distOrder.update({
    where: { id },
    data: {
      name,
      description: input.description.trim() || null,
      projectId: input.projectId || null,
      conceptApprovedAt: input.approved ? (order.conceptApprovedAt ?? new Date()) : null,
    },
  });
}

// ——— Files: concept, key visual, the printer's quote, EAS ———

export const MAX_CAMPAIGN_FILE_MB = 50;
const uploadRoot = () => path.resolve(getEnv().UPLOAD_DIR);

export async function addCampaignFile(
  actor: Actor & Viewer,
  id: string,
  kind: DistFileKind,
  file: File,
) {
  assertManager(actor);
  await loadOpen(id);
  if (!file.size || file.size > MAX_CAMPAIGN_FILE_MB * 1024 * 1024)
    throw new DistributionError("tooBig");
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectFile(buffer, file.name);
  const relative = path.join("distribution", id, `${randomUUID()}.${type.ext}`);
  const absolute = path.join(uploadRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);
  const row = await db.distCampaignFile.create({
    data: {
      orderId: id,
      kind,
      name: safeFileName(file.name) || `file.${type.ext}`,
      path: relative,
      // Only pictures are shown inline; the rest is downloaded.
      mime: type.kind === "PHOTO" ? type.mime : "application/octet-stream",
      size: file.size,
      createdById: actor.id,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.file",
    entityType: "DistOrder",
    entityId: id,
    details: { name: row.name, kind },
  });
  return row;
}

export async function removeCampaignFile(actor: Actor & Viewer, fileId: string) {
  assertManager(actor);
  const file = await db.distCampaignFile.findUnique({ where: { id: fileId } });
  if (!file) throw new DistributionError("notFound");
  await loadOpen(file.orderId);
  await db.distCampaignFile.delete({ where: { id: fileId } });
  await rm(path.join(uploadRoot(), file.path), { force: true });
  if (file.final && file.kind === "KEY_VISUAL") await refreshKvFinal(file.orderId);
}

async function refreshKvFinal(orderId: string) {
  const final = await db.distCampaignFile.findFirst({
    where: { orderId, kind: "KEY_VISUAL", final: true },
  });
  await db.distOrder.update({
    where: { id: orderId },
    data: { kvFinalAt: final ? final.createdAt : null },
  });
}

// Marks a key visual as final (or not): the campaign's KV step is done when one is final.
export async function setKvFinal(actor: Actor & Viewer, fileId: string, final: boolean) {
  assertManager(actor);
  const file = await db.distCampaignFile.findUnique({ where: { id: fileId } });
  if (!file || file.kind !== "KEY_VISUAL") throw new DistributionError("notFound");
  await loadOpen(file.orderId);
  await db.distCampaignFile.update({ where: { id: fileId }, data: { final } });
  await refreshKvFinal(file.orderId);
}

export async function getCampaignFile(user: Viewer, fileId: string) {
  if (!canSeeDistribution(user)) return null;
  const file = await db.distCampaignFile.findUnique({ where: { id: fileId } });
  if (!file) return null;
  return { file, absolutePath: path.join(uploadRoot(), file.path) };
}

// ——— What to order: elements on their own equipment types ———

export type CompositionInput = {
  reservePct: number;
  // Types whose reserve differs from reservePct.
  reserveByType: Record<string, number>;
  withStock: boolean;
  elements: { elementId: string; types: string[]; perUnit: Record<string, number> }[];
};

export async function saveComposition(actor: Actor & Viewer, id: string, input: CompositionInput) {
  assertManager(actor);
  const order = await loadOpen(id);
  if (order.orderedOn) throw new DistributionError("ordered");
  const valid =
    input.reservePct >= 0 &&
    input.reservePct <= 1 &&
    Object.entries(input.reserveByType).every(
      ([type, r]) => TYPE_CODES.includes(type as never) && Number.isFinite(r) && r >= 0 && r <= 1,
    ) &&
    input.elements.every(
      (e) =>
        e.types.every((type) => TYPE_CODES.includes(type as never)) &&
        Object.values(e.perUnit).every((n) => Number.isFinite(n) && n >= 0),
    );
  if (!valid) throw new DistributionError("invalid");
  const chosen = input.elements.filter((e) => e.types.length > 0);
  await db.$transaction(async (tx) => {
    await tx.distOrder.update({
      where: { id },
      data: {
        reservePct: input.reservePct,
        reserveByType: input.reserveByType,
        withStock: input.withStock,
      },
    });
    await tx.distCampaignElement.deleteMany({
      where: { orderId: id, elementId: { notIn: chosen.map((e) => e.elementId) } },
    });
    for (const e of chosen) {
      const data = { types: e.types, perUnit: e.perUnit };
      await tx.distCampaignElement.upsert({
        where: { orderId_elementId: { orderId: id, elementId: e.elementId } },
        create: { orderId: id, elementId: e.elementId, ...data },
        update: data,
      });
    }
  });
}

// The campaign's list as the builder counts it now (before it is saved as POSM items).
export async function campaignLines(id: string) {
  const order = await db.distOrder.findUnique({ where: { id }, include: { elements: true } });
  if (!order) throw new DistributionError("notFound");
  const [catalog, units] = await Promise.all([loadCatalog(), equipmentUnits(order.withStock)]);
  const lines: BuilderLine[] = [];
  for (const e of order.elements) {
    const perUnit: Record<string, number> = {};
    for (const [type, n] of Object.entries((e.perUnit ?? {}) as Record<string, number>))
      perUnit[perUnitKey(e.elementId, type)] = n;
    lines.push(
      ...buildOrder({
        catalog,
        units,
        types: e.types,
        elements: [e.elementId],
        reservePct: order.reservePct,
        reserveByType: (order.reserveByType ?? {}) as Record<string, number>,
        merge: true,
        perUnit,
      }),
    );
  }
  return { order, catalog, units, lines };
}

// Makes (or remakes) the campaign's POSM list from what it orders. Items are matched by name:
// a confirmed price stays while the catalog price is the same. Items made before and no longer
// ordered are removed when nothing was shipped from them.
export async function makeList(actor: Actor & Viewer, id: string) {
  assertManager(actor);
  const current = await loadOpen(id);
  if (current.orderedOn) throw new DistributionError("ordered");
  const { lines } = await campaignLines(id);
  const usable = lines.filter((l) => l.quantity !== null && l.quantity > 0);
  if (usable.length === 0) throw new DistributionError("noLines");
  const existing = await db.distPosm.findMany({
    where: { orderId: id },
    include: { _count: { select: { shipments: true } } },
  });
  // The reserve (each line's type's own) is added on top of the need and stays at the central
  // warehouse (as before): what goes to the regions is the need itself.
  await db.$transaction(async (tx) => {
    for (const [i, l] of usable.entries()) {
      const keep = l.reservePct / (1 + l.reservePct);
      const before = existing.find((p) => p.name === l.name);
      const samePrice = before?.price != null && before.price === l.price;
      const data = {
        position: i + 1,
        category: l.element,
        equipmentLabel: l.types.map(typeLabel).join(" / "),
        size: mm(l.heightMm, l.widthMm),
        material: l.material,
        orderedFor: Math.round(l.units),
        ordered: l.quantity!,
        inStock: 0,
        reservePct: keep,
        base: "UNITS" as const,
        norm: l.perUnit,
        normReserve: l.reservePct,
        types: l.types,
        elementId: l.elementId,
        price: before?.priceConfirmedAt && !samePrice ? before.price : l.price,
        priceConfirmedAt: samePrice || before?.priceConfirmedAt ? before?.priceConfirmedAt : null,
      };
      await tx.distPosm.upsert({
        where: { orderId_name: { orderId: id, name: l.name } },
        create: { orderId: id, name: l.name, ...data },
        update: data,
      });
    }
    const names = new Set(usable.map((l) => l.name));
    const gone = existing.filter((p) => !names.has(p.name) && p._count.shipments === 0);
    if (gone.length) await tx.distPosm.deleteMany({ where: { id: { in: gone.map((p) => p.id) } } });
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.list",
    entityType: "DistOrder",
    entityId: id,
    details: { items: usable.length },
  });
  return usable.length;
}

// ——— The printer's prices ———

export async function savePrices(
  actor: Actor & Viewer,
  id: string,
  input: {
    prices: { posmId: string; price: number | null }[];
    confirm: string[];
    supplier: string;
    quoteNo: string;
    quotedOn: string;
  },
) {
  assertManager(actor);
  const order = await loadOpen(id);
  if (!isDateString(input.quotedOn)) throw new DistributionError("invalid");
  if (input.prices.some((p) => p.price !== null && (!Number.isFinite(p.price) || p.price < 0)))
    throw new DistributionError("invalid");
  const items = await db.distPosm.findMany({ where: { orderId: id } });
  const supplier = input.supplier.trim() || null;
  const quoteNo = input.quoteNo.trim() || null;
  let confirmed = 0;
  await db.$transaction(async (tx) => {
    for (const p of input.prices) {
      const item = items.find((i) => i.id === p.posmId);
      if (!item) continue;
      const confirm = input.confirm.includes(item.id) && p.price !== null;
      const changed = p.price !== item.price;
      if (!changed && !confirm) continue;
      await tx.distPosm.update({
        where: { id: item.id },
        data: {
          price: p.price,
          priceConfirmedAt: confirm ? new Date() : changed ? null : item.priceConfirmedAt,
          ...(confirm ? { supplier, quoteNo } : {}),
        },
      });
      if (!confirm || !item.elementId) continue;
      confirmed += 1;
      // The confirmed price goes to the catalog and its history, for the next campaigns.
      for (const type of item.types) {
        await tx.distElementSize.upsert({
          where: { elementId_type: { elementId: item.elementId, type } },
          create: { elementId: item.elementId, type, price: p.price },
          update: { price: p.price },
        });
        await tx.distPriceQuote.create({
          data: {
            elementId: item.elementId,
            type,
            price: p.price!,
            supplier,
            quoteNo,
            quotedOn: fromDateString(input.quotedOn),
            orderId: order.id,
            createdById: actor.id,
          },
        });
      }
    }
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.prices",
    entityType: "DistOrder",
    entityId: id,
    details: { confirmed, supplier, quoteNo },
  });
  return confirmed;
}

// Ordered from the printer: the list is fixed from now on (undone only before any shipment).
export async function setOrdered(actor: Actor & Viewer, id: string, orderedOn: string | null) {
  assertManager(actor);
  await loadOpen(id);
  if (orderedOn === null) {
    if (await db.distShipment.count({ where: { posm: { orderId: id } } }))
      throw new DistributionError("hasShipments");
  } else {
    if (!isDateString(orderedOn)) throw new DistributionError("invalid");
    if (!(await db.distPosm.count({ where: { orderId: id } })))
      throw new DistributionError("noLines");
  }
  await db.distOrder.update({
    where: { id },
    data: { orderedOn: orderedOn === null ? null : fromDateString(orderedOn) },
  });
  await logActivity({
    actorId: actor.id,
    action: orderedOn ? "distribution.ordered" : "distribution.unordered",
    entityType: "DistOrder",
    entityId: id,
  });
}

// ——— Replacement in the shops ———

export type PlannedOutlet = {
  outletId: string;
  region: string;
  tsm: string;
  types: string[];
  units: number;
  replaced: boolean | null;
};

// The outlets the campaign's POSM goes to: those with installed equipment of its types.
export async function plannedOutlets(id: string): Promise<PlannedOutlet[]> {
  const items = await db.distPosm.findMany({ where: { orderId: id }, select: { types: true } });
  const types = [...new Set(items.flatMap((i) => i.types))];
  if (types.length === 0) return [];
  const [rows, marks] = await Promise.all([
    db.$queryRaw<
      { outletId: string; region: string; tsm: string; types: string[]; units: number }[]
    >`
      SELECT u."outletKey" AS "outletId", MIN(u."region") AS "region",
             COALESCE(MAX(NULLIF(o."tsm", '')), ${NO_TSM}) AS "tsm",
             ARRAY_AGG(DISTINCT u."type") AS "types", SUM(u."units")::float8 AS "units"
      FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
      WHERE u."type" = ANY(${types})
      GROUP BY u."outletKey"`,
    db.distReplacement.findMany({ where: { orderId: id } }),
  ]);
  const done = new Map(marks.map((m) => [m.outletId, m.replaced]));
  const order = sortRegions(rows.map((r) => r.region));
  return rows
    .map((r) => ({ ...r, replaced: done.get(r.outletId) ?? null }))
    .sort(
      (a, b) =>
        order.indexOf(a.region) - order.indexOf(b.region) ||
        byTsmName(a.tsm, b.tsm) ||
        a.outletId.localeCompare(b.outletId, "ru", { numeric: true }),
    );
}

export type ReplacementRow = { key: string; planned: number; replaced: number; notYet: number };

// Replacement by region and by TSM within each region.
export function replacementStats(outlets: PlannedOutlet[]) {
  const add = (map: Map<string, ReplacementRow>, key: string, o: PlannedOutlet) => {
    const row = map.get(key) ?? { key, planned: 0, replaced: 0, notYet: 0 };
    row.planned += 1;
    if (o.replaced) row.replaced += 1;
    else row.notYet += 1;
    map.set(key, row);
  };
  const regions = new Map<string, ReplacementRow>();
  const tsms = new Map<string, Map<string, ReplacementRow>>();
  const total: ReplacementRow = { key: "", planned: 0, replaced: 0, notYet: 0 };
  for (const o of outlets) {
    add(regions, o.region, o);
    const byTsm = tsms.get(o.region) ?? new Map<string, ReplacementRow>();
    add(byTsm, o.tsm || "—", o);
    tsms.set(o.region, byTsm);
    total.planned += 1;
    if (o.replaced) total.replaced += 1;
    else total.notYet += 1;
  }
  return { regions: [...regions.values()], tsms, total };
}

const REPLACED = /^(да|yes|y|1|true|\+|✓|✔|заменен[оа]?|replaced|done|ha)$/i;

// The replacement file: an outlet ID column and a "replaced" column (да / нет). Outlets not in
// the file keep their mark. Everyone with the section can upload it.
export async function importReplacement(actor: Actor & Viewer, id: string, buffer: Buffer) {
  if (!canSeeDistribution(actor)) throw new DistributionError("forbidden");
  await loadOpen(id);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DistributionError("badFile");
  }
  const marks = new Map<string, boolean>();
  for (const sheet of book.worksheets) {
    let idAt = -1;
    let doneAt = -1;
    sheet.eachRow((row, n) => {
      const cells = Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, i) => {
        const v = row.getCell(i + 1).value as unknown;
        const r =
          v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
        return r === null || r === undefined ? "" : String(r).trim();
      });
      if (idAt === -1) {
        if (n > 10) return;
        const head = cells.map((c) => c.toLowerCase());
        const i = head.findIndex((h) => /^ид$|^id$|smartup id|outlet|точк/.test(h));
        const d = head.findIndex((h) => /замен|replac|status|статус/.test(h));
        if (i >= 0 && d >= 0) [idAt, doneAt] = [i, d];
        return;
      }
      const outlet = cells[idAt]!.replace(/\.0+$/, "");
      // An empty mark leaves the outlet as it was.
      if (outlet && cells[doneAt]) marks.set(outlet, REPLACED.test(cells[doneAt]!));
    });
    if (idAt >= 0) break;
  }
  if (marks.size === 0) throw new DistributionError("noReplacement");
  const planned = new Set((await plannedOutlets(id)).map((o) => o.outletId));
  await db.$transaction(
    [...marks].map(([outletId, replaced]) =>
      db.distReplacement.upsert({
        where: { orderId_outletId: { orderId: id, outletId } },
        create: { orderId: id, outletId, replaced },
        update: { replaced },
      }),
    ),
  );
  await logActivity({
    actorId: actor.id,
    action: "distribution.replacement",
    entityType: "DistOrder",
    entityId: id,
    details: { rows: marks.size },
  });
  return {
    rows: marks.size,
    replaced: [...marks.values()].filter(Boolean).length,
    unknown: [...marks.keys()].filter((o) => !planned.has(o)).length,
  };
}

// The outlets to replace in, as Excel: ID, region, TSM, equipment and a column to fill in.
export async function replacementXlsx(outlets: PlannedOutlet[]) {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const ws = book.addWorksheet("Замена");
  ws.addRow(["ИД", "Регион", "TSM", "Оборудование", "Заменено (да / нет)"]).font = { bold: true };
  for (const o of outlets)
    ws.addRow([
      o.outletId,
      o.region,
      o.tsm,
      o.types.map(typeLabel).join(", "),
      o.replaced === null ? "" : o.replaced ? "да" : "нет",
    ]);
  ws.columns.forEach((c, i) => (c.width = [14, 18, 22, 40, 20][i] ?? 12));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await book.xlsx.writeBuffer());
}

// ——— The campaign page ———

export async function loadCampaign(id: string) {
  const order = await db.distOrder.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      files: { orderBy: { createdAt: "asc" } },
      elements: true,
      posm: {
        orderBy: { position: "asc" },
        include: { shipments: { select: { quantity: true } } },
      },
    },
  });
  if (!order) return null;
  const [lines, outlets] = await Promise.all([campaignLines(id), plannedOutlets(id)]);
  const items = order.posm;
  const shipped = items.reduce((s, i) => s + i.shipments.reduce((a, b) => a + b.quantity, 0), 0);
  const toRegions = items.reduce(
    (s, i) => s + Math.floor((i.inStock + i.ordered) * (1 - i.reservePct) + 1e-9),
    0,
  );
  const replacement = replacementStats(outlets);
  const priced = items.filter((i) => i.priceConfirmedAt).length;
  const steps = {
    concept: order.conceptApprovedAt !== null,
    kv: order.kvFinalAt !== null,
    composition: order.elements.length > 0,
    list: items.length > 0,
    prices: items.length > 0 && priced === items.length,
    ordered: order.orderedOn !== null,
    distribution: toRegions > 0 && shipped >= toRegions,
    replacement: replacement.total.planned > 0 && replacement.total.notYet === 0,
  };
  return {
    order,
    items,
    preview: lines,
    outlets,
    replacement,
    shipped,
    toRegions,
    priced,
    total: items.reduce((s, i) => s + (i.price ?? 0) * i.ordered, 0),
    steps,
  };
}

export type Campaign = NonNullable<Awaited<ReturnType<typeof loadCampaign>>>;

// The campaign's list as Excel: what, on which equipment, print size, pieces, prices — the base
// for the EAS document and the printer's order.
export async function campaignListXlsx(c: Campaign) {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const ws = book.addWorksheet("POSM");
  ws.addRow([c.order.name]).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow([
    "#",
    "Элемент",
    "Оборудование",
    "Размер печати, мм",
    "Материал",
    "Ед. оборудования",
    "Шт на ед.",
    `Количество (+${reserveLabel(c.order as Parameters<typeof reserveLabel>[0])} запас)`,
    "Цена за шт, сум с НДС",
    "Сумма, сум с НДС",
    "Цена подтверждена",
    "Типография",
    "КП",
  ]).font = { bold: true };
  for (const [i, item] of c.items.entries())
    ws.addRow([
      i + 1,
      item.category,
      item.equipmentLabel,
      item.size,
      item.material,
      item.orderedFor,
      item.norm,
      item.ordered,
      item.price,
      item.price === null ? null : item.price * item.ordered,
      item.priceConfirmedAt ? item.priceConfirmedAt.toISOString().slice(0, 10) : "нет",
      item.supplier,
      item.quoteNo,
    ]);
  ws.addRow([
    null,
    "Итого",
    null,
    null,
    null,
    null,
    null,
    c.items.reduce((s, i) => s + i.ordered, 0),
    null,
    c.total,
  ]).font = { bold: true };
  ws.columns.forEach(
    (col, i) => (col.width = [5, 18, 34, 16, 24, 14, 10, 18, 16, 18, 16, 20, 12][i] ?? 12),
  );
  return Buffer.from(await book.xlsx.writeBuffer());
}
