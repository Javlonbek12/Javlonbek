import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { openLightXlsx, type LightCell } from "./light-xlsx";

// Workbooks put together by hand, the way Smart Up writes its big reports: inline strings, empty
// cells left out, sizes after each file's data. Synthetic data only: stores 9000xx, «Тест …»
// names, SKU-TEST products.

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// `sheets`: [name, the XML inside <worksheet>] in the workbook's order; sheet N of the list is
// stored as sheet<count - N>.xml, so the order of the files is not the workbook's.
const xlsx = (
  sheets: [string, string][],
  options: { strings?: string; compression?: "DEFLATE" | "STORE" } = {},
) => {
  const zip = new JSZip();
  const file = (i: number) => `worksheets/sheet${sheets.length - i}.xml`;
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS} xmlns:r="${REL}"><sheets>${sheets
      .map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="${file(i)}" Type="${REL}/worksheet"/>`)
      .join(
        "",
      )}<Relationship Id="rId90" Target="styles.xml" Type="${REL}/styles"/><Relationship Id="rId91" Target="sharedStrings.xml" Type="${REL}/sharedStrings"/></Relationships>`,
  );
  if (options.strings !== undefined)
    zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS}>${options.strings}</sst>`);
  sheets.forEach(([, body], i) =>
    zip.file(`xl/${file(i)}`, `<?xml version="1.0"?><worksheet ${NS}>${body}</worksheet>`),
  );
  // streamFiles: the sizes go after the data (a «data descriptor»), as in Smart Up's files.
  return zip.generateAsync({
    type: "nodebuffer",
    compression: options.compression ?? "DEFLATE",
    streamFiles: true,
  });
};

const inline = (address: string, text: string) =>
  `<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;

const read = async (buffer: Buffer, sheet = 0) => {
  const rows: [number, LightCell[]][] = [];
  const merges = await (
    await openLightXlsx(buffer)
  )[sheet]!.rows((cells, row) => {
    rows.push([row, cells]);
  });
  return { rows, merges };
};

// Filter lines over a header from the shared strings (one of them rich text with a phonetic
// reading), then rows with what a data sheet may have.
const STRINGS = [
  "<si><t>Клиент</t></si>",
  '<si><r><rPr><b/></rPr><t xml:space="preserve">ИД </t></r><r><t>клиента</t></r><rPh sb="0" eb="1"><t>ЧТЕНИЕ</t></rPh></si>',
  "<si><t>Количество продажи</t></si>",
].join("");
const SHEET = [
  "<sheetData>",
  // Rows 1–2: a filter line merged over four cells — its text is in the first one only.
  `<row r="1">${inline("A1", "Дата доставки:  01.11.2026-05.11.2026")}<c r="E1"></c></row>`,
  `<row r="2">${inline("A2", "Организация: Тест &amp; организация")}<c r="E2"/></row>`,
  // Row 3 is not in the file. Row 4, the header: no cell in column C.
  '<row r="4"><c r="A4" t="s"><v>0</v></c><c r="B4" t="s"><v>1</v></c><c r="D4" t="s"><v>2</v></c></row>',
  // A number, a cell without an address (it follows B5) and a number that says it is one.
  `<row r="5">${inline("A5", "Тест точка 900001")}<c r="B5"><v>900001</v></c><c t="b"><v>1</v></c><c r="D5" t="n"><v>2.5</v></c></row>`,
  // A row without a number: the next one. A formula's text, an error, rich text inline.
  '<row><c r="A6" t="str"><f>A5</f><v>Тест_x000A_формула</v></c><c r="C6" t="e"><v>#N/A</v></c>',
  '<c r="E6" t="inlineStr"><is><r><t>SKU-</t></r><r><t xml:space="preserve">TEST 1</t></r></is></c></row>',
  `<row r="7">${inline("A7", "ИТОГО")}<c r="D7"><v>2.5</v></c></row>`,
  "</sheetData>",
  '<mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells>',
].join("\n");
const ROWS: [number, LightCell[]][] = [
  [1, ["Дата доставки:  01.11.2026-05.11.2026", null, null, null, null]],
  [2, ["Организация: Тест & организация", null, null, null, null]],
  [4, ["Клиент", "ИД клиента", null, "Количество продажи"]],
  [5, ["Тест точка 900001", 900001, true, 2.5]],
  [6, ["Тест\nформула", null, null, null, "SKU-TEST 1"]],
  [7, ["ИТОГО", null, null, 2.5]],
];

