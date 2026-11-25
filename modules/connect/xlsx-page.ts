import type ExcelJS from "exceljs";

import { t } from "@/lib/i18n";
import { plural } from "@/modules/reports/format";

import type { Tone } from "./tone";
import {
  argb,
  BOLD,
  HEAD_FILL,
  HEAD_INK,
  HEAD_LINE,
  INK,
  LINE,
  LINK,
  MUTED,
  numberFormat,
  PLAIN,
  sheetName,
  SOURCE_FILL,
  SOURCE_INK,
  SOURCE_TAB,
  textLines,
  TONE_EDGE,
  TONE_FILL,
  TONE_INK,
  TONE_TEXT,
  type AddSheet,
  type CellFormat,
  type SheetColumn,
  type SheetRow,
  type SheetSource,
  type Value,
} from "./xlsx-style";

// The first sheet of the Connect download: the page itself (decision of 25.11.2026, the owner
// asked for the file «один в один как в веб-версии», see docs/DECISIONS.md). Every block of the
// level stands on one sheet, top to bottom in the page's order: the same titles, source tags,
// hints, tiles, tables and colours. It is a designed page, not a table to filter: the sheet is a
// fine grid of narrow columns and every cell of a block takes as many of them as it needs, so
// tables of different shapes stand under each other without squeezing one another. What the page
// draws and a grid of cells cannot hold as a drawing becomes cells: a bar is a run of filled
// cells next to its number, a calendar a grid of tinted cells. A list the page cuts has a link
// under it to the sheet with the whole list (see addStyledSheet), and that sheet a link back.

// The grid: this many columns of this width (in digits of the plain font, about 26 px), which is
// a laptop's screen at 100% and an A4 sheet across at about 85%.
export const GRID = 48;
const UNIT = 3.7;

// Whose data a block is: the page's source tags.
export type Source = Exclude<SheetSource, "both">;

// How a number of the page is written. `money` is shown as the page shows it («427,9 млн сум»)
// and stays the number it is.
type PageFormat = CellFormat;

// --- Colours of the page that the full lists do not need -------------------------------------

// A bar against its norm (the page's TONE_COLOR), a bar without one, and what is left of it.
export const TONE_BAR: Record<Tone, string> = { good: "1F9D55", warn: "D69E2E", bad: "DC2626" };
const BAR = TONE_BAR;
const BAR_PLAIN = "2A78D6";
const TRACK = "ECEEF2";
// A day of a calendar with nothing to colour, and one without a route.
const CELL_PLAIN = "F0F3F7";
const CELL_EMPTY = "F8F9FB";
const WHITE = "FFFFFF";

