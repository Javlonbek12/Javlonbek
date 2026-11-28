import { SaxesParser } from "saxes";

import {
  columnOf,
  textOf,
  unescape,
  zipEntries,
  type ZipEntry,
} from "@/modules/connect/light-xlsx";

// A focused reader of the S&OP workbook. The file is someone else's and untrusted: nothing in it
// is evaluated (a formula is only looked at as text, to tell how the cell was filled), every part
// is read as a stream with a size cap, and only the sheets that are asked for are opened — the
// workbook carries a consolidated sheet of several MB that is never needed here.

export type FormulaKind = "none" | "sum" | "lookup" | "other";

export type SheetCell = {
  v: string | number | boolean | null;
  // none: a typed value; sum: a plain «=a+b(+c…)» of numbers (its addends in `parts`);
  // lookup: pulled from another sheet; other: any other formula.
  f: FormulaKind;
  parts?: number[];
};

export type SheetGrid = {
  name: string;
  // rows.get(7)?.get(3) is cell D7 (rows from 1, columns from 0).
  rows: Map<number, Map<number, SheetCell>>;
  maxRow: number;
  maxColumn: number;
};

export type SopSheet = {
  name: string;
  // Reads the sheet; `maxRow` stops after that row (a look at the header of a big sheet).
  read: (options?: { maxRow?: number }) => Promise<SheetGrid>;
};

export class SopReadError extends Error {
  constructor(public readonly code: "notXlsx" | "tooBig") {
    super(code);
    this.name = "SopReadError";
  }
}

// One part of the archive unpacked (a sheet's XML, the shared strings), in characters.
const MAX_PART = 40 * 1024 * 1024;
const MAX_STRINGS = 400_000;
const MAX_ROWS = 20_000;
const MAX_CELLS = 600_000;
const MAX_SHEETS = 200;

