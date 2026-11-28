import { StringDecoder } from "node:string_decoder";
import { createInflateRaw } from "node:zlib";

import { SaxesParser } from "saxes";

// A light reader of .xlsx sheets, for an export too big for exceljs: exceljs builds every cell of
// the workbook in memory (Smart Up's sales report of three months — 21 MB, 388 000 rows — took
// about 3 GB and half a minute). Here the zip is opened by its central directory and a sheet's
// XML is inflated and parsed as a stream: a row is handed over as soon as it is read and nothing
// else is kept. It reads values only (shared and inline strings, numbers, booleans) — no styles,
// so a date stored as a number with a date format comes out as that number, and a merged cell
// has its value in its first cell only. The caller falls back to exceljs where that matters.

export type LightCell = string | number | boolean | Date | null;

// Called for every row that has cells, with the row's number (from 1); the cells are placed by
// their column (index 0 is column A), null where the row has none. Returning false stops reading.
export type RowHandler = (cells: LightCell[], row: number) => void | false;

export type LightSheet = {
  name: string;
  // Resolves with the sheet's merged ranges («A1:D1»). The file lists them after its rows, so
  // they are known only when the sheet was read to the end (empty when the handler stopped it).
  rows: (onRow: RowHandler) => Promise<string[]>;
};

export type ZipEntry = { method: number; start: number; size: number };
type Entry = ZipEntry;

// The inflated XML comes in pieces of this size (a sheet may be hundreds of MB as text; bigger
// pieces are not faster, only more memory).
const PIECE = 64 * 1024;

// The files of a zip by name, from its central directory (the list at the end of the archive).
// The sizes are taken from there: Smart Up writes them after each file's data, not in the header
// before it, which is why readers going through the archive from its start fail on its exports.
export function zipEntries(zip: Buffer): Map<string, Entry> {
  // The end record is the last thing in the file, but for an optional comment after it (of up
  // to 65 535 bytes).
  let end = zip.length - 22;
  const first = Math.max(0, end - 0xffff);
  while (end >= first && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < first) throw new Error("light-xlsx: not a zip");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("light-xlsx: broken zip directory");
    const encrypted = zip.readUInt16LE(at + 8) & 1;
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const header = zip.readUInt32LE(at + 42);
    // ZIP64 (4 GB and more) keeps its sizes elsewhere: not a file anyone uploads here.
    if (encrypted || size === 0xffffffff || header === 0xffffffff)
      throw new Error("light-xlsx: unsupported zip");
    entries.set(zip.toString("utf8", at + 46, at + 46 + nameLength), {
      method: zip.readUInt16LE(at + 10),
      // The data follows the file's own header, its name and its extra field.
      start: header + 30 + zip.readUInt16LE(header + 26) + zip.readUInt16LE(header + 28),
      size,
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

// The text of a file in the zip, piece by piece: never the whole of it in memory.
export async function* textOf(zip: Buffer, entry: Entry): AsyncGenerator<string> {
  const data = zip.subarray(entry.start, entry.start + entry.size);
  // 0: stored as is; 8: deflate. An .xlsx has nothing else.
  if (entry.method === 0) {
    yield data.toString("utf8");
    return;
  }
  if (entry.method !== 8) throw new Error("light-xlsx: unsupported zip method");
  const inflate = createInflateRaw({ chunkSize: PIECE });
  inflate.end(data);
  // A character of several bytes may be cut in two by the edge of a piece.
  const decoder = new StringDecoder("utf8");
  for await (const piece of inflate) yield decoder.write(piece as Buffer);
  yield decoder.end();
}

type Attributes = Record<string, string>;

// Runs XML through the SAX parser. `close` gets the text right inside the element that ends (all
// that the leaves <v> and <t> have); when it returns false the reading stops there. Broken XML
// throws.
async function walk(
  xml: AsyncIterable<string>,
  open: (name: string, attributes: Attributes) => void,
  close: (name: string, text: string) => void | false,
) {
  const parser = new SaxesParser();
  let text = "";
  let stopped = false;
  parser.on("opentag", (tag) => {
    text = "";
    if (!stopped) open(tag.name, tag.attributes);
  });
  parser.on("text", (part) => {
    text += part;
  });
  parser.on("cdata", (part) => {
    text += part;
  });
  parser.on("closetag", (tag) => {
    // The parser finishes the piece it was given: after a stop the rest of it is ignored.
    if (!stopped && close(tag.name, text) === false) stopped = true;
    text = "";
  });
  for await (const piece of xml) {
    parser.write(piece);
    if (stopped) return;
  }
  parser.close();
}

// Excel writes a control character in a string as _x000D_.
export const unescape = (text: string) =>
  text.includes("_x")
    ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
    : text;

// xl/sharedStrings.xml: the strings that cells with t="s" point to by index. A string is one <t>,
// or several <r><t> runs of rich text, joined; the phonetic reading (<rPh>) is not its text.
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
      else if (name === "si") strings.push(unescape(current));
    },
  );
  return strings;
}