// A colour at this opacity on white, as the page's tints are.
const tints = new Map<string, string>();
function tint(hex: string, alpha: number) {
  const key = `${hex}|${alpha}`;
  let color = tints.get(key);
  if (!color) {
    const clean = hex.replace("#", "");
    color = [0, 2, 4]
      .map((i) =>
        Math.round(255 - (255 - parseInt(clean.slice(i, i + 2), 16)) * alpha)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase();
    tints.set(key, color);
  }
  return color;
}

// --- Styles, one object per look -------------------------------------------------------------

// An edge of a cell: its colour, «!» after it for a thicker line, «!!» for a thick one.
type Edge = string | null | undefined;
type Look = {
  size?: number;
  bold?: boolean;
  color?: string;
  fill?: string | null;
  h?: "left" | "right" | "center";
  v?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  numFmt?: string;
  underline?: boolean;
  top?: Edge;
  bottom?: Edge;
  left?: Edge;
  right?: Edge;
};

const looks = new Map<string, Partial<ExcelJS.Style>>();
const edge = (value: Edge): Partial<ExcelJS.Border> | undefined =>
  value
    ? {
        style: value.endsWith("!!") ? "thick" : value.endsWith("!") ? "medium" : "thin",
        color: argb(value.replace(/!/g, "")),
      }
    : undefined;

function look(l: Look): Partial<ExcelJS.Style> {
  const key = [
    l.size,
    l.bold ? 1 : 0,
    l.color,
    l.fill,
    l.h,
    l.v,
    l.wrap ? 1 : 0,
    l.indent,
    l.numFmt,
    l.underline ? 1 : 0,
    l.top,
    l.bottom,
    l.left,
    l.right,
  ].join("|");
  let style = looks.get(key);
  if (style) return style;
  style = {
    font: {
      name: "Calibri",
      family: 2,
      size: l.size ?? 10,
      color: argb(l.color ?? INK),
      ...(l.bold ? { bold: true } : {}),
      ...(l.underline ? { underline: true } : {}),
    },
    alignment: {
      horizontal: l.h ?? "left",
      vertical: l.v ?? "top",
      ...(l.wrap ? { wrapText: true } : {}),
      ...(l.indent ? { indent: l.indent } : {}),
    },
  };
  if (l.fill) style.fill = { type: "pattern", pattern: "solid", fgColor: argb(l.fill) };
  if (l.numFmt) style.numFmt = l.numFmt;
  if (l.top || l.bottom || l.left || l.right)
    style.border = {
      ...(l.top ? { top: edge(l.top) } : {}),
      ...(l.bottom ? { bottom: edge(l.bottom) } : {}),
      ...(l.left ? { left: edge(l.left) } : {}),
      ...(l.right ? { right: edge(l.right) } : {}),
    };
  looks.set(key, style);
  return style;
}

// --- Numbers ---------------------------------------------------------------------------------

// A share as the page writes it: «57%», «41,4%» (the value is already in percent).
const percentFormat = (value: number) => (Number.isInteger(value) ? '0"%"' : '0.0"%"');

// Money as the page writes it (formatMoney): millions and billions shortened, the number kept.
function moneyFormat(value: number) {
  // A comma after the digits of a number format divides by a thousand.
  const word = (key: "connect.sum" | "connect.mln" | "connect.bln") => t(key).replace(/"/g, "");
  const size = Math.abs(value);
  if (size >= 1e9) return `#,##0.0#,,," ${word("connect.bln")} ${word("connect.sum")}"`;
  if (size >= 1e6) {
    const whole = Math.round(size / 1e5) % 10 === 0;
    return `#,##0${whole ? "" : ".0"},," ${word("connect.mln")} ${word("connect.sum")}"`;
  }
  return `#,##0" ${word("connect.sum")}"`;
}

function formatOf(value: Value, format: PageFormat | undefined, unit?: string) {
  if (typeof value !== "number") return undefined;
  if (format === "percent") return percentFormat(value);
  if (format === "money") return moneyFormat(value);
  if (format === "count" || format === undefined)
    return Number.isInteger(value) ? "#,##0" : "#,##0.0#";
  return numberFormat(format, unit);
}

// --- Sizes -----------------------------------------------------------------------------------

const lineHeight = (size: number) => Math.round(size * 1.36);
// A Korean (or another wide) letter takes the room of two: for counting, each is written twice.
const WIDE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/g;
const widened = (text: string) => text.replace(WIDE, "$&$&");
// How long a text is, in letters of the plain font.
const lengthOf = (text: string) => widened(text).length;
// How many lines a text takes over this many columns of the grid.
const linesOf = (text: string, units: number, size = 10, bold = false) =>
  textLines(widened(text), units * UNIT, ((bold ? BOLD : PLAIN) * size) / 11);

// An A4 sheet across, in points of the rows it holds (see finish).
const PAPER = { width: 842, height: 595, margin: 22 };

// --- What the blocks are made of -------------------------------------------------------------

// A tile of the level's headline numbers (the page's Kpi).
export type Tile = {
  label: string;
  value: Value;
  format?: PageFormat;
  tone?: Tone | null;
  // 0..100: the bar under the number.
  meter?: number | null;
  // Against the previous period, in the unit given («п.п.»).
  trend?: { delta: number; tone: Tone | null; unit: string } | null;
  note?: string | null;
};

// A number with its label inside a block (the page's StatGrid).
export type Stat = {
  label: string;
  value: Value;
  format?: PageFormat;
  tone?: Tone | null;
  note?: string | null;
};

// A column of a table: what it is on the sheet of the whole list and, when the page shows it,
// on the first sheet. One definition for both, so they never say different things.
export type TableColumn<T> = {
  header: string;
  // On the sheet of the whole list (false: the page's own column, see `page`).
  width?: number;
  sheet?: false;
  format?: CellFormat;
  unit?: string;
  value: (row: T) => Value;
  tone?: (row: T) => Tone | null;
  paint?: "cell" | "text";
  color?: (row: T) => string | null | undefined;
  source?: Source;
  // On the first sheet: how many columns of the grid it takes (`flex`: and what is left over),
  // and what the page shows that the list does not — another header, a number with a text, a
  // second line under the value.
  page?: {
    w: number;
    flex?: boolean;
    // Where it stands among the page's columns, when not where it stands in the list.
    at?: number;
    header?: string;
    // Under the header of the column before it (a share and its change).
    join?: boolean;
    value?: (row: T) => Value;
    format?: CellFormat;
    sub?: (row: T) => string | null | undefined;
    // Lines of a cell each in its own colour (a visit's issues, as the page writes them).
    lines?: (row: T) => { text: string; color?: string | null }[];
    // A text on the numbers' side («12 · 34%»); nothing instead of a dash where there is no
    // value; the value as a bar of filled cells (0..100).
    right?: boolean;
    blank?: boolean;
    bar?: (row: T) => number | null;
    bold?: boolean;
    muted?: (row: T) => boolean;
    tone?: (row: T) => Tone | null;
    paint?: "cell" | "text";
  };
};

export type TableDef<T> = {
  rows: T[];
  columns: TableColumn<T>[];
  // A row the page marks on its left edge.
  rowTone?: (row: T) => Tone | null;
  // The first cell's indent and weight (a position under another).
  indent?: (row: T) => number;
  bold?: (row: T) => boolean;
  // The sheet of the whole list. `always`: a list people work through (stores, zones, people)
  // has its sheet even when the page shows every row — the sheet has every column.
  full?: {
    name: string;
    source: SheetSource;
    about: string;
    always?: boolean;
    // Rows of the sheet that are not the table's (a heading inside it).
    rows?: SheetRow[];
  };
};

type Rich = { text: string; color?: string; bold?: boolean; size?: number }[];
type Written = Value | { text: string; hyperlink: string; tooltip?: string } | Rich;

const isRich = (value: Written): value is Rich => Array.isArray(value);

// A link to a cell of this workbook.
const cellLink = (sheet: string, row = 1) => `#'${sheet.replace(/'/g, "''")}'!A${row}`;

// --- The sheet -------------------------------------------------------------------------------

export class Page {
  readonly ws: ExcelJS.Worksheet;
  // The last row written.
  at = 0;
  // The columns the next block takes: the whole grid, or a half of it (see split).
  private from = 1;
  private to = GRID;
  private readonly heights = new Map<number, number>();
  // Where each block starts: for the links at the top and the page breaks.
  private readonly blocks: { row: number; nav: string | null; own?: boolean }[] = [];
  private chipRows: number[] = [];
  // The heading above what is being written: where a list's sheet links back to.
  private heading = { row: 1, text: "" };
  private columns = GRID;
  private merged = 0;
  private readonly aside: Record<string, unknown> = {};
  // Sheets of whole lists already made (a list two blocks show has one sheet).
  private readonly lists = new Map<string, { name: string; rows: number }>();

  constructor(
    book: ExcelJS.Workbook,
    name: string,
    private readonly addSheet: AddSheet,
  ) {
    this.ws = book.addWorksheet(sheetName(name), {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
      },
    });
  }

  get name() {
    return this.ws.name;
  }

  // --- Cells ---

  private get width() {
    return this.to - this.from + 1;
  }

  private next() {
    return ++this.at;
  }

  private need(row: number, height: number) {
    if (height > (this.heights.get(row) ?? 0)) this.heights.set(row, height);
  }

  // A value over the columns from..to of a row, in one look.
  private put(row: number, from: number, to: number, value: Written, style: Look) {
    const cell = this.ws.getCell(row, from);
    if (isRich(value))
      cell.value = {
        richText: value.map((part) => ({
          text: part.text,
          font: {
            name: "Calibri",
            family: 2,
            size: part.size ?? style.size ?? 10,
            color: argb(part.color ?? style.color ?? INK),
            ...(part.bold ? { bold: true } : {}),
          },
        })),
      };
    else if (value !== null) cell.value = value;
    cell.style = look(style);
    // The cells merged into it take its look (the lines around them).
    if (to > from) {
      this.ws.mergeCells(row, from, row, to);
      if (++this.merged % 64 === 0) this.setAside();
    }
    if (to > this.columns) this.columns = to;
    return cell;
  }

  // ExcelJS checks a new merge against every merge of the sheet, which makes the page's
  // thousands of them slow (the square of their number). The page never puts two cells in one
  // place, so the merges made are kept aside while it is written and given back at the end.
  private setAside() {
    const sheet = this.ws as unknown as { _merges?: Record<string, unknown> };
    if (!sheet._merges) return;
    Object.assign(this.aside, sheet._merges);
    sheet._merges = {};
  }

  // A text over the block's columns, the row as high as it needs.
  private wide(text: Written, style: Look, from = this.from, to = this.to, row = this.next()) {
    this.put(row, from, to, text, { wrap: true, ...style });
    const plain = isRich(text)
      ? text.map((part) => part.text).join("")
      : typeof text === "object" && text !== null
        ? text.text
        : String(text ?? "");
    const size = style.size ?? 10;
    this.need(row, linesOf(plain, to - from + 1, size, style.bold) * lineHeight(size) + 4);
    return row;
  }

  // An empty row of this height: the air between two blocks.
  gap(height = 8) {
    this.need(this.next(), height);
  }

  // --- The top of the page ---

  title(text: string) {
    const row = this.wide(text, { size: 16, bold: true, v: "middle" });
    this.need(row, linesOf(text, GRID, 16, true) * 22 + 8);
    this.heading = { row, text };
  }

  // «Период: 9–15 нояб.»: what the file is, a line each.
  facts(rows: [string, string][]) {
    for (const [label, value] of rows) {
      const row = this.next();
      this.put(row, 1, 8, label, { color: MUTED, wrap: true });
      this.wide(value, {}, 9, GRID, row);
      this.need(row, linesOf(label, 8) * lineHeight(10) + 4);
    }
  }

  // The links to the blocks stand here; they are written when the blocks are (see finish).
  chips() {
    this.gap(4);
    this.chipRows = [this.next(), this.next(), this.next()];
  }

  // --- Headings ---

  private tags(sources: readonly Source[] | undefined) {
    if (!sources?.length) return;
    const row = this.next();
    sources.forEach((source, i) => {
      const from = this.from + i * 5;
      this.put(row, from, from + 3, t(`connect.source.${source}`), {
        size: 9,
        color: SOURCE_INK[source],
        fill: SOURCE_FILL[source],
        h: "center",
        v: "middle",
        top: SOURCE_TAB[source],
        bottom: SOURCE_TAB[source],
        left: SOURCE_TAB[source],
        right: SOURCE_TAB[source],
      });
    });
    this.need(row, 16);
  }

  // A block of the page: its title, whose data it is, what it says. `nav`: its name among the
  // links at the top (false: it belongs to the block above).
  section(
    title: string,
    options: {
      sources?: readonly Source[];
      hint?: string | null;
      nav?: string | false;
      // A block of the file's own, not of the page («Нормы и цвета»).
      own?: boolean;
    } = {},
  ) {
    this.gap(14);
    const row = this.next();
    this.put(row, 1, GRID, title, { size: 14, bold: true, v: "middle", bottom: `${HEAD_LINE}!` });
    this.need(row, 26);
    this.blocks.push({
      row,
      nav: options.nav === false ? null : (options.nav ?? title),
      own: options.own,
    });
    this.heading = { row, text: title };
    this.gap(3);
    this.tags(options.sources);
    if (options.hint) this.text(options.hint, "muted");
    this.gap(4);
    return row;
  }

  // A heading inside a block. `rule`: the page draws a line above it. `nav`: the page lists it
  // among its sections all the same («Восстановление наличия»).
  sub(
    title: string,
    options: {
      level?: 3 | 4;
      sources?: readonly Source[];
      hint?: string | null;
      rule?: boolean;
      nav?: string;
    } = {},
  ) {
    this.gap(options.rule ? 10 : 6);
    const row = this.next();
    this.put(row, this.from, this.to, title, {
      size: options.level === 4 ? 11 : 12,
      bold: true,
      v: "middle",
      wrap: true,
      ...(options.rule ? { top: LINE } : {}),
    });
    const size = options.level === 4 ? 11 : 12;
    this.need(row, linesOf(title, this.width, size, true) * lineHeight(size) + 6);
    this.heading = { row, text: title };
    if (options.nav) this.blocks.push({ row, nav: options.nav });
    this.tags(options.sources);
    if (options.hint) this.text(options.hint, "small");
    return row;
  }

  // --- Texts ---

  text(text: string, kind: "plain" | "muted" | "small" | "good" = "plain") {
    return this.wide(
      text,
      kind === "muted"
        ? { color: MUTED }
        : kind === "small"
          ? { color: MUTED, size: 9 }
          : kind === "good"
            ? { color: TONE_TEXT.good }
            : {},
    );
  }

  // A text with a part of it in a colour of the norms («вопрос · проблемных: 12%»).
  rich(parts: { text: string; tone?: Tone | null; bold?: boolean }[]) {
    return this.wide(
      parts.map((part) => ({
        text: part.text,
        bold: part.bold,
        color: part.tone ? TONE_TEXT[part.tone] : undefined,
      })),
      {},
    );
  }

  // Whose page it is: the code and the name, under them where they work.
  person(title: string, name: string | null, sub: string | null) {
    this.gap(6);
    const row = this.wide(
      name
        ? [
            { text: title, bold: true },
            { text: ` · ${name}`, color: MUTED },
          ]
        : title,
      { size: 13, bold: !name, v: "middle" },
    );
    this.need(row, 22);
    if (sub) this.text(sub, "small");
  }

  // Whose data the columns of a table are: a name and its source tag, in a row.
  sources(items: { label: string; source: Source }[]) {
    const row = this.next();
    let at = this.from;
    for (const item of items) {
      const size = Math.max(3, Math.ceil((lengthOf(item.label) * 0.85 + 1) / UNIT));
      if (at + size + 4 > this.to) break;
      this.put(row, at, at + size - 1, item.label, { size: 9, color: MUTED, v: "middle" });
      this.put(row, at + size, at + size + 3, t(`connect.source.${item.source}`), {
        size: 8,
        color: SOURCE_INK[item.source],
        fill: SOURCE_FILL[item.source],
        h: "center",
        v: "middle",
        top: SOURCE_TAB[item.source],
        bottom: SOURCE_TAB[item.source],
        left: SOURCE_TAB[item.source],
        right: SOURCE_TAB[item.source],
      });
      at += size + 5;
    }
    this.need(row, 15);
    this.gap(3);
  }

  // A line the page sets apart on a tinted ground with a coloured left edge.
  callout(text: string, tone: Exclude<Tone, "good">) {
    const row = this.wide(text, {
      fill: tint(TONE_EDGE[tone]!, tone === "bad" ? 0.1 : 0.12),
      left: `${TONE_EDGE[tone]}!`,
      indent: 1,
      v: "middle",
    });
    this.need(row, (this.heights.get(row) ?? 0) + 4);
  }

  // A link under a block.
  link(text: string, target: string, tooltip?: string) {
    const row = this.next();
    const units = Math.min(this.width, Math.max(8, Math.ceil((lengthOf(text) + 2) / UNIT)));
    this.put(
      row,
      this.from,
      this.from + units - 1,
      { text, hyperlink: target, ...(tooltip ? { tooltip } : {}) },
      { color: LINK, underline: true, v: "middle" },
    );
    this.need(row, 18);
    return row;
  }

  // --- Tiles ---

  // The level's headline numbers in a row of boxes (the page's Kpi): the label, the number in
  // its colour with the change next to it, the bar, the note. A tile under its norm is outlined.
  tiles(tiles: Tile[], perRow: number) {
    const size = Math.floor((this.width - (perRow - 1)) / perRow);
    for (let start = 0; start < tiles.length; start += perRow) {
      const rows = [this.next(), this.next(), this.next(), this.next()];
      tiles.slice(start, start + perRow).forEach((tile, i) => {
        const from = this.from + i * (size + 1);
        const to = from + size - 1;
        const outline =
          tile.tone === "bad"
            ? `${TONE_EDGE.bad}!`
            : tile.tone === "warn"
              ? `${TONE_EDGE.warn}!`
              : HEAD_LINE;
        const sides = { left: outline, right: outline };
        this.put(rows[0]!, from, to, tile.label, {
          size: 9,
          color: MUTED,
          wrap: true,
          indent: 1,
          v: "middle",
          top: outline,
          ...sides,
        });
        this.need(rows[0]!, linesOf(tile.label, size - 1, 9) * lineHeight(9) + 6);
        const numFmt = formatOf(tile.value, tile.format);
        // Money («427,9 млн сум») is long: a smaller size keeps it in its tile.
        const long = tile.format === "money" || String(tile.value ?? "").length > 8;
        const trend = tile.trend ? Math.min(5, size - 4) : 0;
        this.put(rows[1]!, from, to - trend, tile.value ?? "—", {
          size: long ? 14 : 18,
          bold: true,
          color: tile.tone ? TONE_TEXT[tile.tone] : INK,
          indent: 1,
          v: "middle",
          numFmt,
          left: outline,
          ...(trend ? {} : { right: outline }),
        });
        if (tile.trend && trend)
          this.put(rows[1]!, to - trend + 1, to, tile.trend.delta, {
            size: 9,
            bold: true,
            color: tile.trend.tone ? TONE_TEXT[tile.trend.tone] : MUTED,
            h: "left",
            v: "middle",
            numFmt: numberFormat("change", tile.trend.unit),
            right: outline,
          });
        this.need(rows[1]!, 28);
        this.bar(rows[2]!, from, to, tile.meter ?? null, tile.tone ?? null, sides);
        this.need(rows[2]!, 5);
        this.put(rows[3]!, from, to, tile.note ?? null, {
          size: 9,
          color: MUTED,
          wrap: true,
          indent: 1,
          v: "middle",
          bottom: outline,
          ...sides,
        });
        this.need(rows[3]!, linesOf(tile.note ?? "", size - 1, 9) * lineHeight(9) + 6);
      });
      this.gap(6);
    }
  }

  // A bar as a run of filled cells: `share` of them (0..100) in the colour, the rest the track.
  // null: no bar, only the cells' sides.
  private bar(
    row: number,
    from: number,
    to: number,
    share: number | null,
    tone: Tone | null,
    sides: { left?: Edge; right?: Edge } = {},
    color?: string,
    bottom?: Edge,
  ) {
    const cells = to - from + 1;
    const filled =
      share === null ? 0 : Math.max(share > 0 ? 1 : 0, Math.round((share / 100) * cells));
    for (let c = 0; c < cells; c++)
      this.ws.getCell(row, from + c).style = look({
        fill:
          share === null ? null : c < filled ? (color ?? (tone ? BAR[tone] : BAR_PLAIN)) : TRACK,
        bottom,
        ...(c === 0 ? { left: sides.left } : {}),
        ...(c === cells - 1 ? { right: sides.right } : {}),
      });
  }

  // Numbers with their labels inside a block (the page's StatGrid): each a label, the number
  // (in colour when the page writes it so) and a note, with a line on its left.
  stats(stats: Stat[], perRow = 4) {
    const size = Math.floor(this.width / perRow);
    for (let start = 0; start < stats.length; start += perRow) {
      const rows = [this.next(), this.next(), this.next()];
      stats.slice(start, start + perRow).forEach((stat, i) => {
        const from = this.from + i * size;
        const to = from + size - 2;
        // Far below the norm: the number's own edge says so.
        const left = stat.tone === "bad" ? `${TONE_EDGE.bad}!` : HEAD_LINE;
        this.put(rows[0]!, from, to, stat.label, {
          size: 9,
          color: MUTED,
          wrap: true,
          indent: 1,
          left,
        });
        this.need(rows[0]!, linesOf(stat.label, size - 2, 9) * lineHeight(9) + 3);
        this.put(rows[1]!, from, to, stat.value ?? "—", {
          size: 14,
          bold: true,
          color: stat.tone ? TONE_TEXT[stat.tone] : INK,
          indent: 1,
          v: "middle",
          numFmt: formatOf(stat.value, stat.format),
          left,
        });
        this.need(rows[1]!, 22);
        this.put(rows[2]!, from, to, stat.note ?? null, {
          size: 9,
          color: MUTED,
          wrap: true,
          indent: 1,
          left,
        });
        this.need(rows[2]!, linesOf(stat.note ?? "", size - 2, 9) * lineHeight(9) + 3);
      });
      this.gap(8);
    }
  }

  // --- Tables ---

  // A table as the page shows it: its columns, its first `limit` rows, its tones and marks; under
  // it the link to the sheet with the whole list, when the page cuts it or the list is one people
  // work through. `rows`: the page's own order of them, when it is not the list's.
  table<T>(def: TableDef<T>, options: { limit?: number; rows?: T[]; more?: string } = {}) {
    const limit = options.limit ?? 50;
    const all = options.rows ?? def.rows;
    const shown = all.slice(0, limit);
    const columns = def.columns
      .filter((column) => column.page)
      .map((column, i) => ({ column, at: column.page!.at ?? i }))
      .sort((a, b) => a.at - b.at)
      .map(({ column }) => column);
    if (!all.length) this.text(t("connect.manager.noRows"), "muted");
    else if (columns.length) {
      const spans = this.spans(columns.map((column) => column.page!));
      const numeric = columns.map(
        (column) => isNumeric(column.page!.format ?? column.format) || Boolean(column.page!.right),
      );
      // A text right after a number («0» and then «Одна ниже цели») keeps a little off it.
      const after = columns.map((_, i) => i > 0 && !numeric[i] && numeric[i - 1]);
      // A bar stands under its number, in a thin row of its own under the record's, and runs
      // under the columns that share the number's header too.
      const barEnd = columns.map((_, i) => {
        let end = spans[i]![1];
        for (let j = i + 1; columns[j]?.page!.join; j++) end = spans[j]![1];
        return end;
      });
      const barred = columns.map((_, i) =>
        columns.some((column, j) => column.page!.bar && j <= i && spans[i]![1] <= barEnd[j]!),
      );
      const bars = barred.some(Boolean);
      const head = this.next();
      let lines = 1;
      columns.forEach((column, i) => {
        const [from, to] = spans[i]!;
        // A column that stands under the header of the one before it has none of its own.
        const header = column.page!.join ? null : (column.page!.header ?? column.header);
        this.put(head, from, to, header, {
          size: 9,
          bold: true,
          color: HEAD_INK,
          fill: HEAD_FILL,
          h: numeric[i] ? "right" : "left",
          v: "bottom",
          wrap: true,
          indent: after[i] ? 1 : undefined,
          // Whose data the column is: the line under its header in the source's colour.
          bottom: column.source ? `${SOURCE_TAB[column.source]}!` : HEAD_LINE,
        });
        if (header) lines = Math.max(lines, linesOf(header, to - from + 1, 9, true));
      });
      this.need(head, Math.min(5, lines) * lineHeight(9) + 6);
      shown.forEach((item) => {
        const row = this.next();
        const under = bars ? this.next() : 0;
        const mark = def.rowTone?.(item) ?? null;
        let height = 1;
        columns.forEach((column, i) => {
          const [from, to] = spans[i]!;
          const page = column.page!;
          const value = page.value ? page.value(item) : column.value(item);
          const format = page.format ?? column.format;
          const sub = page.sub?.(item) ?? null;
          const tone = (page.tone ?? column.tone)?.(item) ?? null;
          const written = tone && (page.paint ?? column.paint) === "text" ? tone : null;
          // A marked row has a coloured left edge, as on the page.
          const edged = i === 0 && mark && TONE_EDGE[mark] ? mark : null;
          const tinted = tone && !written ? tone : null;
          const color = written
            ? TONE_TEXT[written]
            : tinted
              ? TONE_INK[tinted]
              : (column.color?.(item)?.replace("#", "").toUpperCase() ??
                (page.muted?.(item) ? MUTED : INK));
          const bold = page.bold || (i === 0 && def.bold?.(item));
          const style: Look = {
            color,
            fill: tinted ? TONE_FILL[tinted] : null,
            bold,
            h: numeric[i] ? "right" : "left",
            wrap: !isNumeric(format),
            indent: i === 0 ? def.indent?.(item) : after[i] ? 1 : undefined,
            numFmt: formatOf(value, format, column.unit),
            bottom: bars ? undefined : LINE,
            left: edged ? `${TONE_EDGE[edged]}!!` : undefined,
          };
          // The line under the record is under its bar: the bar runs under its number and
          // the columns that share its header; the other cells of the thin row carry the line
          // (a tinted cell is tinted down to it, a marked row keeps its mark).
          if (under && page.bar)
            this.bar(under, from, barEnd[i]!, page.bar(item), null, {}, undefined, LINE);
          else if (under && !barred[i])
            for (let c = from; c <= to; c++)
              this.ws.getCell(under, c).style = look({
                fill: tinted ? TONE_FILL[tinted] : null,
                bottom: LINE,
                left: c === from && edged ? `${TONE_EDGE[edged]}!!` : undefined,
              });
          const text = value === null || value === "" ? (page.blank ? "" : "—") : value;
          const parts = page.lines?.(item) ?? null;
          if (parts?.length) {
            this.put(
              row,
              from,
              to,
              parts.map((line, k) => ({
                text: `${k ? "\n" : ""}${line.text}`,
                color: line.color?.replace("#", "").toUpperCase() ?? undefined,
              })),
              { ...style, wrap: true },
            );
            height = Math.max(
              height,
              parts.reduce((a, line) => a + linesOf(line.text, to - from + 1), 0) * lineHeight(10),
            );
            return;
          }
          // The second line under a value (a name under its code), smaller and muted.
          this.put(
            row,
            from,
            to,
            sub
              ? [
                  { text: String(text), bold: Boolean(bold) },
                  { text: `\n${sub}`, color: MUTED, size: 9 },
                ]
              : text,
            sub ? { ...style, wrap: true } : style,
          );
          const units = to - from + 1 - (style.indent ?? 0) * 0.5;
          const main = isNumeric(format) ? 1 : linesOf(String(text), units, 10, style.bold);
          height = Math.max(
            height,
            main * lineHeight(10) + (sub ? linesOf(sub, units, 9) * lineHeight(9) : 0),
          );
        });
        this.need(row, height + 5);
        if (under) this.need(under, 5);
      });
    }
    const cut = all.length - shown.length;
    if (def.full && all.length && (cut > 0 || def.full.always)) this.list(def);
    // A table that has no list of its own says how many more rows there are.
    else if (cut > 0 && options.more !== "")
      this.text(options.more ?? t("connect.recovery.moreSkus", { count: cut }), "small");
    return { shown: shown.length, total: all.length };
  }

  // The link to the sheet with the whole list (made when the first block asks for it).
  list<T>(def: TableDef<T>, label?: string) {
    const full = def.full;
    if (!full || !def.rows.length) return;
    let made = this.lists.get(full.name);
    if (!made) {
      const columns = def.columns.filter((column) => column.sheet !== false);
      const ws = this.addSheet(
        full.name,
        columns.map((column): SheetColumn => ({
          header: column.header,
          width: column.width ?? 14,
          format: column.format,
          unit: column.unit,
          source: column.source,
          paint: column.paint,
          tone: column.tone && ((_, __, i) => column.tone!(def.rows[i]!)),
          color: column.color && ((_, __, i) => column.color!(def.rows[i]!)),
        })),
        full.rows ?? def.rows.map((row) => columns.map((column) => column.value(row))),
        {
          source: full.source,
          about: full.about,
          rowTone: def.rowTone && ((_, i) => def.rowTone!(def.rows[i]!)),
          back: {
            text: t("connect.page.back", { sheet: this.name, block: this.heading.text }),
            target: cellLink(this.name, this.heading.row),
          },
        },
      );
      made = { name: ws.name, rows: def.rows.length };
      this.lists.set(full.name, made);
    }
    const rows = plural("connect.words.rows", made.rows);
    this.link(
      label ? t("connect.page.list", { name: label, rows }) : t("connect.page.fullList", { rows }),
      cellLink(made.name),
      full.about,
    );
  }

  // How the columns of a table share the block's columns of the grid: each what it asks for,
  // what is left over to those that stretch; when there is too little, the widest give way.
  private spans(columns: { w: number; flex?: boolean }[]): [number, number][] {
    const widths = columns.map((column) => column.w);
    let spare = this.width - widths.reduce((a, b) => a + b, 0);
    const flex = columns.map((column, i) => (column.flex ? i : -1)).filter((i) => i >= 0);
    const stretch = flex.length ? flex : [0];
    for (let i = 0; spare > 0; i++, spare--) widths[stretch[i % stretch.length]!]! += 1;
    while (spare < 0) {
      const widest = widths.indexOf(Math.max(...widths));
      if (widths[widest]! <= 1) break;
      widths[widest]! -= 1;
      spare += 1;
    }
    let from = this.from;
    return widths.map((width) => {
      const span: [number, number] = [from, from + width - 1];
      from += width;
      return span;
    });
  }

  // --- Bars ---

  // Bars with a label and a value (the page's BarList): the bar is cells filled up to the
  // value's share of the largest. `stacked`: a long label stands on its own line above the bar.
  bars(
    rows: { label: string; value: number; color?: string; note?: string | null }[],
    options: { format?: "count" | "percent"; stacked?: boolean; color?: string } = {},
  ) {
    const max = Math.max(1, ...rows.map((row) => row.value));
    const noted = rows.some((row) => row.note);
    const note = noted ? Math.max(4, Math.round(this.width * 0.28)) : 0;
    const label = options.stacked ? 0 : Math.round(this.width * 0.36);
    for (const item of rows) {
      const color = (item.color ?? options.color ?? BAR_PLAIN).replace("#", "").toUpperCase();
      if (options.stacked) this.wide(item.label, {});
      const row = this.next();
      if (!options.stacked) {
        this.put(row, this.from, this.from + label - 1, item.label, { wrap: true, v: "middle" });
        this.need(row, linesOf(item.label, label) * lineHeight(10) + 5);
      }
      const from = this.from + label;
      const to = this.to - 3 - note;
      this.bar(row, from, to, (item.value / max) * 100, null, {}, color);
      this.put(row, to + 1, to + 3, item.value, {
        bold: true,
        h: "right",
        v: "middle",
        numFmt:
          options.format === "percent" ? percentFormat(item.value) : formatOf(item.value, "count"),
      });
      if (note) {
        this.put(row, to + 4, this.to, item.note ? `· ${item.note}` : null, {
          size: 9,
          color: MUTED,
          wrap: true,
          v: "middle",
        });
        this.need(row, linesOf(item.note ?? "", note, 9) * lineHeight(9) + 5);
      }
      this.need(row, options.stacked ? 14 : 18);
      if (options.stacked) this.gap(3);
    }
  }

  // The parts of a whole as one bar across the block (the page's StageBar and AnswerBar): each
  // part takes its share of the cells.
  private whole(parts: { value: number; color: string }[]) {
    const total = parts.reduce((a, part) => a + part.value, 0);
    if (!total) return false;
    const cells = this.width;
    // The largest remainders get the cells left over (a part too small for a cell has none: its
    // number is in the legend).
    const exact = parts.map((part) => (part.value / total) * cells);
    const counts = exact.map((x) => Math.floor(x));
    let spare = cells - counts.reduce((a, b) => a + b, 0);
    const order = exact
      .map((x, i) => ({ i, rest: x - Math.floor(x) }))
      .sort((a, b) => b.rest - a.rest);
    for (let k = 0; spare > 0 && order.length; k++, spare--)
      counts[order[k % order.length]!.i]! += 1;
    while (spare < 0) {
      const widest = counts.indexOf(Math.max(...counts));
      counts[widest]! -= 1;
      spare += 1;
    }
    const row = this.next();
    let at = this.from;
    parts.forEach((part, i) => {
      for (let c = 0; c < counts[i]!; c++, at++)
        this.ws.getCell(row, at).style = look({
          fill: part.color.replace("#", "").toUpperCase(),
          // A white line between two parts, as the page leaves.
          ...(c === counts[i]! - 1 ? { right: WHITE } : {}),
        });
    });
    this.need(row, 13);
    return true;
  }

  // One bar of stages with its legend under it: a mark, the stage, its number, a note.
  stages(rows: { label: string; value: number; color: string; note?: string | null }[]) {
    if (!this.whole(rows)) return this.text(t("connect.manager.noRows"), "muted");
    this.gap(3);
    const note = rows.some((row) => row.note) ? Math.max(5, Math.round(this.width * 0.4)) : 0;
    for (const item of rows) {
      const row = this.next();
      this.swatch(row, this.from, item.color);
      const to = this.to - 3 - note;
      this.put(row, this.from + 1, to, item.label, { wrap: true, indent: 1, v: "middle" });
      this.put(row, to + 1, to + 3, item.value, {
        bold: true,
        h: "right",
        v: "middle",
        numFmt: "#,##0",
      });
      if (note)
        this.put(row, to + 4, this.to, item.note ? `· ${item.note}` : null, {
          size: 9,
          color: MUTED,
          v: "middle",
          wrap: true,
        });
      this.need(
        row,
        Math.max(
          linesOf(item.label, to - this.from, 10) * lineHeight(10),
          note ? linesOf(item.note ?? "", note, 9) * lineHeight(9) : 0,
        ) + 4,
      );
    }
  }

  // A question's answers: one bar and its legend in a row — a mark, the answer, how many.
  answers(parts: { label: string; value: number; color: string }[], perRow = 4) {
    if (!this.whole(parts)) return;
    const size = Math.floor(this.width / perRow);
    for (let start = 0; start < parts.length; start += perRow) {
      const row = this.next();
      let height = 1;
      parts.slice(start, start + perRow).forEach((part, i) => {
        const from = this.from + i * size;
        this.swatch(row, from, part.color);
        this.put(row, from + 1, from + size - 4, part.label, {
          size: 9,
          color: MUTED,
          wrap: true,
          indent: 1,
        });
        this.put(row, from + size - 3, from + size - 2, part.value, {
          size: 9,
          h: "right",
          numFmt: "#,##0",
        });
        height = Math.max(height, linesOf(part.label, size - 5, 9));
      });
      this.need(row, height * lineHeight(9) + 4);
    }
  }

  // A small square of a colour: the mark of a legend.
  private swatch(row: number, column: number, color: string) {
    this.ws.getCell(row, column).style = look({
      fill: color.replace("#", "").toUpperCase(),
      top: WHITE,
      bottom: WHITE,
      left: WHITE,
      right: WHITE,
    });
  }

  // A legend in one row: a mark and what it means, each over `size` columns.
  legend(items: { color?: string | null; text: string }[], size?: number) {
    const each = size ?? Math.floor(this.width / Math.max(1, items.length));
    const row = this.next();
    let height = 1;
    items.forEach((item, i) => {
      const from = this.from + i * each;
      if (item.color) this.swatch(row, from, item.color);
      const start = item.color ? from + 1 : from;
      this.put(row, start, from + each - 1, item.text, {
        size: 9,
        color: MUTED,
        wrap: true,
        indent: item.color ? 1 : 0,
        v: "middle",
      });
      height = Math.max(height, linesOf(item.text, from + each - start, 9));
    });
    this.need(row, height * lineHeight(9) + 5);
  }

  // Numbers by day (the page's columns per day): a row per day with its numbers and one bar —
  // each series from the left edge over the one before it, so the plan is the grey that shows
  // past the visits. `series` come from the largest to the smallest, as the page draws them.
  days(days: { label: string; values: number[] }[], series: { label: string; color: string }[]) {
    const max = Math.max(1, ...days.flatMap((day) => day.values));
    const number = 3;
    const label = 4;
    const from = this.from + label + number * series.length;
    const cells = this.to - from + 1;
    const head = this.next();
    this.put(head, this.from, this.from + label - 1, t("connect.col.day"), tableHead("left"));
    series.forEach((s, i) => {
      const at = this.from + label + i * number;
      this.put(head, at, at + number - 1, s.label, tableHead("right"));
    });
    this.put(head, from, this.to, null, tableHead("left"));
    this.need(
      head,
      Math.max(...series.map((s) => linesOf(s.label, number, 9, true))) * lineHeight(9) + 6,
    );
    for (const day of days) {
      const row = this.next();
      this.put(row, this.from, this.from + label - 1, day.label, { bottom: LINE, v: "middle" });
      day.values.forEach((value, i) => {
        const at = this.from + label + i * number;
        this.put(row, at, at + number - 1, value, {
          h: "right",
          v: "middle",
          numFmt: "#,##0",
          bottom: LINE,
        });
      });
      for (let c = 0; c < cells; c++) {
        // The middle of the cell, as a value of the scale.
        const point = ((c + 0.5) / cells) * max;
        let color: string | null = null;
        day.values.forEach((value, i) => {
          if (value >= point || (c === 0 && value > 0)) color = series[i]!.color;
        });
        this.ws.getCell(row, from + c).style = look({
          fill: color ? (color as string).replace("#", "").toUpperCase() : null,
          bottom: LINE,
        });
      }
      this.need(row, 16);
    }
    this.gap(3);
    this.legend(
      series.map((s) => ({ color: s.color, text: s.label })),
      Math.floor(this.width / series.length),
    );
  }

  // --- The page's drawings as cells ---

  // A calendar: rows down, days across, a cell tinted against the target; the period's share at
  // the end of the row (a heat table on the page, the same here).
  calendar(input: {
    head: string;
    total: string;
    days: { top: string; bottom: string; weekend: boolean }[];
    rows: {
      label: string;
      sub: string | null;
      cells: ({ text: string; tone: Tone | null } | null)[];
      share: number | null;
      tone: Tone | null;
      of: string;
    }[];
    legend: { tone: Tone | null; text: string }[];
    note: string;
  }) {
    const label = 9;
    const first = this.from + label;
    const end = first + input.days.length;
    const top = this.next();
    const bottom = this.next();
    this.put(bottom, this.from, first - 1, input.head, { size: 9, bold: true, v: "bottom" });
    input.days.forEach((day, i) => {
      this.put(top, first + i, first + i, day.top, {
        size: 7,
        color: day.weekend ? TONE_TEXT.warn : MUTED,
        h: "center",
        v: "bottom",
      });
      this.put(bottom, first + i, first + i, day.bottom, { size: 9, bold: true, h: "center" });
    });
    this.put(bottom, end, end + 6, input.total, {
      size: 9,
      bold: true,
      v: "bottom",
      indent: 1,
      wrap: true,
    });
    this.need(top, 11);
    this.need(bottom, linesOf(input.total, 6, 9, true) * lineHeight(9) + 3);
    for (const item of input.rows) {
      const row = this.next();
      this.put(
        row,
        this.from,
        first - 1,
        item.sub
          ? [{ text: item.label }, { text: `\n${item.sub}`, color: MUTED, size: 8 }]
          : item.label,
        { size: 9, wrap: true, v: "middle" },
      );
      item.cells.forEach((cell, i) => {
        const c = this.ws.getCell(row, first + i);
        if (cell?.text) c.value = /^\d+$/.test(cell.text) ? Number(cell.text) : cell.text;
        c.style = look({
          size: 8,
          bold: true,
          h: "center",
          v: "middle",
          color: cell?.tone ? TONE_INK[cell.tone] : MUTED,
          fill: cell?.tone ? TONE_FILL[cell.tone] : cell ? CELL_PLAIN : CELL_EMPTY,
          // The page leaves a gap between two days.
          top: WHITE,
          bottom: WHITE,
          left: WHITE,
          right: WHITE,
        });
      });
      this.put(row, end, end + 2, item.share ?? "—", {
        size: 9,
        bold: true,
        h: "right",
        v: "middle",
        color: item.tone ? TONE_INK[item.tone] : INK,
        fill: item.tone ? TONE_FILL[item.tone] : null,
        numFmt: formatOf(item.share, "percent"),
        left: WHITE,
      });
      this.put(row, end + 3, end + 6, item.of, { size: 8, color: MUTED, v: "middle", indent: 1 });
      this.need(row, item.sub ? 25 : 16);
    }
    this.gap(4);
    this.legend([
      ...input.legend.map((item) => ({
        color: item.tone ? TONE_FILL[item.tone] : CELL_EMPTY,
        text: item.text,
      })),
      { text: input.note },
    ]);
  }

  // The «Visit × Hitting» matrix as its four corners: across — attendance under and at its
  // target, down — hit rate at and under its own; each corner tinted in the colour of its
  // class, with how many zones are in it and which.
  quadrants(input: {
    columns: [string, string];
    rows: [string, string];
    cells: { title: string; count: number; tone: Tone; items: string }[][];
  }) {
    const side = 7;
    const size = Math.floor((this.width - side) / 2);
    const head = this.next();
    input.columns.forEach((text, i) => {
      const from = this.from + side + i * size;
      this.put(head, from, from + size - 1, text, { ...tableHead("center"), wrap: true });
    });
    this.need(head, 18);
    input.cells.forEach((pair, r) => {
      const title = this.next();
      const body = this.next();
      this.put(title, this.from, this.from + side - 1, input.rows[r]!, {
        size: 9,
        bold: true,
        color: HEAD_INK,
        wrap: true,
      });
      let lines = 1;
      pair.forEach((cell, i) => {
        const from = this.from + side + i * size;
        const to = from + size - 1;
        const ground = tint(BAR[cell.tone], 0.14);
        const outline = { left: WHITE, right: WHITE };
        this.put(
          title,
          from,
          to,
          [
            { text: String(cell.count), bold: true, size: 14, color: INK },
            { text: `  ${cell.title}`, color: TONE_TEXT[cell.tone], bold: true },
          ],
          { fill: ground, v: "middle", indent: 1, top: WHITE, ...outline },
        );
        this.put(body, from, to, cell.items || null, {
          size: 9,
          color: INK,
          fill: ground,
          wrap: true,
          indent: 1,
          bottom: WHITE,
          ...outline,
        });
        lines = Math.max(lines, linesOf(cell.items, size - 1, 9));
      });
      this.need(title, 24);
      this.need(body, Math.min(400, lines * lineHeight(9) + 6));
    });
  }

  // Cards next to each other, each a short list of the lowest numbers (the page's «Худшие
  // результаты»): outlined by its worst row, a bar under every number.
  cards(
    cards: {
      title: string;
      norm: string;
      rows: {
        title: string;
        note?: string | null;
        value: number;
        of?: string | null;
        tone: Tone | null;
      }[];
    }[],
    perRow = 4,
  ) {
    const size = Math.floor((this.width - (perRow - 1)) / perRow);
    for (let start = 0; start < cards.length; start += perRow) {
      const group = cards.slice(start, start + perRow);
      const depth = Math.max(...group.map((card) => card.rows.length));
      const first = this.at + 1;
      this.at += 2 + depth * 4 + 1;
      group.forEach((card, i) => {
        const from = this.from + i * (size + 1);
        const to = from + size - 1;
        // The card is as bad as its worst row.
        const worst =
          (["bad", "warn", "good"] as const).find((tone) =>
            card.rows.some((row) => row.tone === tone),
          ) ?? null;
        const outline = `${worst === "bad" || worst === "warn" ? TONE_EDGE[worst] : "5EC79D"}!`;
        const ground =
          worst === "bad"
            ? tint(TONE_EDGE.bad!, 0.04)
            : worst === "warn"
              ? tint(TONE_EDGE.warn!, 0.06)
              : null;
        const sides = { left: outline, right: outline };
        this.put(
          first,
          from,
          to,
          worst
            ? [
                { text: "● ", color: BAR[worst], bold: true },
                { text: card.title, bold: true },
              ]
            : card.title,
          { bold: true, wrap: true, v: "middle", indent: 1, fill: ground, top: outline, ...sides },
        );
        this.need(first, linesOf(`● ${card.title}`, size - 1, 10, true) * lineHeight(10) + 8);
        this.put(first + 1, from, to, card.norm, {
          size: 9,
          color: MUTED,
          indent: 1,
          fill: ground,
          ...sides,
        });
        this.need(first + 1, 15);
        for (let r = 0; r < depth; r++) {
          // A row of the list: its place, the name and the number; under them the note and what
          // the number is of; then the bar and a little air.
          const row = first + 2 + r * 4;
          const item = card.rows[r];
          if (!item) {
            for (let k = 0; k < 4; k++)
              this.put(row + k, from, to, null, { fill: ground, ...sides });
            continue;
          }
          this.put(row, from, from, r + 1, {
            size: 9,
            color: MUTED,
            h: "center",
            fill: ground,
            left: outline,
          });
          this.put(row, from + 1, to - 3, item.title, { bold: true, fill: ground });
          this.put(row, to - 2, to, item.value, {
            bold: true,
            h: "right",
            color: item.tone ? TONE_INK[item.tone] : INK,
            fill: item.tone ? TONE_FILL[item.tone] : ground,
            numFmt: percentFormat(item.value),
            right: outline,
          });
          this.need(row, 16);
          this.put(row + 1, from, from, null, { fill: ground, left: outline });
          this.put(row + 1, from + 1, to - 4, item.note ?? null, {
            size: 9,
            color: MUTED,
            fill: ground,
          });
          this.put(row + 1, to - 3, to, item.of ?? null, {
            size: 8,
            color: MUTED,
            h: "right",
            fill: ground,
            right: outline,
          });
          this.need(row + 1, 13);
          this.bar(row + 2, from, to, Math.max(2, Math.min(100, item.value)), item.tone, sides);
          this.need(row + 2, 5);
          this.put(row + 3, from, to, null, { fill: ground, ...sides });
          this.need(row + 3, 5);
        }
        this.put(first + 2 + depth * 4, from, to, null, {
          fill: ground,
          bottom: outline,
          ...sides,
        });
        this.need(first + 2 + depth * 4, 3);
      });
      this.gap(8);
    }
  }

  // The steps of a chain as tiles in a row (the page's funnel): the step, how many reached it,
  // its share of the step before, how many went no further, a note, whose data it is.
  steps(
    steps: {
      label: string;
      value: number;
      rate?: string | null;
      stopped?: { text: string; tone: Tone | null } | null;
      note?: string | null;
      source: Source;
    }[],
  ) {
    const perRow = Math.max(1, steps.length);
    const size = Math.floor((this.width - (perRow - 1)) / perRow);
    const rows = Array.from({ length: 6 }, () => this.next());
    steps.forEach((step, i) => {
      const from = this.from + i * (size + 1);
      const to = from + size - 1;
      const outline = step.stopped?.tone === "bad" ? `${TONE_EDGE.bad}!` : HEAD_LINE;
      const sides = { left: outline, right: outline };
      const line = (row: number, value: Written, style: Look, sizeOf = 9) => {
        this.put(row, from, to, value, {
          size: sizeOf,
          wrap: true,
          indent: 1,
          v: "middle",
          ...sides,
          ...style,
        });
        if (typeof value === "string")
          this.need(row, linesOf(value, size - 1, sizeOf, style.bold) * lineHeight(sizeOf) + 4);
      };
      line(rows[0]!, step.label, { color: MUTED, top: outline });
      line(rows[1]!, step.value, { bold: true, numFmt: "#,##0" }, 16);
      this.need(rows[1]!, 26);
      line(rows[2]!, step.rate ?? null, {});
      line(rows[3]!, step.stopped?.text ?? null, {
        bold: true,
        color: step.stopped?.tone ? TONE_TEXT[step.stopped.tone] : INK,
      });
      line(rows[4]!, step.note ?? null, { color: MUTED });
      this.put(rows[5]!, from, to, t(`connect.source.${step.source}`), {
        size: 8,
        color: SOURCE_INK[step.source],
        fill: SOURCE_FILL[step.source],
        indent: 1,
        v: "middle",
        bottom: outline,
        ...sides,
      });
      this.need(rows[5]!, 14);
    });
    this.gap(8);
  }

  // The owner's norms with what each colour means (a row each: the norm, its value, then what
  // is green, amber and red), and under them what is coloured without a norm.
  norms(input: {
    head: [string, string, string, string, string];
    rows: { label: string; value: string; good: string; warn: string; bad: string }[];
    more: { title: string; rows: [string, string][] };
  }) {
    const spans: [number, number][] = [
      [1, 14],
      [15, 18],
      [19, 28],
      [29, 38],
      [39, GRID],
    ];
    const head = this.next();
    input.head.forEach((text, i) =>
      this.put(head, spans[i]![0], spans[i]![1], text, tableHead("left")),
    );
    this.need(
      head,
      Math.max(
        ...input.head.map((text, i) => linesOf(text, spans[i]![1] - spans[i]![0] + 1, 9, true)),
      ) *
        lineHeight(9) +
        6,
    );
    for (const norm of input.rows) {
      const row = this.next();
      this.put(row, 1, 14, norm.label, { wrap: true, bottom: LINE });
      this.put(row, 15, 18, norm.value, { bold: true, bottom: LINE });
      let lines = linesOf(norm.label, 14);
      (["good", "warn", "bad"] as const).forEach((tone, i) => {
        const [from, to] = spans[2 + i]!;
        this.put(row, from, to, norm[tone], {
          color: TONE_INK[tone],
          fill: TONE_FILL[tone],
          wrap: true,
          bottom: LINE,
        });
        lines = Math.max(lines, linesOf(norm[tone], to - from + 1));
      });
      this.need(row, lines * lineHeight(10) + 5);
    }
    if (!input.more.rows.length) return;
    this.sub(input.more.title, { level: 4 });
    for (const [where, rule] of input.more.rows) {
      const row = this.next();
      this.put(row, 1, 14, where, { wrap: true, bottom: LINE });
      this.put(row, 15, GRID, rule, { wrap: true, bottom: LINE });
      this.need(row, Math.max(linesOf(where, 14), linesOf(rule, GRID - 14)) * lineHeight(10) + 5);
    }
  }

  // --- Layout ---

  // Two blocks next to each other, as the page sets them on a wide screen; what comes after
  // starts under the taller one.
  split(left: () => void, right: () => void) {
    const { from, to, at } = this;
    const middle = from + Math.floor((to - from - 1) / 2) - 1;
    this.to = middle;
    left();
    const end = this.at;
    this.at = at;
    this.from = middle + 3;
    this.to = to;
    right();
    this.at = Math.max(end, this.at);
    this.from = from;
  }

  // The heights, the links at the top, the print: when every block is written.
  finish() {
    for (let c = 1; c <= this.columns; c++) this.ws.getColumn(c).width = UNIT;
    // The links to the blocks, as many in a row as fit. As the page: two blocks are in sight
    // anyway.
    const links = this.blocks.filter((block) => block.nav);
    let line = 0;
    let at = 1;
    for (const block of links.filter((link) => !link.own).length > 2 ? links : []) {
      const size = Math.min(GRID, Math.max(4, Math.ceil((lengthOf(block.nav!) * 0.9 + 3) / UNIT)));
      if (at + size - 1 > GRID) {
        line += 1;
        at = 1;
      }
      if (line >= this.chipRows.length) break;
      this.put(
        this.chipRows[line]!,
        at,
        at + size - 1,
        { text: block.nav!, hyperlink: cellLink(this.name, block.row) },
        {
          size: 9,
          color: LINK,
          h: "center",
          v: "middle",
          top: HEAD_LINE,
          bottom: HEAD_LINE,
          left: HEAD_LINE,
          right: HEAD_LINE,
        },
      );
      this.need(this.chipRows[line]!, 20);
      at += size + 1;
    }
    // A row kept for the links and not needed is not seen.
    for (const row of this.chipRows) if (!this.heights.has(row)) this.heights.set(row, 1.5);
    for (const [row, height] of this.heights) this.ws.getRow(row).height = height;

    // On paper: blocks that surely fit a sheet together stay on it; any other block starts a
    // new sheet, so its title never stands alone at the foot of one (a long table then goes on
    // over the next sheets). The room a sheet has is counted with a margin: a program lays the
    // rows out a little differently from the estimate.
    const scale = (PAPER.width - 2 * PAPER.margin) / (this.columns * UNIT * 7 * 0.75);
    const sheet = ((PAPER.height - 2 * PAPER.margin) / scale) * 0.85;
    const heightOf = (from: number, to: number) => {
      let total = 0;
      for (let row = from; row <= to; row++) total += this.heights.get(row) ?? 15;
      return total;
    };
    let used = heightOf(1, (this.blocks[0]?.row ?? this.at + 1) - 1);
    this.blocks.forEach((block, i) => {
      const end = (this.blocks[i + 1]?.row ?? this.at + 1) - 1;
      const height = heightOf(block.row, end);
      if (used + height <= sheet) {
        used += height;
        return;
      }
      // The gap above the title belongs to the sheet before. After a block longer than a sheet
      // nobody knows where on its last sheet it ends: the next block starts a new one too.
      this.ws.getRow(block.row - 2).addPageBreak();
      used = height > sheet ? Infinity : height;
    });
    this.ws.pageSetup.printArea = `A1:${this.ws.getColumn(this.columns).letter}${this.at}`;
    const made = this.ws as unknown as { _merges?: Record<string, unknown> };
    if (made._merges) made._merges = { ...this.aside, ...made._merges };
  }
}

const NUMERIC: Record<CellFormat, boolean> = {
  count: true,
  percent: true,
  money: true,
  change: true,
  text: false,
  date: false,
};
const isNumeric = (format: CellFormat | undefined) => NUMERIC[format ?? "text"];

// The header of a table on the page.
const tableHead = (h: "left" | "right" | "center"): Look => ({
  size: 9,
  bold: true,
  color: HEAD_INK,
  fill: HEAD_FILL,
  h,
  v: "bottom",
  wrap: true,
  bottom: HEAD_LINE,
});
