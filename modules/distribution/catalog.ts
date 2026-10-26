import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import {
  buildOrder,
  equipmentSize,
  gapsOf,
  missing,
  mm,
  typeLabel,
  type BuilderInput,
  type BuilderLine,
  type Catalog,
} from "./builder";
import { canManageDistribution, DistributionError } from "./service";
import { TYPE_CODES, typeInfo } from "./types";

type Viewer = Parameters<typeof canManageDistribution>[0];

// The order builder's catalog: equipment dimensions and the elements' print sizes.
export async function loadCatalog(): Promise<Catalog> {
  const [types, elements] = await Promise.all([
    db.distTypeSize.findMany(),
    db.distElement.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { sizes: true },
    }),
  ]);
  return { types, elements };
}

const num = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return String(value).trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};
const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value).trim();

function assertManager(actor: Actor & Viewer) {
  if (!canManageDistribution(actor)) throw new DistributionError("forbidden");
}

export async function addElement(actor: Actor & Viewer, name: string, material: string) {
  assertManager(actor);
  const clean = name.trim();
  if (!clean || clean.length > 80) throw new DistributionError("invalid");
  if (await db.distElement.findUnique({ where: { name: clean } }))
    throw new DistributionError("exists");
  const last = await db.distElement.findFirst({ orderBy: { position: "desc" } });
  const element = await db.distElement.create({
    data: { name: clean, material: material.trim() || null, position: (last?.position ?? 0) + 1 },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.element",
    entityType: "DistElement",
    entityId: element.id,
    details: { name: clean },
  });
  return element;
}

export async function deleteElement(actor: Actor & Viewer, id: string) {
  assertManager(actor);
  if (!(await db.distElement.findUnique({ where: { id } })))
    throw new DistributionError("notFound");
  await db.distElement.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "distribution.elementDeleted",
    entityType: "DistElement",
    entityId: id,
  });
}

export type SizeInput = {
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  perUnit: number | null;
  price: number | null;
  material: string | null;
  note: string | null;
};

// Saving a size by hand confirms it.
export async function saveElementSizes(
  actor: Actor & Viewer,
  elementId: string,
  input: { name: string; material: string; sizes: SizeInput[] },
) {
  assertManager(actor);
  const element = await db.distElement.findUnique({ where: { id: elementId } });
  if (!element) throw new DistributionError("notFound");
  const name = input.name.trim();
  if (!name || name.length > 80 || input.sizes.some((s) => !TYPE_CODES.includes(s.type as never)))
    throw new DistributionError("invalid");
  const other = await db.distElement.findUnique({ where: { name } });
  if (other && other.id !== elementId) throw new DistributionError("exists");
  await db.$transaction(async (tx) => {
    await tx.distElement.update({
      where: { id: elementId },
      data: { name, material: input.material.trim() || null },
    });
    for (const s of input.sizes) {
      const empty = [s.heightMm, s.widthMm, s.perUnit, s.price].every((v) => v === null);
      if (empty && !s.note) {
        await tx.distElementSize.deleteMany({ where: { elementId, type: s.type } });
        continue;
      }
      const data = { ...s, verified: true };
      await tx.distElementSize.upsert({
        where: { elementId_type: { elementId, type: s.type } },
        create: { elementId, ...data },
        update: data,
      });
    }
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.sizes",
    entityType: "DistElement",
    entityId: elementId,
  });
}

export async function saveTypeSizes(
  actor: Actor & Viewer,
  sizes: {
    type: string;
    heightMm: number | null;
    widthMm: number | null;
    depthMm: number | null;
    note: string | null;
  }[],
) {
  assertManager(actor);
  if (sizes.some((s) => !TYPE_CODES.includes(s.type as never)))
    throw new DistributionError("invalid");
  await db.$transaction(
    sizes.map((s) => db.distTypeSize.upsert({ where: { type: s.type }, create: s, update: s })),
  );
}

// ——— Excel: the sizes to fill in, and reading the filled file back ———

const SIZES_SHEET = "Размеры POSM";
const TYPES_SHEET = "Оборудование";
const SIZE_HEAD = [
  "Элемент",
  "Код типа",
  "Оборудование",
  "Размер оборудования В×Ш×Г, мм",
  "Высота печати, мм",
  "Ширина печати, мм",
  "Шт на 1 ед. оборудования",
  "Цена за 1 шт",
  "Материал",
  "Комментарий",
  "Что заполнить",
];
const TYPE_HEAD = [
  "Код типа",
  "Оборудование",
  "Высота, мм",
  "Ширина, мм",
  "Глубина, мм",
  "Комментарий",
];

const GAP_TEXT = {
  size: "размер печати",
  perUnit: "шт на ед.",
  price: "цену",
  check: "проверить размер (взят из старого списка POSM)",
};

