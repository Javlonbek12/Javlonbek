import type ExcelJS from "exceljs";

import type { Tone } from "./tone";

// How the Connect download looks: the colours and number formats of every sheet, and the sheet of
// a full list (decisions of 25.11.2026, see docs/DECISIONS.md). The first sheet is the page itself
// (xlsx-page.ts); a full list stays a table to filter, sort and pivot — the header in row 1, one
// record per row, numbers as numbers — and reads like the page: the same header, the same number
// formats, and every number the page colours against its norm coloured here by the same rule.
// Whose data a sheet is counted from is the colour of its tab.
//
// Styles are shared objects (one per look, never changed after they are made): ExcelJS writes a
// style it has seen before without building it again, so a sheet of thousands of rows costs a
// reference per cell.

export type Value = string | number | null;

// What a column holds, which is how it is written: a count «12 500», a share «41.4%» (the value
// is already in percent), money, a change «▲ 4.2%» / «▼ 16.7%», a text or a date as text.
export type CellFormat = "count" | "percent" | "money" | "change" | "text" | "date";

// Whose data a sheet is counted from: the Connect bot's exports, Smart Up's, or both compared.
export type SheetSource = "bot" | "smartup" | "both";

export type SheetColumn = {
  header: string;
  width: number;
  format?: CellFormat;
  // What a change is counted in: "%" (the default) or percentage points.
  unit?: string;
  // The colour of a cell against its norm, by the page's rule (null: none). `index` is the row's
  // place in the rows given.
  tone?: (value: Value, row: Value[], index: number) => Tone | null;
  // How the page shows that tone: a tinted cell (the default) or coloured text.
  paint?: "cell" | "text";
  // A status's own colour (#rrggbb) for its text, as the page writes it.
  color?: (value: Value, row: Value[], index: number) => string | null | undefined;
  // In a sheet that compares the two sources: whose data this column is (the line under its
  // header).
  source?: Exclude<SheetSource, "both">;
};

// A row is its cells; a row with a meaning of its own says so: a number of a metric list with
// its format and tone, a heading or a second header inside a sheet, a bold or an indented row.
export type SheetRow =
  | Value[]
  | {
      cells: Value[];
      // Of the row's numbers, instead of their columns' formats.
      format?: CellFormat;
      // Of each cell, for a row of a table of its own under another (its columns are not the
      // sheet's).
      formats?: CellFormat[];
      // Of the row's value (its second cell).
      tone?: Tone | null;
      kind?: "title" | "header";
      bold?: boolean;
      // Of the first cell (a position under another in the hierarchy).
      indent?: number;
    };

export type SheetOptions = {
  source: SheetSource;
  // What the sheet is, in a line: the hint of the link that opens it.
  about: string;
  // The way back to the block of the first sheet the list belongs to: a link at the end of the
  // header row (after the table, so the header and the records stay what they are).
  back?: { text: string; target: string };
  // A row the page marks on its left edge: its first cell is tinted.
  rowTone?: (row: Value[], index: number) => Tone | null;
  // A two-column list of numbers, not a table: no filter.
  list?: boolean;
};

// The workbook's way to add a sheet (see connectXlsx).
export type AddSheet = (
  name: string,
  columns: SheetColumn[],
  rows: SheetRow[],
  options: SheetOptions,
) => ExcelJS.Worksheet;

// --- Colours ---------------------------------------------------------------------------------

// The page's TONE_CELL (emerald-500/15, amber-400/25, red-500/20) as it looks on white, with its
// dark text of the same family; TONE_TEXT for a number that is only written in colour.
export const TONE_FILL: Record<Tone, string> = { good: "D9F5EB", warn: "FFEEBF", bad: "FED5D7" };
export const TONE_INK: Record<Tone, string> = { good: "004F3B", warn: "7B3306", bad: "82181A" };
export const TONE_TEXT: Record<Tone, string> = { good: "007A55", warn: "BB4D00", bad: "E7000B" };
// The left edge of a marked row (the page's red-500 and amber-400; a good row has no mark).
export const TONE_EDGE: Record<Tone, string | null> = { good: null, warn: "FFB900", bad: "FB2C36" };

