import ExcelJS from "exceljs";

import {
  canonicalRegion,
  REGION_ORDER,
  TYPE_CODES,
  typeFromPivotHeader,
  type DistType,
} from "./types";

// The three files of the POSM distribution, found by sheet and column titles so refreshed files
// with moved rows or columns still read:
// - the equipment file («Daily BW-POG management»): the only source of quantities and regions —
//   every installed piece in «BW management» (one row each; Display MOD counts as its slots / 18),
//   the warehouses in the «Current stock» block of «Warehouse» (the dismantling list is not read);
// - the outlet base: only «ID → responsible TSM» (its region just shows mismatches with the file);
// - a POSM list for an order: the «POSM» sheet of the distribution workbook.

export type ParsedUnit = {
  // "" for a row without a Smartup ID (kept when it has a TIN or a name).
  outletId: string;
  outletKey: string;
  region: string;
  type: DistType;
  units: number;
  posName: string;
  tin: string;
};

export type SkipReason = "noIdentity" | "noRegion" | "noType" | "unknownType";

export type SkippedRow = { row: number; reason: SkipReason; region: string; description: string };

export type ParsedStock = { region: string; type: DistType; count: number };

export type ParsedEquipment = {
  units: ParsedUnit[];
  stock: ParsedStock[];
  // Rows of «BW management» not counted, each with its reason.
  skipped: SkippedRow[];
  unknownTypes: string[];
};

export type ParsedOutlet = { outletId: string; region: string | null; tsm: string | null };

export type ParsedPosm = {
  position: number;
  name: string;
  category: string;
  equipmentLabel: string | null;
  size: string | null;
  material: string | null;
  orderedFor: number;
  inStock: number;
  ordered: number;
  reservePct: number;
  base: "UNITS" | "SLOTS";
  norm: number | null;
  normReserve: number;
  types: DistType[];
};

export class DistributionParseError extends Error {
  constructor(public readonly code: "noEquipment" | "noPosm" | "noOutlets" | "badFile") {
    super(code);
    this.name = "DistributionParseError";
  }
}

type Cell = string | number | boolean | null;

function cellValue(cell: ExcelJS.Cell): Cell {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if ("result" in o) {
      const r = o.result;
      return typeof r === "number" || typeof r === "string" || typeof r === "boolean" ? r : null;
    }
    if (o.richText)
      return (
        o.richText
          .map((r) => r.text)
          .join("")
          .trim() || null
      );
    if (typeof o.text === "string") return o.text.trim() || null;
    // A formula with no saved result.
    return null;
  }
  return null;
}

const num = (value: Cell): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value.replace(/[\s ]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const text = (value: Cell): string => (value === null ? "" : String(value).trim());
// IDs come as numbers or text ("4311356", 4311356.0).
const idOf = (value: Cell): string =>
  typeof value === "number" ? String(Math.round(value)) : text(value).replace(/\.0+$/, "");

function rows(sheet: ExcelJS.Worksheet, columns = sheet.columnCount): Cell[][] {
  const out: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    const values: Cell[] = [];
    for (let c = 1; c <= columns; c++) values.push(cellValue(row.getCell(c)));
    out[n - 1] = values;
  });
  return Array.from(out, (r) => r ?? []);
}

const findSheet = (book: ExcelJS.Workbook, test: (name: string) => boolean) =>
  book.worksheets.find((s) => test(s.name.trim().toLowerCase()));

async function load(buffer: Buffer) {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DistributionParseError("badFile");
  }
  return book;
}

// A header row: the first row (of the first `scan`) where every test finds a column.
function headerOf(grid: Cell[][], tests: Record<string, RegExp>, scan = 10) {
  for (let r = 0; r < Math.min(scan, grid.length); r++) {
    const row = (grid[r] ?? []).map((c) => text(c).toLowerCase());
    const at = Object.fromEntries(
      Object.entries(tests).map(([key, re]) => [key, row.findIndex((h) => re.test(h))]),
    );
    if (Object.values(at).every((i) => i >= 0)) return { row: r, at };
  }
  return null;
}