// The catalog as Excel; `onlyMissing` leaves just the rows with something to fill in.
export async function catalogXlsx(catalog: Catalog, onlyMissing: boolean): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const yellow: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

  const ws = book.addWorksheet(SIZES_SHEET);
  ws.addRow(SIZE_HEAD).font = { bold: true };
  const gaps = missing(catalog);
  const pairs = onlyMissing
    ? gaps.pairs
    : catalog.elements.flatMap((element) =>
        TYPE_CODES.map((type) => ({
          element,
          type,
          size: element.sizes.find((s) => s.type === type),
        })),
      );
  for (const { element, type, size } of pairs) {
    const todo = gapsOf(size);
    const row = ws.addRow([
      element.name,
      type,
      typeLabel(type),
      equipmentSize(catalog.types.find((x) => x.type === type)) ?? "",
      size?.heightMm ?? null,
      size?.widthMm ?? null,
      size?.perUnit ?? null,
      size?.price ?? null,
      size?.material ?? element.material ?? "",
      size?.note ?? "",
      todo.map((g) => GAP_TEXT[g]).join(", "),
    ]);
    if (todo.length) row.getCell(11).fill = yellow;
    for (const [gap, col] of [
      ["size", 5],
      ["size", 6],
      ["perUnit", 7],
      ["price", 8],
    ] as const)
      if (todo.includes(gap)) row.getCell(col).fill = yellow;
  }
  ws.columns.forEach((c, i) => (c.width = [18, 10, 22, 22, 12, 12, 14, 12, 26, 30, 40][i] ?? 12));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.addRow([]);
  ws.addRow([
    "Шт на 1 ед. = 0 — элемент не используется на этом оборудовании. Новые элементы можно дописать строками ниже: название в колонке «Элемент», код типа из листа «Оборудование».",
  ]).font = { italic: true };

  const wt = book.addWorksheet(TYPES_SHEET);
  wt.addRow(TYPE_HEAD).font = { bold: true };
  for (const type of TYPE_CODES) {
    const size = catalog.types.find((x) => x.type === type);
    if (onlyMissing && !gaps.types.includes(type)) continue;
    const row = wt.addRow([
      type,
      typeLabel(type),
      size?.heightMm ?? null,
      size?.widthMm ?? null,
      size?.depthMm ?? null,
      size?.note ?? "",
    ]);
    if (gaps.types.includes(type)) [3, 4, 5].forEach((c) => (row.getCell(c).fill = yellow));
  }
  wt.columns.forEach((c, i) => (c.width = [12, 22, 12, 12, 12, 34][i] ?? 12));
  return Buffer.from(await book.xlsx.writeBuffer());
}

type Cell = string | number | null;
function cellValue(cell: ExcelJS.Cell): Cell {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "string" || typeof r === "number" ? r : null;
  }
  if (typeof v === "object" && v && "richText" in v)
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  return null;
}

function sheetRows(sheet: ExcelJS.Worksheet, columns: number) {
  const out: Cell[][] = [];
  sheet.eachRow((row) => {
    const values: Cell[] = [];
    for (let c = 1; c <= columns; c++) values.push(cellValue(row.getCell(c)));
    out.push(values);
  });
  return out;
}

const findType = (value: Cell) => {
  const v = text(value);
  return (
    TYPE_CODES.find((code) => code === v.toUpperCase()) ??
    TYPE_CODES.find((code) => typeInfo(code)?.label.toLowerCase() === v.toLowerCase()) ??
    null
  );
};

// Reads a filled template: sizes by element name and type code, equipment dimensions by type.
// Filled rows count as confirmed; new element names become new elements.
export async function importCatalogFile(actor: Actor & Viewer, buffer: Buffer) {
  assertManager(actor);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DistributionError("badFile");
  }
  const sizesSheet = book.worksheets.find((s) => s.name.trim() === SIZES_SHEET);
  const typesSheet = book.worksheets.find((s) => s.name.trim() === TYPES_SHEET);
  if (!sizesSheet && !typesSheet) throw new DistributionError("noSizes");

  let sizes = 0;
  let types = 0;
  const elements = new Map((await db.distElement.findMany()).map((e) => [e.name.toLowerCase(), e]));
  if (sizesSheet) {
    for (const row of sheetRows(sizesSheet, 10).slice(1)) {
      const name = text(row[0]);
      const type = findType(row[1]) ?? findType(row[2]);
      if (!name || !type) continue;
      const values = {
        heightMm: num(row[4]),
        widthMm: num(row[5]),
        perUnit: num(row[6]),
        price: num(row[7]),
        material: text(row[8]) || null,
        note: text(row[9]) || null,
      };
      if ([values.heightMm, values.widthMm, values.perUnit, values.price].every((v) => v === null))
        continue;
      let element = elements.get(name.toLowerCase());
      if (!element) {
        element = await addElement(actor, name, "");
        elements.set(name.toLowerCase(), element);
      }
      const data = { ...values, verified: values.heightMm !== null && values.widthMm !== null };
      await db.distElementSize.upsert({
        where: { elementId_type: { elementId: element.id, type } },
        create: { elementId: element.id, type, ...data },
        update: data,
      });
      sizes += 1;
    }
  }
  if (typesSheet) {
    for (const row of sheetRows(typesSheet, 6).slice(1)) {
      const type = findType(row[0]) ?? findType(row[1]);
      if (!type) continue;
      const data = {
        heightMm: num(row[2]),
        widthMm: num(row[3]),
        depthMm: num(row[4]),
        note: text(row[5]) || null,
      };
      if (data.heightMm === null && data.widthMm === null && data.depthMm === null) continue;
      await db.distTypeSize.upsert({ where: { type }, create: { type, ...data }, update: data });
      types += 1;
    }
  }
  await logActivity({
    actorId: actor.id,
    action: "distribution.sizesImported",
    entityType: "DistElement",
    entityId: "file",
    details: { sizes, types },
  });
  return { sizes, types };
}