// «=4010+596.36», «=-12+3.5-1»: numbers joined by plus or minus, nothing else.
const NUMBER = String.raw`\d+(?:\.\d+)?`;
const SUM = new RegExp(String.raw`^\s*[+-]?\s*${NUMBER}(?:\s*[+-]\s*${NUMBER})+\s*$`);
const LOOKUP = /\b(?:VLOOKUP|HLOOKUP|XLOOKUP|LOOKUP|INDEX|GETPIVOTDATA)\s*\(/i;

// How a cell with this formula text was filled. Never evaluated.
export function classifyFormula(text: string): { f: FormulaKind; parts?: number[] } {
  const formula = text.replace(/^\s*=/, "");
  if (SUM.test(formula)) {
    const parts = [...formula.matchAll(new RegExp(String.raw`([+-]?)\s*(${NUMBER})`, "g"))].map(
      (m) => (m[1] === "-" ? -1 : 1) * Number(m[2]),
    );
    return { f: "sum", parts };
  }
  return { f: LOOKUP.test(formula) ? "lookup" : "other" };
}

type Attributes = Record<string, string>;

// The text of a part, piece by piece, refusing one that unpacks beyond the cap (a zip bomb).
async function* capped(zip: Buffer, entry: ZipEntry): AsyncGenerator<string> {
  let total = 0;
  for await (const piece of textOf(zip, entry)) {
    total += piece.length;
    if (total > MAX_PART) throw new SopReadError("tooBig");
    yield piece;
  }
}

async function walk(
  xml: AsyncIterable<string>,
  open: (name: string, attributes: Attributes) => void,
  close: (name: string, text: string) => void | false,
) {
  const parser = new SaxesParser();
  let text = "";
  let stopped = false;
  let failure: unknown = null;
  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("opentag", (tag) => {
    text = "";
    if (!stopped) open(tag.name, tag.attributes as Attributes);
  });
  parser.on("text", (part) => {
    text += part;
  });
  parser.on("cdata", (part) => {
    text += part;
  });
  parser.on("closetag", (tag) => {
    if (!stopped && close(tag.name, text) === false) stopped = true;
    text = "";
  });
  for await (const piece of xml) {
    parser.write(piece);
    if (failure) throw failure;
    if (stopped) return;
  }
  parser.close();
  if (failure) throw failure;
}

async function sharedStrings(xml: AsyncIterable<string>) {
  const strings: string[] = [];
  let current = "";
  let phonetic = false;
  await walk(
    xml,
    (name) => {
      if (name === "si") current = "";
      else if (name === "rPh") phonetic = true;
    },
    (name, text) => {
      if (name === "t" && !phonetic) current += text;
      else if (name === "rPh") phonetic = false;
      else if (name === "si") {
        if (strings.length >= MAX_STRINGS) throw new SopReadError("tooBig");
        // A header is a few words: a very long string is cut, never kept whole.
        strings.push(unescape(current).slice(0, 2000));
      }
    },
  );
  return strings;
}

function valueOf(type: string, raw: string | null, strings: string[]): SheetCell["v"] {
  if (raw === null || raw === "") return null;
  switch (type) {
    case "s":
      return strings[Number(raw)] ?? null;
    case "inlineStr":
    case "str":
      return unescape(raw).slice(0, 2000);
    case "b":
      return raw === "1";
    // An error (#N/A, #REF!) is no value.
    case "e":
      return null;
    default: {
      const number = Number(raw);
      return Number.isFinite(number) ? number : null;
    }
  }
}

async function readGrid(
  name: string,
  xml: AsyncIterable<string>,
  strings: string[],
  maxRow: number | undefined,
): Promise<SheetGrid> {
  const grid: SheetGrid = { name, rows: new Map(), maxRow: 0, maxColumn: 0 };
  // A shared formula is written once (the «master» cell); the cells that repeat it carry only
  // its number, so they are filled the way the master is.
  const shared = new Map<string, FormulaKind>();
  let cells = 0;
  let row = 0;
  let column = -1;
  let type = "n";
  let raw: string | null = null;
  let formula: { kind: FormulaKind; parts?: number[] } | null = null;
  let formulaAttributes: Attributes | null = null;
  let phonetic = false;
  let current: Map<number, SheetCell> | null = null;
  await walk(
    xml,
    (tag, attributes) => {
      if (tag === "row") {
        row = Number(attributes.r) || row + 1;
        if (row > MAX_ROWS) throw new SopReadError("tooBig");
        column = -1;
        current = null;
      } else if (tag === "c") {
        column = attributes.r ? columnOf(attributes.r) : column + 1;
        if (column < 0 || column >= 16384) throw new SopReadError("notXlsx");
        type = attributes.t ?? "n";
        raw = null;
        formula = null;
      } else if (tag === "f") formulaAttributes = attributes;
      else if (tag === "rPh") phonetic = true;
    },
    (tag, text) => {
      if ((tag === "v" || tag === "t") && !phonetic) raw = (raw ?? "") + text;
      else if (tag === "rPh") phonetic = false;
      else if (tag === "f") {
        const attributes = formulaAttributes ?? {};
        const index = attributes.t === "shared" ? attributes.si : undefined;
        if (text.trim()) {
          const found = classifyFormula(text);
          formula = { kind: found.f, parts: found.parts };
          if (index !== undefined) shared.set(index, found.f);
        } else {
          // A cell that repeats a shared formula (or an empty formula): a formula all the same.
          const kind = (index !== undefined && shared.get(index)) || "other";
          formula = { kind: kind === "sum" ? "other" : kind };
        }
        formulaAttributes = null;
      } else if (tag === "c") {
        const value = valueOf(type, raw, strings);
        if (value === null && !formula) return;
        if (++cells > MAX_CELLS) throw new SopReadError("tooBig");
        if (!current) {
          current = new Map();
          grid.rows.set(row, current);
        }
        const cell: SheetCell = { v: value, f: formula?.kind ?? "none" };
        if (formula?.parts) cell.parts = formula.parts;
        current.set(column, cell);
        if (row > grid.maxRow) grid.maxRow = row;
        if (column > grid.maxColumn) grid.maxColumn = column;
      } else if (tag === "row" && maxRow !== undefined && row >= maxRow) return false;
    },
  );
  return grid;
}

async function elements(xml: AsyncIterable<string>, name: string) {
  const found: Attributes[] = [];
  await walk(
    xml,
    (tag, attributes) => {
      if (tag === name) found.push(attributes);
    },
    () => {},
  );
  return found;
}

// Opens the workbook: the names of its sheets, each read only when asked. Anything that is not a
// plain .xlsx throws SopReadError("notXlsx"); a part that is too large — "tooBig".
export async function openSopWorkbook(file: Buffer): Promise<SopSheet[]> {
  try {
    const entries = zipEntries(file);
    const text = (path: string) => {
      const entry = entries.get(path);
      if (!entry) throw new SopReadError("notXlsx");
      return capped(file, entry);
    };
    const targets = new Map<string, string>();
    let stringsPath: string | null = null;
    for (const rel of await elements(text("xl/_rels/workbook.xml.rels"), "Relationship")) {
      if (!rel.Target || !rel.Type) continue;
      const path = rel.Target.startsWith("/") ? rel.Target.slice(1) : `xl/${rel.Target}`;
      if (rel.Type.endsWith("/worksheet") && rel.Id) targets.set(rel.Id, path);
      else if (rel.Type.endsWith("/sharedStrings")) stringsPath = path;
    }
    // Read once, and only when the first sheet is opened.
    let strings: Promise<string[]> | null = null;
    const loadStrings = () =>
      (strings ??=
        stringsPath && entries.has(stringsPath)
          ? sharedStrings(text(stringsPath))
          : Promise.resolve([]));
    const sheets: SopSheet[] = [];
    for (const sheet of await elements(text("xl/workbook.xml"), "sheet")) {
      const path = targets.get(sheet["r:id"] ?? "");
      if (!path || !entries.has(path)) continue;
      if (sheets.length >= MAX_SHEETS) throw new SopReadError("tooBig");
      const name = (sheet.name ?? "").slice(0, 200);
      sheets.push({
        name,
        read: async (options) => {
          try {
            return await readGrid(name, text(path), await loadStrings(), options?.maxRow);
          } catch (error) {
            throw error instanceof SopReadError ? error : new SopReadError("notXlsx");
          }
        },
      });
    }
    if (sheets.length === 0) throw new SopReadError("notXlsx");
    return sheets;
  } catch (error) {
    // A broken archive, broken XML, a missing part: not a workbook we can read.
    throw error instanceof SopReadError ? error : new SopReadError("notXlsx");
  }
}