const MOD_SLOTS = 18;

export async function parseEquipmentFile(buffer: Buffer): Promise<ParsedEquipment> {
  const book = await load(buffer);
  const list =
    findSheet(book, (n) => n.startsWith("bw management")) ??
    findSheet(book, (n) => n.startsWith("bw"));
  if (!list) throw new DistributionParseError("noEquipment");
  const grid = rows(list, Math.min(list.columnCount, 40));
  const head = headerOf(grid, {
    region: /^region|^регион/,
    id: /smartup id|^id$|^ид$/,
    type: /bw dis|bw desc|описание|тип оборуд/,
  });
  if (!head) throw new DistributionParseError("noEquipment");
  const header = grid[head.row]!.map((c) => text(c).toLowerCase());
  const slotsAt = header.findIndex((h) => /слот|slot/.test(h));
  const nameAt = header.findIndex((h) => /^pos name|^наименование|^название/.test(h));
  const tinAt = header.findIndex((h) => /^tin\b|^инн/.test(h));
  const units: ParsedUnit[] = [];
  const skipped: SkippedRow[] = [];
  const unknown = new Set<string>();
  grid.slice(head.row + 1).forEach((row, i) => {
    const outletId = idOf(row[head.at.id!] ?? null);
    const rawRegion = text(row[head.at.region!] ?? null);
    const description = text(row[head.at.type!] ?? null);
    const posName = nameAt >= 0 ? text(row[nameAt] ?? null) : "";
    const tin = tinAt >= 0 ? idOf(row[tinAt] ?? null) : "";
    if (!outletId && !rawRegion && !description && !posName && !tin) return;
    const type = description ? typeFromPivotHeader(description) : null;
    const region = rawRegion ? canonicalRegion(rawRegion) : "";
    // Without an ID the outlet is known by its region and TIN (else its name).
    const outletKey =
      outletId || (tin ? `${region}|tin:${tin}` : posName ? `${region}|name:${posName}` : "");
    const reason: SkipReason | null = !region
      ? "noRegion"
      : !description
        ? "noType"
        : !type
          ? "unknownType"
          : !outletKey
            ? "noIdentity"
            : null;
    if (reason || !type) {
      skipped.push({ row: head.row + i + 2, reason: reason ?? "noType", region, description });
      if (reason === "unknownType") unknown.add(description);
      return;
    }
    units.push({
      outletId,
      outletKey,
      region,
      type,
      units: type === "POSI_MOD" ? num(row[slotsAt] ?? null) / MOD_SLOTS : 1,
      posName,
      tin,
    });
  });
  if (units.length === 0) throw new DistributionParseError("noEquipment");

  // «Warehouse» → the «Current stock» block: a title row, two header rows (group, type), regions.
  const stock: ParsedStock[] = [];
  const warehouse = findSheet(book, (n) => n.startsWith("warehouse") || n.startsWith("склад"));
  if (warehouse) {
    const w = rows(warehouse, Math.min(warehouse.columnCount, 40));
    const title = w.findIndex((row) => row.some((c) => /^current stock$/i.test(text(c))));
    if (title !== -1) {
      const typesRow = w[title + 2] ?? [];
      const first = typesRow.findIndex((c) => /^region$/i.test(text(c)));
      const columns = typesRow
        .map((c, i) => ({ i, type: typeFromPivotHeader(text(c)) }))
        .filter((c): c is { i: number; type: DistType } => c.type !== null);
      for (const row of w.slice(title + 3)) {
        const region = text(row[first] ?? null);
        if (!region || /^total|^итого/i.test(region)) break;
        for (const { i, type } of columns) {
          const count = num(row[i] ?? null);
          if (count > 0) stock.push({ region: canonicalRegion(region), type, count });
        }
      }
    }
  }
  return { units, stock, skipped, unknownTypes: [...unknown] };
}

