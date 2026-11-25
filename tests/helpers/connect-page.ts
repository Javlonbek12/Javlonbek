import type ExcelJS from "exceljs";
import JSZip from "jszip";

// Reads the first sheet of the Connect download — the page itself (modules/connect/xlsx-page.ts)
// — the way a person does: by its titles. A block is found by its title and gives its rows, its
// tables and its links, so a test says «the block "По регионам" has the row …» instead of naming
// cells of a sheet whose rows move when a block above grows.

export type PageCell = ExcelJS.Cell;

// What a cell says: a text for a link or a text of several fonts, the value otherwise.
export function said(cell: ExcelJS.Cell): string | number | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return cell.text;
}

export const fillOf = (cell: ExcelJS.Cell) =>
  cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined;
export const inkOf = (cell: ExcelJS.Cell) => cell.font?.color?.argb;

// A link to a cell of the workbook: the sheet and the row it opens.
export function linkOf(cell: ExcelJS.Cell): { text: string; sheet: string; row: number } | null {
  const match = /^#'(.*)'!A(\d+)$/.exec(cell.hyperlink ?? "");
  return match
    ? { text: cell.text, sheet: match[1]!.replace(/''/g, "'"), row: Number(match[2]) }
    : null;
}

const HEAD_FILL = "FFF0F3F7";
// The line under a record of a table.
const RECORD_LINE = "FFE3E6EC";
// The header of a table on the page: bold, small, on the header's ground.
const isHead = (cell: ExcelJS.Cell) =>
  fillOf(cell) === HEAD_FILL && cell.font?.bold === true && cell.font.size === 9;
// A block's title: the largest of the page's headings, with the line under it.
const isTitle = (cell: ExcelJS.Cell) =>
  cell.font?.size === 14 && cell.font.bold === true && cell.border?.bottom?.style === "medium";
// A heading inside a block.
const isHeading = (cell: ExcelJS.Cell) =>
  typeof cell.value === "string" &&
  cell.font?.bold === true &&
  (cell.font.size === 12 || cell.font.size === 11) &&
  !fillOf(cell);

export type PageTable = {
  head: (string | number | null)[];
  headCells: ExcelJS.Cell[];
  rows: (string | number | null)[][];
  cells: ExcelJS.Cell[][];
  // The row of the table whose first cell starts with this text.
  row(first: string): ExcelJS.Cell[];
};