describe("The light .xlsx reader", () => {
  it("reads shared and inline strings, numbers and skipped cells, row by row", async () => {
    const { rows, merges } = await read(await xlsx([["Тест", SHEET]], { strings: STRINGS }));
    expect(rows).toEqual(ROWS);
    expect(merges).toEqual(["A1:D1", "A2:D2"]);
  });

  it("reads files stored without compression the same way", async () => {
    const buffer = await xlsx([["Тест", SHEET]], { strings: STRINGS, compression: "STORE" });
    expect((await read(buffer)).rows).toEqual(ROWS);
  });

  it("lists the sheets in the workbook's order and needs no shared strings", async () => {
    const body = (text: string) => `<sheetData><row r="1">${inline("A1", text)}</row></sheetData>`;
    const buffer = await xlsx([
      ["Первый", body("Тест 1")],
      ["Второй", body("Тест 2")],
    ]);
    expect((await openLightXlsx(buffer)).map((s) => s.name)).toEqual(["Первый", "Второй"]);
    expect((await read(buffer, 0)).rows).toEqual([[1, ["Тест 1"]]]);
    expect((await read(buffer, 1)).rows).toEqual([[1, ["Тест 2"]]]);
  });

  it("stops when the row handler says so", async () => {
    const [sheet] = await openLightXlsx(await xlsx([["Тест", SHEET]], { strings: STRINGS }));
    const seen: number[] = [];
    const merges = await sheet!.rows((_, row) => {
      seen.push(row);
      if (row === 4) return false;
    });
    expect(seen).toEqual([1, 2, 4]);
    // The merged ranges come after the rows: not reached.
    expect(merges).toEqual([]);
    // The sheet can be read again, from its start.
    expect((await read(await xlsx([["Тест", SHEET]], { strings: STRINGS }))).rows).toEqual(ROWS);
  });

  it("keeps the text whole where a piece of the stream ends inside a character", async () => {
    // Far more than one piece of 64 KB, every character of two bytes.
    const count = 4000;
    const name = (i: number) => `Тестовая точка номер ${900000 + i} — «проверка»`;
    const body = `<sheetData>${Array.from(
      { length: count },
      (_, i) =>
        `<row r="${i + 1}">${inline(`A${i + 1}`, name(i))}<c r="C${i + 1}"><v>${i}</v></c></row>`,
    ).join("")}</sheetData>`;
    const { rows } = await read(await xlsx([["Тест", body]]));
    expect(rows).toHaveLength(count);
    expect(rows.every(([row, cells], i) => row === i + 1 && cells[0] === name(i))).toBe(true);
    expect(rows.at(-1)![1]).toEqual([name(count - 1), null, count - 1]);
  });

  it("throws on what is not an .xlsx", async () => {
    await expect(openLightXlsx(Buffer.from("not a workbook, just some text"))).rejects.toThrow();
    const zip = new JSZip();
    zip.file("readme.txt", "Тест");
    await expect(openLightXlsx(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow();
    // Broken XML in a sheet.
    const [broken] = await openLightXlsx(await xlsx([["Тест", "<sheetData><row></sheetData>"]]));
    await expect(broken!.rows(() => {})).rejects.toThrow();
    // A cell beyond the last column a sheet can have.
    const [wide] = await openLightXlsx(
      await xlsx([["Тест", '<sheetData><row r="1"><c r="ZZZZZZ1"><v>1</v></c></row></sheetData>']]),
    );
    await expect(wide!.rows(() => {})).rejects.toThrow("broken cell address");
  });
});
