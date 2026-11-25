import type ExcelJS from "exceljs";

import type { Tone } from "./tone";

// How the Connect download looks: the one style layer every sheet goes through (decision of
// 25.11.2026, see docs/DECISIONS.md). A sheet stays a table to filter, sort and pivot — the header
// in row 1, one record per row, numbers as numbers — and reads like the page: the same header,
// the same number formats, and every number the page colours against its norm coloured here by
// the same rule. Whose data a sheet is counted from is the colour of its tab.
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
  // What the sheet is, in a line: for the list of sheets on the cover.
  about: string;
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
const TONE_FILL: Record<Tone, string> = { good: "D9F5EB", warn: "FFEEBF", bad: "FED5D7" };
const TONE_INK: Record<Tone, string> = { good: "004F3B", warn: "7B3306", bad: "82181A" };
const TONE_TEXT: Record<Tone, string> = { good: "007A55", warn: "BB4D00", bad: "E7000B" };
// The left edge of a marked row (the page's red-500 and amber-400; a good row has no mark).
const TONE_EDGE: Record<Tone, string | null> = { good: null, warn: "FFB900", bad: "FB2C36" };

// The page's SourceTags: sky for the Connect bot, violet for Smart Up; slate where both are
// compared (neither's colour, and not one of the norms').
const SOURCE_TAB: Record<SheetSource, string> = {
  bot: "00A6F4",
  smartup: "8E51FF",
  both: "62748E",
};
const SOURCE_FILL: Record<SheetSource, string> = {
  bot: "E6F6FE",
  smartup: "F4EEFF",
  both: "EEF1F5",
};
const SOURCE_INK: Record<SheetSource, string> = {
  bot: "024A70",
  smartup: "4D179A",
  both: "314158",
};

// The page's neutrals: the table header, the lines between rows, the secondary text, links.
const HEAD_FILL = "F0F3F7";
const HEAD_INK = "3F4759";
const HEAD_LINE = "C3C9D3";
const LINE = "E3E6EC";
const INK = "171F30";
const MUTED = "616978";
const LINK = "2A78D6";