// The outlet base: «ИД» and «Responsible TSM» columns (the region, «Организации», if present).
export async function parseOutletBase(buffer: Buffer): Promise<ParsedOutlet[]> {
  const book = await load(buffer);
  for (const sheet of book.worksheets) {
    const grid = rows(sheet, Math.min(sheet.columnCount, 40));
    const head = headerOf(grid, { id: /^ид$|^id$|smartup id/, tsm: /responsible tsm/ });
    if (!head) continue;
    const header = grid[head.row]!.map((c) => text(c).toLowerCase());
    const regionAt = header.findIndex((h) => /^организац|^region|^регион/.test(h));
    const outlets: ParsedOutlet[] = [];
    for (const row of grid.slice(head.row + 1)) {
      const outletId = idOf(row[head.at.id!] ?? null);
      if (!outletId) continue;
      // «Организации» can list several («C&C, Tashkent»): the known regions among them, else
      // the value as it is.
      const raw = regionAt >= 0 ? text(row[regionAt] ?? null) : "";
      const known = raw
        .split(",")
        .map((part) => canonicalRegion(part))
        .filter((part) => REGION_ORDER.includes(part));
      const region = known.length ? known.join(", ") : raw && canonicalRegion(raw);
      outlets.push({
        outletId,
        region: region || null,
        tsm: text(row[head.at.tsm!] ?? null) || null,
      });
    }
    if (outlets.length) return outlets;
  }
  throw new DistributionParseError("noOutlets");
}

// A POSM list: a header row starting with «#», «POSM»; the 12 columns after «Запас к норме» are
// the type matrix (1 = the item goes to that type).
export async function parsePosmList(buffer: Buffer): Promise<ParsedPosm[]> {
  const book = await load(buffer);
  const sheets = [
    ...book.worksheets.filter((s) => s.name.trim().toLowerCase() === "posm"),
    ...book.worksheets,
  ];
  for (const sheet of sheets) {
    const items = posmFromSheet(sheet);
    if (items.length) return items;
  }
  throw new DistributionParseError("noPosm");
}

function posmFromSheet(sheet: ExcelJS.Worksheet): ParsedPosm[] {
  const grid = rows(sheet);
  const head = grid.findIndex(
    (row) => text(row[0] ?? null) === "#" && text(row[1] ?? null).toUpperCase() === "POSM",
  );
  if (head === -1) return [];
  const header = grid[head]!.map((c) => text(c).toLowerCase());
  const col = (start: string) => header.findIndex((h) => h.startsWith(start));
  const at = {
    category: col("категория"),
    equipment: col("тип оборудования"),
    size: col("размер"),
    material: col("материал"),
    orderedFor: col("оборуд. при заказе"),
    inStock: col("на складе"),
    ordered: col("заказано"),
    reserve: col("оставить на центр"),
    base: col("база"),
    norm: col("норма"),
    normReserve: col("запас к норме"),
  };
  // The matrix covers the 12 display types of the original workbook.
  const matrixTypes = TYPE_CODES.slice(0, 12);
  const matrix = at.normReserve + 1;
  const items: ParsedPosm[] = [];
  for (const row of grid.slice(head + 1)) {
    const position = row[0];
    const name = text(row[1] ?? null);
    if (typeof position !== "number" || !name) continue;
    const get = (i: number) => (i >= 0 ? (row[i] ?? null) : null);
    const norm = get(at.norm);
    items.push({
      position,
      name,
      category: text(get(at.category)) || "Другое",
      equipmentLabel: text(get(at.equipment)) || null,
      size: text(get(at.size)) || null,
      material: text(get(at.material)) || null,
      orderedFor: Math.round(num(get(at.orderedFor))),
      inStock: Math.round(num(get(at.inStock))),
      ordered: Math.round(num(get(at.ordered))),
      reservePct: Math.min(1, Math.max(0, num(get(at.reserve)))),
      base: /слот|slot/i.test(text(get(at.base))) ? "SLOTS" : "UNITS",
      norm: norm === null || text(norm) === "" ? null : num(norm),
      normReserve: Math.max(0, num(get(at.normReserve))),
      types:
        at.normReserve === -1
          ? []
          : matrixTypes.filter((_, i) => num(row[matrix + i] ?? null) === 1),
    });
  }
  return items;
}
