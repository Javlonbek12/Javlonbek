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

const yes = (value: string) =>
  ["1", "да", "yes", "true", "+", "x", "ha"].includes(value.trim().toLowerCase());

function toRows(table: string[][]): ImportedRow[] {
  const [header, ...rest] = table;
  if (!header) return [];
  const index: Record<string, number> = {};
  header.forEach((cell, i) => {
    const name = cell.trim().toLowerCase();
    for (const [key, aliases] of Object.entries(COLUMNS))
      if (aliases.includes(name)) index[key] = i;
  });
  if (index.code === undefined) throw new PlanogramError("badFile");
  return rest
    .map((cells) => {
      const get = (key: string) =>
        index[key] === undefined ? "" : (cells[index[key]] ?? "").trim();
      const price = Number(get("price").replace(/[\s ]/g, "").replace(",", "."));
      return {
        code: get("code"),
        brand: get("brand") || undefined,
        name: get("name") || undefined,
        format: get("format") || undefined,
        price: Number.isFinite(price) && price > 0 ? price : undefined,
        mandatory: index.mandatory === undefined ? undefined : yes(get("mandatory")),
        isNew: index.isNew === undefined ? undefined : yes(get("isNew")),
      };
    })
    .filter((row) => row.code.length > 0);
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

async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((r) => {
    const values = (r.values as unknown[]).slice(1);
    rows.push(
      values.map((v) =>
        v === null || v === undefined
          ? ""
          : typeof v === "object" && "text" in (v as object)
            ? String((v as { text: unknown }).text)
            : String(v),
      ),
    );
  });
  return rows;
}

export async function parseSpreadsheet(file: File): Promise<ImportedRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return toRows(await parseXlsx(await file.arrayBuffer()));
  if (name.endsWith(".csv") || name.endsWith(".txt")) return toRows(parseCsv(await file.text()));
  throw new PlanogramError("badFile");
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