const argb = (hex: string) => ({ argb: `FF${hex.replace("#", "").toUpperCase()}` });
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
const line = (color: string, style: ExcelJS.BorderStyle = "thin"): Partial<ExcelJS.Border> => ({
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
const PLAIN = 0.92;
const BOLD = 1.14;

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
  return ws;
}

// --- The cover -------------------------------------------------------------------------------

export type CoverTile = {
  label: string;
  value: Value;
  format?: CellFormat;
  tone?: Tone | null;
  // Against the previous period, in percentage points, coloured by whether it got better.
  change?: { delta: number; tone: Tone | null } | null;
  note?: string | null;
};

export type Cover = {
  title: string;
  // The level's headline numbers, as the page's tiles: the heads of the label and the value.
  tilesHead: [string, string];
  tiles: CoverTile[];
  // What a change is counted in («п.п.») and the line under the tiles that says what it is against.
  changeUnit: string;
  caption?: string | null;
  // About the file: the level, whose data, the period, how fresh the data is.
  facts: { title: string; rows: [string, string][] };
  norms: {
    title: string;
    hint: string;
    // Norm, its value, then what is green, amber and red.
    head: [string, string, string, string, string];
    rows: { label: string; value: string; good: string; warn: string; bad: string }[];
    // What is coloured without a norm of the owner's: where and by which rule.
    more: { title: string; rows: [string, string][] };
  };
  sheets: {
    title: string;
    hint: string;
    head: [string, string, string];
    rows: { name: string; about: string; source: SheetSource; sourceLabel: string }[];
  };
};

// Columns of the cover: labels, a value, then three more the wide texts are merged over.
const COVER_WIDTHS = [44, 16, 24, 24, 26];
const COVER_COLUMNS = COVER_WIDTHS.length;

// The first sheet: what the file is, the headline numbers, the norms with the colours' meaning
// and the list of sheets. A designed page (merged cells, no filter), not a table. Made empty
// before the other sheets (it is the first) and filled when they are known.
export function addCoverSheet(book: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = book.addWorksheet(sheetName(name), {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COVER_WIDTHS.map((width) => ({ width }));
  return ws;
}

export function fillCoverSheet(ws: ExcelJS.Worksheet, cover: Cover) {
  const widthOf = (from: number, to: number) =>
    COVER_WIDTHS.slice(from - 1, to).reduce((a, b) => a + b, 0);
  let at = 0;
  const next = () => ws.getRow(++at);
  // A text over several columns, the row as high as it needs.
  const wide = (
    row: ExcelJS.Row,
    from: number,
    text: string,
    style: Partial<ExcelJS.Style>,
    to = COVER_COLUMNS,
  ) => {
    const cell = row.getCell(from);
    cell.value = text;
    cell.style = { ...style, alignment: { wrapText: true, vertical: "top", ...style.alignment } };
    // The cells merged into it take its style (the line under them).
    if (to > from) ws.mergeCells(row.number, from, row.number, to);
    row.height = Math.max(row.height ?? 0, rowHeight(textLines(text, widthOf(from, to))));
  };
  const section = (title: string) => {
    at += 1;
    const row = next();
    row.height = 24;
    for (let c = 1; c <= COVER_COLUMNS; c++)
      row.getCell(c).style = {
        font: font(INK, { bold: true, size: 13 }),
        alignment: { vertical: "middle" },
        border: { bottom: line(HEAD_LINE, "medium") },
      };
    row.getCell(1).value = title;
  };
  const head = (labels: string[], spans: [number, number][]) => {
    const row = next();
    for (let c = 1; c <= COVER_COLUMNS; c++) row.getCell(c).style = headerStyle("text");
    labels.forEach((label, i) => {
      const [from, to] = spans[i]!;
      if (to > from) ws.mergeCells(row.number, from, row.number, to);
      row.getCell(from).value = label;
    });
    row.height = rowHeight(
      Math.max(...labels.map((label, i) => textLines(label, widthOf(...spans[i]!), BOLD))),
    );
  };
  const top: Partial<ExcelJS.Alignment> = { vertical: "top", wrapText: true };
  const under = { bottom: line(LINE) };
  const plain: Partial<ExcelJS.Style> = { font: font(INK), border: under, alignment: top };
  const muted: Partial<ExcelJS.Style> = { font: font(MUTED), border: under, alignment: top };
  const note: Partial<ExcelJS.Style> = { font: font(MUTED) };

  // The title, then the headline numbers: the label, the number in its colour, the change
  // against the previous period and the tile's note.
  const title = next();
  wide(title, 1, cover.title, {
    font: font(INK, { bold: true, size: 16 }),
    alignment: { vertical: "middle" },
  });
  title.height = Math.max(30, textLines(cover.title, widthOf(1, COVER_COLUMNS), 1.5) * 22 + 8);
  head(cover.tilesHead, [
    [1, 1],
    [2, 2],
  ]);
  for (const tile of cover.tiles) {
    const row = next();
    row.getCell(1).value = tile.label;
    row.getCell(1).style = plain;
    row.getCell(2).value = tile.value;
    const numFmt = numberFormat(tile.format);
    row.getCell(2).style = {
      ...(numFmt ? { numFmt } : {}),
      alignment: { horizontal: "right", vertical: "top" },
      border: under,
      font: font(tile.tone ? TONE_INK[tile.tone] : INK, { bold: true }),
      ...(tile.tone ? { fill: fill(TONE_FILL[tile.tone]) } : {}),
    };
    row.getCell(3).value = tile.change ? tile.change.delta : null;
    row.getCell(3).style = {
      numFmt: numberFormat("change", cover.changeUnit),
      alignment: { horizontal: "right", vertical: "top" },
      border: under,
      font: font(tile.change?.tone ? TONE_TEXT[tile.change.tone] : MUTED),
    };
    wide(row, 4, tile.note ?? "", muted);
    row.height = Math.max(row.height, rowHeight(textLines(tile.label, COVER_WIDTHS[0]!)));
  }
  if (cover.caption) wide(next(), 1, cover.caption, note);

  section(cover.facts.title);
  for (const [label, value] of cover.facts.rows) {
    const row = next();
    row.getCell(1).value = label;
    row.getCell(1).style = muted;
    wide(row, 2, value, plain);
  }

  section(cover.norms.title);
  wide(next(), 1, cover.norms.hint, note);
  head(cover.norms.head, [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ]);
  for (const norm of cover.norms.rows) {
    const row = next();
    row.getCell(1).value = norm.label;
    row.getCell(1).style = plain;
    row.getCell(2).value = norm.value;
    row.getCell(2).style = { ...plain, font: font(INK, { bold: true }) };
    (["good", "warn", "bad"] as const).forEach((tone, i) => {
      const cell = row.getCell(3 + i);
      cell.value = norm[tone];
      cell.style = {
        font: font(TONE_INK[tone]),
        fill: fill(TONE_FILL[tone]),
        border: under,
        alignment: top,
      };
    });
    row.height = rowHeight(
      Math.max(
        textLines(norm.label, COVER_WIDTHS[0]!),
        ...(["good", "warn", "bad"] as const).map((tone, i) =>
          textLines(norm[tone], COVER_WIDTHS[2 + i]!),
        ),
      ),
    );
  }
  if (cover.norms.more.rows.length) {
    at += 1;
    const sub = next();
    sub.getCell(1).value = cover.norms.more.title;
    sub.getCell(1).style = { font: font(INK, { bold: true }) };
    for (const [where, rule] of cover.norms.more.rows) {
      const row = next();
      row.getCell(1).value = where;
      row.getCell(1).style = plain;
      wide(row, 2, rule, plain);
      row.height = Math.max(row.height, rowHeight(textLines(where, COVER_WIDTHS[0]!)));
    }
  }

  section(cover.sheets.title);
  wide(next(), 1, cover.sheets.hint, note);
  head(cover.sheets.head, [
    [1, 1],
    [2, 4],
    [5, 5],
  ]);
  for (const sheet of cover.sheets.rows) {
    const row = next();
    // The name opens its sheet.
    row.getCell(1).value = {
      text: sheet.name,
      hyperlink: `#'${sheet.name.replace(/'/g, "''")}'!A1`,
    };
    row.getCell(1).style = { font: font(LINK, { underline: true }), border: under, alignment: top };
    wide(row, 2, sheet.about, plain, 4);
    row.getCell(5).value = sheet.sourceLabel;
    row.getCell(5).style = {
      font: font(SOURCE_INK[sheet.source]),
      fill: fill(SOURCE_FILL[sheet.source]),
      border: under,
      alignment: top,
    };
  }
}