// The page's SourceTags: sky for the Connect bot, violet for Smart Up; slate where both are
// compared (neither's colour, and not one of the norms').
export const SOURCE_TAB: Record<SheetSource, string> = {
  bot: "00A6F4",
  smartup: "8E51FF",
  both: "62748E",
};
export const SOURCE_FILL: Record<SheetSource, string> = {
  bot: "E6F6FE",
  smartup: "F4EEFF",
  both: "EEF1F5",
};
export const SOURCE_INK: Record<SheetSource, string> = {
  bot: "024A70",
  smartup: "4D179A",
  both: "314158",
};

// The page's neutrals: the table header, the lines between rows, the secondary text, links.
export const HEAD_FILL = "F0F3F7";
export const HEAD_INK = "3F4759";
export const HEAD_LINE = "C3C9D3";
export const LINE = "E3E6EC";
export const INK = "171F30";
export const MUTED = "616978";
export const LINK = "2A78D6";

export const argb = (hex: string) => ({ argb: `FF${hex.replace("#", "").toUpperCase()}` });
const font = (color: string, more: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: "Calibri",
  family: 2,
  size: 11,
  color: argb(color),
  ...more,
});
const fill = (color: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: argb(color),
});
export const line = (
  color: string,
  style: ExcelJS.BorderStyle = "thin",
): Partial<ExcelJS.Border> => ({
  style,
  color: argb(color),
});

// --- Number formats --------------------------------------------------------------------------

const NUMERIC: Record<CellFormat, boolean> = {
  count: true,
  percent: true,
  money: true,
  change: true,
  text: false,
  date: false,
};

