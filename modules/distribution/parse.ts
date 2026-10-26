import ExcelJS from "exceljs";

import { TYPE_CODES, typeFromPivotHeader, TSM_REGION, type DistType } from "./types";

// Reads the POSM distribution workbook («POSM_Distribution_by_Region»): installed and warehouse
// equipment by region («Оборудование»), Tashkent equipment by TSM («TSM_Оборудование») and the
// POSM list with stock, order and the equipment types each item goes to («POSM»).
// Sheets and columns are found by their titles, so a refreshed file with moved rows still reads.

export type ParsedCount = {
  kind: "INSTALLED" | "STOCK";
  region: string;
  tsm: string;
  type: DistType;
  count: number;
};

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

export type ParsedDistribution = {
  counts: ParsedCount[];
  posm: ParsedPosm[];
  // Whether the file counts warehouse equipment in the base («Да» in «Оборудование»).
  includeStock: boolean | null;
};

export class DistributionParseError extends Error {
  constructor(public readonly code: "noEquipment" | "noPosm" | "badFile") {
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

function rows(sheet: ExcelJS.Worksheet): Cell[][] {
  const out: Cell[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    const values: Cell[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) values.push(cellValue(row.getCell(c)));
    out[n - 1] = values;
  });
  return Array.from(out, (r) => r ?? []);
}

const findSheet = (book: ExcelJS.Workbook, test: (name: string) => boolean) =>
  book.worksheets.find((s) => test(s.name.trim().toLowerCase()));

// «Оборудование»: blocks headed by two «Region» rows (group, then size); the title row above says
// which block it is. The 12 type columns follow the region name.
function parseEquipment(sheet: ExcelJS.Worksheet) {
  const grid = rows(sheet);
  const counts: ParsedCount[] = [];
  let includeStock: boolean | null = null;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    const first = row.findIndex((c) => text(c).toLowerCase() === "region");
    const label = row.map(text).join(" ").toLowerCase();
    if (label.includes("учитывать оборудование на складе")) {
      const answer = row.map(text).find((c) => /^(да|нет|yes|no)$/i.test(c));
      if (answer) includeStock = /^(да|yes)$/i.test(answer);
    }
    if (first === -1 || text(grid[r + 1]?.[first] ?? null).toLowerCase() !== "region") continue;
    const title = [grid[r - 1], grid[r - 2]]
      .map((t) => (t ?? []).map(text).join(" ").toLowerCase())
      .join(" ");
    const kind = /stock|склад/.test(title)
      ? /база|base/.test(title)
        ? null
        : "STOCK"
      : /база|base/.test(title)
        ? null
        : "INSTALLED";
    r += 2;
    for (; r < grid.length; r++) {
      const data = grid[r]!;
      const region = text(data[first] ?? null);
      if (!region || /^total|^итого/i.test(region)) break;
      if (!kind) continue;
      TYPE_CODES.forEach((type, i) => {
        const count = Math.round(num(data[first + 1 + i] ?? null));
        if (count > 0) counts.push({ kind, region, tsm: "", type, count });
      });
    }
  }
  return { counts, includeStock };
}

// «TSM_Оборудование», block 1: TSM rows × pivot type headers.
function parseTsm(sheet: ExcelJS.Worksheet): ParsedCount[] {
  const grid = rows(sheet);
  const counts: ParsedCount[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    const first = row.findIndex((c) => text(c).toLowerCase() === "tsm");
    if (first === -1) continue;
    const columns = row
      .map((c, i) => ({ i, type: typeFromPivotHeader(text(c)) }))
      .filter((c): c is { i: number; type: DistType } => c.type !== null);
    if (columns.length === 0) continue;
    for (r += 1; r < grid.length; r++) {
      const data = grid[r]!;
      const tsm = text(data[first] ?? null);
      if (!tsm || /^total|^итого/i.test(tsm)) break;
      for (const { i, type } of columns) {
        const count = Math.round(num(data[i] ?? null));
        if (count > 0) counts.push({ kind: "INSTALLED", region: TSM_REGION, tsm, type, count });
      }
    }
    break;
  }
  return counts;
}

// «POSM»: a header row starting with «#», «POSM»; the 12 columns after «Запас к норме» are the
// type matrix (1 = the item goes to that type).
function parsePosm(sheet: ExcelJS.Worksheet): ParsedPosm[] {
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
          : TYPE_CODES.filter((_, i) => num(row[matrix + i] ?? null) === 1),
    });
  }
  return items;
}

export async function parseDistributionWorkbook(buffer: Buffer): Promise<ParsedDistribution> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DistributionParseError("badFile");
  }
  const equipmentSheet = findSheet(book, (n) => n === "оборудование" || n === "equipment");
  const tsmSheet = findSheet(book, (n) => n.startsWith("tsm"));
  const posmSheet = findSheet(book, (n) => n === "posm");
  if (!equipmentSheet) throw new DistributionParseError("noEquipment");
  if (!posmSheet) throw new DistributionParseError("noPosm");
  const { counts, includeStock } = parseEquipment(equipmentSheet);
  if (counts.length === 0) throw new DistributionParseError("noEquipment");
  const posm = parsePosm(posmSheet);
  if (posm.length === 0) throw new DistributionParseError("noPosm");
  return { counts: [...counts, ...(tsmSheet ? parseTsm(tsmSheet) : [])], posm, includeStock };
}