// «C7» → 2: the cell's column, from its address.
export function columnOf(address: string) {
  let column = 0;
  for (let i = 0; i < address.length; i++) {
    const code = address.charCodeAt(i);
    if (code < 65 || code > 90) break;
    column = column * 26 + code - 64;
  }
  return column - 1;
}

// A cell's value by its type (the `t` attribute; a number when there is none).
function valueOf(type: string, raw: string | null, strings: string[]): LightCell {
  if (raw === null || raw === "") return null;
  switch (type) {
    case "s":
      return strings[Number(raw)] ?? null;
    // An inline string, and the text a formula gave.
    case "inlineStr":
    case "str":
      return unescape(raw);
    case "b":
      return raw === "1";
    // An error (#N/A) is no value.
    case "e":
      return null;
    case "d":
      return new Date(raw);
    default: {
      const number = Number(raw);
      return Number.isFinite(number) ? number : null;
    }
  }
}

async function readRows(xml: AsyncIterable<string>, strings: string[], onRow: RowHandler) {
  const merges: string[] = [];
  let cells: LightCell[] = [];
  let row = 0;
  let column = -1;
  let type = "n";
  let raw: string | null = null;
  let phonetic = false;
  await walk(
    xml,
    (name, attributes) => {
      if (name === "row") {
        // Rows and cells usually say where they are (r="7", r="C7") and empty ones are left
        // out; without an address they follow the one before.
        row = Number(attributes.r) || row + 1;
        cells = [];
        column = -1;
      } else if (name === "c") {
        column = attributes.r ? columnOf(attributes.r) : column + 1;
        // A sheet ends at column XFD: an address beyond it would make a row of billions of cells.
        if (column >= 16384) throw new Error("light-xlsx: broken cell address");
        type = attributes.t ?? "n";
        raw = null;
      } else if (name === "rPh") phonetic = true;
      else if (name === "mergeCell" && attributes.ref) merges.push(attributes.ref);
    },
    (name, text) => {
      // <v> has the value (or the index of a shared string), <is> an inline string: one <t> or
      // rich-text runs. A formula's own text (<f>) is not read.
      if ((name === "v" || name === "t") && !phonetic) raw = (raw ?? "") + text;
      else if (name === "rPh") phonetic = false;
      else if (name === "c" && column >= 0) cells[column] = valueOf(type, raw, strings);
      else if (name === "row")
        return onRow(
          Array.from(cells, (cell) => cell ?? null),
          row,
        );
    },
  );
  return merges;
}

// The attributes of every element called `name` in a small XML file.
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

// Opens a workbook: its worksheets in the workbook's order, each ready to be read row by row.
// Throws on anything that is not a plain .xlsx — the caller then reads the file with exceljs.
export async function openLightXlsx(zip: Buffer): Promise<LightSheet[]> {
  const entries = zipEntries(zip);
  const text = (path: string) => {
    const entry = entries.get(path);
    if (!entry) throw new Error(`light-xlsx: no ${path}`);
    return textOf(zip, entry);
  };
  // The workbook names its sheets; where each one's XML is, and the shared strings, is in the
  // relationships next to it (paths from xl/, or from the root with a leading slash).
  const targets = new Map<string, string>();
  let stringsPath: string | null = null;
  for (const rel of await elements(text("xl/_rels/workbook.xml.rels"), "Relationship")) {
    if (!rel.Target || !rel.Type) continue;
    const path = rel.Target.startsWith("/") ? rel.Target.slice(1) : `xl/${rel.Target}`;
    if (rel.Type.endsWith("/worksheet") && rel.Id) targets.set(rel.Id, path);
    else if (rel.Type.endsWith("/sharedStrings")) stringsPath = path;
  }
  // A workbook written with inline strings only may have no shared strings at all.
  const strings =
    stringsPath && entries.has(stringsPath) ? await sharedStrings(text(stringsPath)) : [];
  const sheets: LightSheet[] = [];
  for (const sheet of await elements(text("xl/workbook.xml"), "sheet")) {
    const path = targets.get(sheet["r:id"] ?? "");
    // (A chart sheet is in the list too, but is not a worksheet.)
    if (path) {
      sheets.push({
        name: sheet.name ?? "",
        rows: (onRow) => readRows(text(path), strings, onRow),
      });
    }
  }
  return sheets;
}