// The value of a share is already in percent («41.4»), so the sign is only written after it.
export function numberFormat(format: CellFormat | undefined, unit = "%"): string | undefined {
  if (format === "count" || format === "money") return "#,##0";
  if (format === "percent") return '0.0"%"';
  if (format === "change") {
    const tail = `"${unit === "%" ? "%" : ` ${unit.replace(/"/g, "")}`}"`;
    return `"▲ "0.0${tail};"▼ "0.0${tail};0.0${tail}`;
  }
  return undefined;
}

// --- Styles, one object per look -------------------------------------------------------------

type Look = {
  format?: CellFormat;
  unit?: string;
  tone?: Tone | null;
  paint?: "cell" | "text";
  color?: string | null;
  // The row's mark on its first cell.
  mark?: Tone | null;
  bold?: boolean;
  indent?: number;
  // A cell of a row that is not a record (a heading inside a sheet): no line under it.
  bare?: boolean;
  // A count or a sum that is not a whole number: shown with its decimals, not rounded.
  fraction?: boolean;
};

const looks = new Map<string, Partial<ExcelJS.Style>>();

function bodyStyle(look: Look): Partial<ExcelJS.Style> {
  // The number in colour, the cell tinted by its own tone, or (the first cell) by the row's mark;
  // a row that meets its norm has no mark, as on the page.
  const written = look.tone && look.paint === "text" ? look.tone : null;
  const mark = look.mark && TONE_EDGE[look.mark] ? look.mark : null;
  const tinted = (look.tone && !written ? look.tone : null) ?? mark;
  const key = [
    look.format,
    look.format === "change" ? look.unit : "",
    written,
    tinted,
    mark,
    look.color,
    look.bold ? "b" : "",
    look.indent ?? "",
    look.bare ? "bare" : "",
    look.fraction ? "f" : "",
  ].join("|");
  let style = looks.get(key);
  if (style) return style;
  style = {};
  const numFmt = look.fraction ? "#,##0.0#" : numberFormat(look.format, look.unit);
  if (numFmt) style.numFmt = numFmt;
  // A column that says nothing keeps Excel's own sides: numbers right, text left.
  if (look.format || look.indent)
    style.alignment = NUMERIC[look.format ?? "text"]
      ? { horizontal: "right" }
      : { horizontal: "left", ...(look.indent ? { indent: look.indent } : {}) };
  if (tinted) style.fill = fill(TONE_FILL[tinted]);
  const ink = written ? TONE_TEXT[written] : tinted ? TONE_INK[tinted] : (look.color ?? null);
  if (ink || look.bold) style.font = font(ink ?? INK, look.bold ? { bold: true } : {});
  if (!look.bare || mark)
    style.border = {
      ...(look.bare ? {} : { bottom: line(LINE) }),
      ...(mark ? { left: line(TONE_EDGE[mark]!, "medium") } : {}),
    };
  looks.set(key, style);
  return style;
}

const headers = new Map<string, Partial<ExcelJS.Style>>();

// `indent`: of a text column that comes after a number (see addStyledSheet).
function headerStyle(format: CellFormat | undefined, source?: SheetSource, indent = 0) {
  const right = NUMERIC[format ?? "text"];
  const key = `${right}|${source ?? ""}|${indent}`;
  let style = headers.get(key);
  if (!style) {
    style = {
      font: font(HEAD_INK, { bold: true }),
      fill: fill(HEAD_FILL),
      alignment: {
        horizontal: right ? "right" : "left",
        ...(indent && !right ? { indent } : {}),
        vertical: "middle",
        wrapText: true,
      },
      // Whose data the column is: the line under its header in the source's colour.
      border: { bottom: source ? line(SOURCE_TAB[source], "medium") : line(HEAD_LINE) },
    };
    headers.set(key, style);
  }
  return style;
}

// --- Sizes -----------------------------------------------------------------------------------

// A column's width is counted in digits of the plain font; letters are a little narrower than a
// digit, bold ones a little wider.
export const PLAIN = 0.92;
export const BOLD = 1.14;

// How many lines a text takes in a cell this wide (`scale`: how wide its letters are).
export function textLines(text: string, width: number, scale = PLAIN): number {
  const room = Math.max(3, Math.floor((width - 1) / scale));
  let lines = 0;
  for (const part of text.split("\n")) {
    let used = 0;
    lines += 1;
    for (const word of part.split(/\s+/).filter(Boolean)) {
      let length = word.length;
      if (used && used + 1 + length > room) {
        lines += 1;
        used = 0;
      }
      if (used) used += 1;
      // A word longer than the cell breaks inside it.
      while (length > room) {
        lines += 1;
        length -= room;
      }
      used += length;
    }
  }
  return lines;
}

const LINE_HEIGHT = 15;
const rowHeight = (lines: number) => Math.max(1, lines) * LINE_HEIGHT + 5;

// More columns than this: the first one stays in place when the sheet is scrolled sideways.
const WIDE = 8;

// A sheet name as Excel takes it: none of its reserved characters, at most 31 long.
export const sheetName = (name: string) =>
  name
    .replace(/[*?:\\/[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

// Two sheets cannot have one name (Excel compares them without the letters' case): the second
// gets a number, so a clash of two blocks' names in some language never fails the download.
function freeName(book: ExcelJS.Workbook, name: string) {
  const taken = new Set(book.worksheets.map((ws) => ws.name.toLowerCase()));
  let free = sheetName(name);
  for (let n = 2; taken.has(free.toLowerCase()); n++)
    free = `${sheetName(name).slice(0, 30 - String(n).length)} ${n}`;
  return free;
}

// --- A sheet ---------------------------------------------------------------------------------

const backStyle: Partial<ExcelJS.Style> = {
  font: font(LINK, { underline: true }),
  alignment: { vertical: "middle" },
};

const cellsOf = (row: SheetRow) => (Array.isArray(row) ? row : row.cells);

export function addStyledSheet(
  book: ExcelJS.Workbook,
  name: string,
  columns: SheetColumn[],
  rows: SheetRow[],
  options: SheetOptions,
): ExcelJS.Worksheet {
  const ws = book.addWorksheet(freeName(book, name), {
    properties: { tabColor: argb(SOURCE_TAB[options.source]) },
    views: [
      {
        state: "frozen",
        ySplit: 1,
        xSplit: columns.length > WIDE ? 1 : 0,
        // The lines between rows are the cells' own, as on the page.
        showGridLines: false,
      },
    ],
    // On paper: a wide sheet across the page, the header on every page.
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    },
  });
  // A header wraps between its words, never inside one: a column is at least as wide as the
  // longest of them («Посещаемость,»).
  const widths = columns.map((c) => {
    const word = Math.max(...c.header.split(/\s+/).map((w) => w.length));
    return Math.max(c.width, Math.ceil(word * BOLD) + 2);
  });
  // A text right after a number («0» and then «Одна ниже цели») keeps a little off it.
  const after = columns.map(
    (c, i) => i > 0 && !NUMERIC[c.format ?? "text"] && NUMERIC[columns[i - 1]!.format ?? "text"],
  );
  ws.columns = columns.map((c, i) => ({ header: c.header, width: widths[i] }));
  const head = ws.getRow(1);
  // Headers wrap («Проверок с OOS (Connect-бот)»): the row is as high as the longest needs.
  head.height = rowHeight(
    Math.min(6, Math.max(...columns.map((c, i) => textLines(c.header, widths[i]!, BOLD)))),
  );
  columns.forEach((c, i) => {
    head.getCell(i + 1).style = headerStyle(c.format, c.source, after[i] ? 1 : 0);
  });
  ws.addRows(rows.map(cellsOf));

  // A table's filter covers its records: up to the first empty row (what is under it is another
  // block of the sheet).
  let records = rows.findIndex((row) => cellsOf(row).length === 0);
  if (records < 0) records = rows.length;
  if (!options.list && records > 0)
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: records + 1, column: columns.length },
    };

  rows.forEach((item, index) => {
    const cells = cellsOf(item);
    if (!cells.length) return;
    const row = ws.getRow(index + 2);
    const own = Array.isArray(item) ? null : item;
    if (own?.kind === "header") {
      cells.forEach((value, c) => {
        row.getCell(c + 1).style = headerStyle(own.formats?.[c] ?? "text");
      });
      return;
    }
    if (own?.kind === "title") {
      cells.forEach((_, c) => {
        row.getCell(c + 1).style = bodyStyle({ bold: true, bare: true });
      });
      return;
    }
    const mark = options.rowTone?.(cells, index) ?? null;
    // Every column of a record has its line, also where the record has no value.
    const width = Math.max(cells.length, columns.length);
    for (let c = 0; c < width; c++) {
      const column = columns[c];
      const value = cells[c] ?? null;
      const number = typeof value === "number";
      // A row's own format is of its numbers; a number outside the columns is a count.
      const format = own?.formats
        ? own.formats[c]
        : number
          ? (own?.format ?? column?.format ?? (column ? undefined : "count"))
          : (column?.format ?? (column ? undefined : "text"));
      row.getCell(c + 1).style = bodyStyle({
        format,
        fraction: number && (format === "count" || format === "money") && !Number.isInteger(value),
        unit: column?.unit,
        tone: (c === 1 ? own?.tone : null) ?? column?.tone?.(value, cells, index) ?? null,
        paint: column?.paint,
        color: column?.color?.(value, cells, index)?.replace("#", "").toUpperCase() ?? null,
        mark: c === 0 ? mark : null,
        bold: own?.bold,
        indent: c === 0 ? own?.indent : after[c] && !own?.formats ? 1 : undefined,
      });
    }
  });
  if (options.back) {
    // One empty column after the table, then the link: the filter and the print keep to the table.
    const cell = head.getCell(columns.length + 2);
    cell.value = { text: options.back.text, hyperlink: options.back.target };
    cell.style = backStyle;
    ws.getColumn(columns.length + 1).width = 2;
    ws.getColumn(columns.length + 2).width = Math.min(60, options.back.text.length + 2);
    ws.pageSetup.printArea = `A1:${ws.getColumn(columns.length).letter}${rows.length + 1}`;
  }
  return ws;
}