// ——— The builder's result ———

export type BuilderOptions = Omit<BuilderInput, "catalog" | "units"> & { withStock: boolean };

// Equipment units by type from the loaded equipment file (installed, plus stock when asked).
export async function equipmentUnits(withStock: boolean): Promise<Record<string, number>> {
  const [installed, stock] = await Promise.all([
    db.distUnit.groupBy({ by: ["type"], _sum: { units: true } }),
    db.distEquipmentCount.findMany({
      where: withStock ? { tsm: "" } : { kind: "INSTALLED", tsm: "" },
    }),
  ]);
  const out: Record<string, number> = {};
  const add = (type: string, n: number) => (out[type] = (out[type] ?? 0) + n);
  for (const row of installed) add(row.type, row._sum.units ?? 0);
  // Before the first equipment file: the old counts.
  for (const c of stock) if (c.kind === "STOCK" || installed.length === 0) add(c.type, c.count);
  return out;
}

// The builder's choices from a form or the link: t = types, e = elements, reserve (%), stock, merge.
export function builderOptions(get: (key: string) => string[]): BuilderOptions {
  const one = (key: string) => get(key)[0] ?? "";
  const reserve = Number(one("reserve") || 10);
  return {
    types: get("t"),
    elements: get("e"),
    reservePct: Number.isFinite(reserve) ? Math.min(100, Math.max(0, reserve)) / 100 : 0.1,
    merge: one("merge") !== "0",
    withStock: one("stock") === "1",
  };
}

export async function runBuilder(options: BuilderOptions) {
  const [catalog, units] = await Promise.all([loadCatalog(), equipmentUnits(options.withStock)]);
  return { catalog, units, lines: buildOrder({ ...options, catalog, units }) };
}

export function builderXlsx(lines: BuilderLine[], catalog: Catalog, reservePct: number) {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const ws = book.addWorksheet("Заказ POSM");
  ws.addRow([
    "POSM",
    "Элемент",
    "Оборудование",
    "Размер оборудования, мм",
    "Размер печати, мм",
    "Материал",
    "Ед. оборудования",
    "Шт на ед.",
    `Количество (+${Math.round(reservePct * 100)}% запас)`,
    "Цена за шт",
    "Сумма",
    "Нет данных",
  ]).font = { bold: true };
  for (const l of lines)
    ws.addRow([
      l.name,
      l.element,
      l.types.map(typeLabel).join(", "),
      l.types
        .map((type) => equipmentSize(catalog.types.find((x) => x.type === type)) ?? "?")
        .join(", "),
      mm(l.heightMm, l.widthMm) ?? "",
      l.material ?? "",
      Math.round(l.units * 10) / 10,
      l.perUnit,
      l.quantity,
      l.price,
      l.sum,
      l.gaps.map((g) => GAP_TEXT[g]).join(", "),
    ]);
  const total = (key: "quantity" | "sum") => lines.reduce((s, l) => s + (l[key] ?? 0), 0);
  ws.addRow([
    "Итого",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    total("quantity"),
    null,
    total("sum"),
  ]).font = { bold: true };
  ws.columns.forEach(
    (c, i) => (c.width = [40, 16, 28, 26, 16, 24, 14, 10, 16, 12, 14, 30][i] ?? 12),
  );
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return book.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

// The builder's lines become a new POSM order: one item per line, for its equipment types.
export async function createOrderFromBuilder(
  actor: Actor & Viewer,
  input: { name: string; orderedOn: string; note?: string },
  options: BuilderOptions,
) {
  assertManager(actor);
  const name = input.name.trim();
  if (!name || name.length > 120 || !isDateString(input.orderedOn))
    throw new DistributionError("invalid");
  const { lines } = await runBuilder(options);
  const usable = lines.filter((l) => l.quantity !== null && l.quantity > 0);
  if (usable.length === 0) throw new DistributionError("noLines");
  const order = await db.distOrder.create({
    data: {
      name,
      orderedOn: fromDateString(input.orderedOn),
      note: input.note?.trim() || null,
      createdById: actor.id,
      posm: {
        create: usable.map((l, i) => ({
          position: i + 1,
          name: l.name,
          category: l.element,
          equipmentLabel: l.types.map(typeLabel).join(" / "),
          size: mm(l.heightMm, l.widthMm),
          material: l.material,
          orderedFor: Math.round(l.units),
          ordered: l.quantity!,
          reservePct: 0,
          base: "UNITS" as const,
          norm: l.perUnit,
          normReserve: options.reservePct,
          types: l.types,
        })),
      },
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "distribution.order",
    entityType: "DistOrder",
    entityId: order.id,
    details: { name, items: usable.length, builder: true },
  });
  return order;
}
