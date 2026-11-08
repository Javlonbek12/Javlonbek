import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";

// Column names we understand (Russian and English), lower-case.
const COLUMNS: Record<string, string[]> = {
  code: ["code", "код", "sku", "артикул"],
  brand: ["brand", "бренд"],
  name: ["name", "название", "наименование"],
  format: ["format", "формат"],
  price: ["price", "цена"],
  mandatory: ["mandatory", "обязательный"],
  isNew: ["new", "новинка"],
};

export type ImportedRow = {
  code: string;
  brand?: string;
  name?: string;
  format?: string;
  price?: number;
  mandatory?: boolean;
  isNew?: boolean;
};

// A row that could not be read: its line in the file, its code (if any) and what is wrong.
export type UnreadRow = { line: number; code: string; problem: "code" | "price" };

// A cell's text; null = there is something in it we can't read (a formula without a saved
// result, an error value).
type CellText = string | null;
type Line = { line: number; cells: CellText[] };

const yes = (value: string) =>
  ["1", "да", "yes", "true", "+", "x", "ha"].includes(value.trim().toLowerCase());

function toRows(table: Line[]): { rows: ImportedRow[]; unread: UnreadRow[] } {
  const [header, ...rest] = table;
  if (!header) return { rows: [], unread: [] };
  const index: Record<string, number> = {};
  header.cells.forEach((cell, i) => {
    const name = (cell ?? "").trim().toLowerCase();
    for (const [key, aliases] of Object.entries(COLUMNS))
      if (aliases.includes(name)) index[key] = i;
  });
  if (index.code === undefined) throw new PlanogramError("badFile");
  const rows: ImportedRow[] = [];
  const unread: UnreadRow[] = [];
  for (const { line, cells } of rest) {
    const raw = (key: string): CellText => {
      if (index[key] === undefined) return "";
      const cell = cells[index[key]];
      return cell === null ? null : (cell ?? "").trim();
    };
    const get = (key: string) => raw(key) ?? "";
    const code = raw("code");
    const priceText = raw("price");
    const price = Number((priceText ?? "").replace(/[\s  ]/g, "").replace(",", "."));
    const priceOk = Number.isFinite(price) && price > 0;
    // A price that is there but isn't a number is reported, never dropped silently; an empty one
    // just means «no change».
    const badPrice =
      index.price !== undefined && (priceText === null || (priceText !== "" && !priceOk));
    if (code === null || (code === "" && (priceOk || badPrice))) {
      unread.push({ line, code: "", problem: "code" });
      continue;
    }
    if (!code) continue;
    if (badPrice) unread.push({ line, code, problem: "price" });
    rows.push({
      code,
      brand: get("brand") || undefined,
      name: get("name") || undefined,
      format: get("format") || undefined,
      price: priceOk ? price : undefined,
      mandatory: index.mandatory === undefined ? undefined : yes(get("mandatory")),
      isNew: index.isNew === undefined ? undefined : yes(get("isNew")),
    });
  }
  return { rows, unread };
}

// CSV with ";" or "," separators, quotes allowed.
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// What a cell shows: a formula's saved result, rich text joined, a link's text. Never
// "[object Object]".
export function cellText(value: unknown): CellText {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const o = value as {
      result?: unknown;
      formula?: unknown;
      sharedFormula?: unknown;
      richText?: { text: string }[];
      text?: unknown;
      error?: unknown;
    };
    if ("result" in o || "formula" in o || "sharedFormula" in o)
      return o.result === undefined || (typeof o.result === "object" && o.result !== null)
        ? null
        : cellText(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if ("text" in o) return cellText(o.text);
    return null;
  }
  return null;
}

async function parseXlsx(buffer: ArrayBuffer): Promise<Line[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: Line[] = [];
  sheet.eachRow((r, line) => {
    const cells: CellText[] = [];
    r.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cellText(cell.value);
    });
    rows.push({ line, cells: Array.from(cells, (c) => (c === undefined ? "" : c)) });
  });
  return rows;
}

// The rows of a file, and those that could not be read (to report, not to drop silently).
export async function readSpreadsheet(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return toRows(await parseXlsx(await file.arrayBuffer()));
  if (name.endsWith(".csv") || name.endsWith(".txt"))
    return toRows(parseCsv(await file.text()).map((cells, i) => ({ line: i + 1, cells })));
  throw new PlanogramError("badFile");
}

export async function parseSpreadsheet(file: File): Promise<ImportedRow[]> {
  return (await readSpreadsheet(file)).rows;
}

// Creates or updates SKUs from imported rows (brand and name are required for new ones).
export async function importSkus(actor: Actor, rows: ImportedRow[]) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    const existing = await db.sku.findUnique({ where: { code: row.code } });
    const data = {
      ...(row.brand ? { brand: row.brand.slice(0, 40) } : {}),
      ...(row.name ? { name: row.name.slice(0, 120) } : {}),
      ...(row.format ? { format: row.format.slice(0, 40) } : {}),
      ...(row.mandatory !== undefined ? { isMandatory: row.mandatory } : {}),
      ...(row.isNew !== undefined ? { isNew: row.isNew } : {}),
    };
    if (existing) {
      await db.sku.update({ where: { id: existing.id }, data });
      updated += 1;
    } else if (row.brand && row.name) {
      await db.sku.create({
        data: {
          code: row.code.slice(0, 40),
          brand: row.brand.slice(0, 40),
          name: row.name.slice(0, 120),
          ...data,
        },
      });
      created += 1;
    } else {
      skipped.push(row.code);
    }
  }
  return { created, updated, skipped };
}