export function readPage(ws: ExcelJS.Worksheet) {
  // Every row as the cells that say or show something (a merged cell once), left to right.
  const lines = new Map<number, ExcelJS.Cell[]>();
  ws.eachRow({ includeEmpty: false }, (row, number) => {
    const cells: ExcelJS.Cell[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      if (cell.value !== null && cell.value !== undefined) cells.push(cell);
    });
    if (cells.length) lines.set(number, cells);
  });
  const numbers = [...lines.keys()].sort((a, b) => a - b);
  const last = ws.rowCount;

  const titles = numbers
    .filter((n) => isTitle(lines.get(n)![0]!))
    .map((n) => ({ row: n, text: String(lines.get(n)![0]!.value) }));
  const headings = numbers.flatMap((n) =>
    lines
      .get(n)!
      .filter((cell) => isTitle(cell) || isHeading(cell))
      .map((cell) => ({
        row: n,
        column: Number(cell.col),
        level: isTitle(cell) ? 2 : cell.font!.size === 12 ? 3 : 4,
        text: String(cell.value),
      })),
  );

  // The rows from..to (and, for a block that stands next to another, its columns).
  const part = (from: number, to: number, left = 1, right = Infinity) => {
    const inside = numbers
      .filter((n) => n >= from && n <= to)
      .map((n) => lines.get(n)!.filter((c) => Number(c.col) >= left && Number(c.col) <= right))
      .filter((cells) => cells.length);
    const tables = (): PageTable[] => {
      const found: PageTable[] = [];
      for (let n = from; n <= to; n++) {
        // Header cells that touch are one table's; a gap starts the table next to it.
        const groups: ExcelJS.Cell[][] = [];
        let end = -1;
        const row = ws.getRow(n);
        for (let c = left; c <= Math.min(right, ws.columnCount); c++) {
          const cell = row.getCell(c);
          const master = cell.isMerged ? cell.master : cell;
          if (!isHead(master)) continue;
          if (c !== end + 1 || !groups.length) groups.push([]);
          if (!groups.at(-1)!.includes(master)) groups.at(-1)!.push(master);
          end = c;
        }
        for (const group of groups) {
          if (group.length < 2) continue;
          const first = Number(group[0]!.col);
          const lastColumn = Math.max(
            ...group.map((cell) => {
              let c = Number(cell.col);
              while (row.getCell(c + 1).master?.address === cell.address) c++;
              return c;
            }),
          );
          const lined = (r: number) => {
            const lead = ws.getRow(r).getCell(first);
            return (lead.isMerged ? lead.master : lead).border?.bottom?.color?.argb === RECORD_LINE;
          };
          const cells: ExcelJS.Cell[][] = [];
          // The records: the rows with the table's line under them. A record whose bar stands
          // under it has the line under the bar's thin row.
          for (let r = n + 1; r <= to; r++) {
            const record = (lines.get(r) ?? []).filter(
              (c) => Number(c.col) >= first && Number(c.col) <= lastColumn,
            );
            if (!record.length) {
              if (lined(r)) continue;
              break;
            }
            if (record.some(isHead) || (!lined(r) && !lined(r + 1))) break;
            cells.push(record);
          }
          found.push({
            head: group.map(said).filter((value) => value !== null),
            headCells: group.filter((cell) => said(cell) !== null),
            cells,
            rows: cells.map((record) => record.map(said)),
            row(text: string) {
              const record = cells.find((r) => String(said(r[0]!)).startsWith(text));
              if (!record) throw new Error(`No row «${text}» in the table`);
              return record;
            },
          });
        }
      }
      return found;
    };
    return {
      from,
      to,
      cells: inside,
      rows: inside.map((cells) => cells.map(said)),
      texts: inside.flatMap((cells) => cells.map((cell) => String(said(cell)))),
      links: inside.flatMap((cells) => cells.flatMap((cell) => linkOf(cell) ?? [])),
      tables,
      // The cell that says exactly this, and the cells of its row from it on.
      find(text: string) {
        for (const cells of inside) {
          const at = cells.findIndex((cell) => said(cell) === text);
          if (at >= 0) return cells.slice(at);
        }
        throw new Error(`No «${text}» in the block`);
      },
      // A number with its label (a tile, a number of a block): the cell under the label, and
      // the note under the number.
      stat(label: string) {
        for (const cells of inside) {
          const cell = cells.find((c) => said(c) === label);
          if (!cell) continue;
          const at = Number(cell.col);
          const row = Number(cell.row);
          const value = ws.getRow(row + 1).getCell(at);
          // A tile has its bar between the number and the note.
          const note = [2, 3]
            .map((n) => said(ws.getRow(row + n).getCell(at)))
            .find((text) => typeof text === "string");
          return { cell: value, value: said(value), note: note ?? null };
        }
        throw new Error(`No number «${label}» in the block`);
      },
    };
  };

  return {
    ws,
    ...part(1, last),
    // The blocks' titles, top to bottom.
    titles: titles.map((title) => title.text),
    headings: headings.map((h) => ({ level: h.level, text: h.text })),
    // A block by its title (the text, or its beginning): up to the next block.
    block(title: string) {
      const at = titles.findIndex((x) => x.text === title || x.text.startsWith(title));
      if (at < 0) throw new Error(`No block «${title}» on the page: ${titles.map((x) => x.text)}`);
      return part(titles[at]!.row, (titles[at + 1]?.row ?? last + 1) - 1);
    },
    // A part of a block by its heading: up to the next heading of its level or above (a part
    // next to another keeps to its half of the page).
    sub(title: string) {
      const at = headings.findIndex((h) => h.text === title || h.text.startsWith(title));
      if (at < 0)
        throw new Error(`No heading «${title}» on the page: ${headings.map((h) => h.text)}`);
      const own = headings[at]!;
      const next = headings.find(
        (h, i) =>
          i > at &&
          h.row > own.row &&
          h.level <= own.level &&
          (h.level === 2 || h.column === own.column || own.column === 1),
      );
      // Next to another part: the columns up to (or from) the middle of the page.
      const beside = headings.find(
        (h) => h.row === own.row && h.column !== own.column && h.level === own.level,
      );
      const [left, right] = !beside
        ? [1, Infinity]
        : own.column < beside.column
          ? [1, beside.column - 1]
          : [own.column, Infinity];
      return part(own.row, (next?.row ?? last + 1) - 1, left, right);
    },
  };
}

export type ConnectPage = ReturnType<typeof readPage>;

// The sheets of a workbook as a reader finds them: the page first, then the lists, each opened
// by a link of the page and with its link back.
export function readBook(book: ExcelJS.Workbook) {
  const page = readPage(book.worksheets[0]!);
  const lists = book.worksheets.slice(1);
  return {
    page,
    names: book.worksheets.map((ws) => ws.name),
    // The lists nothing on the page opens.
    orphans: lists
      .map((ws) => ws.name)
      .filter((name) => !page.links.some((link) => link.sheet === name)),
    // Where a list's link back goes: the page's row, and what stands there.
    back(name: string) {
      const ws = book.getWorksheet(name)!;
      let link: ReturnType<typeof linkOf> = null;
      ws.getRow(1).eachCell((cell) => (link = linkOf(cell) ?? link));
      const found = link as ReturnType<typeof linkOf>;
      if (!found) return null;
      const target = book.getWorksheet(found.sheet)?.getRow(found.row).getCell(1);
      return { ...found, at: target ? said(target) : null };
    },
    // A list's records without its header and its link back.
    rows(name: string) {
      const out: unknown[][] = [];
      book.getWorksheet(name)!.eachRow((row, n) => {
        if (n > 1) out.push((row.values as unknown[]).slice(1));
      });
      return out;
    },
  };
}

// The hints of the first sheet's links (what each list is), as they are written in the file:
// ExcelJS does not give a link's hint back when it reads a workbook.
export async function linkHints(file: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  return [...xml.matchAll(/<hyperlink [^>]*tooltip="([^"]*)"/g)].map((match) =>
    match[1]!
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}
