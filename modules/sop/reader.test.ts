// @vitest-environment node
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { classifyFormula, openSopWorkbook, SopReadError } from "./reader";

// A workbook written by hand, to have exactly the XML a real file has (shared formulas, strings
// with line breaks, cells without addresses).
async function rawWorkbook(
  sheets: Record<string, string>,
  strings: string[] | null = [],
): Promise<Buffer> {
  const zip = new JSZip();
  const names = Object.keys(sheets);
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}${
      strings
        ? `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
        : ""
    }</Relationships>`,
  );
  if (strings)
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
        .map((s) => `<si><t xml:space="preserve">${s}</t></si>`)
        .join("")}</sst>`,
    );
  names.forEach((name, i) =>
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      sheets[name]!.startsWith("<?xml")
        ? sheets[name]!
        : `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheets[name]}</sheetData></worksheet>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("classifyFormula", () => {
  it("tells a plain sum of numbers and keeps its addends", () => {
    expect(classifyFormula("4010+596.36")).toEqual({ f: "sum", parts: [4010, 596.36] });
    expect(classifyFormula("=100+20+3")).toEqual({ f: "sum", parts: [100, 20, 3] });
    expect(classifyFormula(" 200 - 50.5 ")).toEqual({ f: "sum", parts: [200, -50.5] });
  });

  it("does not take a single number, a reference or a function for a sum", () => {
    expect(classifyFormula("4010").f).toBe("other");
    expect(classifyFormula("A1+B1").f).toBe("other");
    expect(classifyFormula("SUM(1,2)").f).toBe("other");
    expect(classifyFormula("100+A2").f).toBe("other");
  });

  it("tells a lookup into another sheet", () => {
    expect(classifyFormula("VLOOKUP($A8,'Other'!$A$8:$Z$99,5,FALSE)").f).toBe("lookup");
    expect(classifyFormula("IFERROR(INDEX(X:X,MATCH(A1,Y:Y,0)),0)").f).toBe("lookup");
    expect(classifyFormula("MQ8+NM8-NN8").f).toBe("other");
  });
});

describe("openSopWorkbook", () => {
  it("reads values and how each cell was filled from a workbook Excel-style", async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet("Тест");
    ws.getCell("A1").value = "Заголовок";
    ws.getCell("B2").value = 12.5;
    ws.getCell("C2").value = { formula: "100+20.5", result: 120.5 };
    ws.getCell("D2").value = { formula: "VLOOKUP(A2,'X'!A:B,2,FALSE)", result: 7 };
    ws.getCell("E2").value = { formula: "B2*2", result: 25 };
    ws.getCell("F2").value = { formula: 'IF(B2>0,"да","нет")', result: "да" };
    book.addWorksheet("Вторая").getCell("A1").value = 1;
    const sheets = await openSopWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(sheets.map((s) => s.name)).toEqual(["Тест", "Вторая"]);
    const grid = await sheets[0]!.read();
    expect(grid.rows.get(1)!.get(0)).toEqual({ v: "Заголовок", f: "none" });
    expect(grid.rows.get(2)!.get(1)).toEqual({ v: 12.5, f: "none" });
    expect(grid.rows.get(2)!.get(2)).toEqual({ v: 120.5, f: "sum", parts: [100, 20.5] });
    expect(grid.rows.get(2)!.get(3)).toEqual({ v: 7, f: "lookup" });
    expect(grid.rows.get(2)!.get(4)).toEqual({ v: 25, f: "other" });
    expect(grid.rows.get(2)!.get(5)).toEqual({ v: "да", f: "other" });
    expect(grid.maxRow).toBe(2);
    expect(grid.maxColumn).toBe(5);
  });

  it("counts the cells that repeat a shared formula as formulas of the master's kind", async () => {
    const file = await rawWorkbook({
      S: [
        `<row r="1"><c r="A1"><f t="shared" ref="A1:A3" si="0">B1+C1</f><v>3</v></c><c r="D1"><f t="shared" ref="D1:D2" si="1">VLOOKUP(A1,X!A:B,2,0)</f><v>9</v></c></row>`,
        `<row r="2"><c r="A2"><f t="shared" si="0"/><v>5</v></c><c r="D2"><f t="shared" si="1"/><v>8</v></c></row>`,
        `<row r="3"><c r="A3"><f t="shared" si="0"/></c><c r="B3"><v>4</v></c></row>`,
      ].join(""),
    });
    const grid = await (await openSopWorkbook(file))[0]!.read();
    expect(grid.rows.get(2)!.get(0)).toEqual({ v: 5, f: "other" });
    expect(grid.rows.get(2)!.get(3)).toEqual({ v: 8, f: "lookup" });
    // A formula without a cached value is still a formula, not an empty cell.
    expect(grid.rows.get(3)!.get(0)).toEqual({ v: null, f: "other" });
    expect(grid.rows.get(3)!.get(1)).toEqual({ v: 4, f: "none" });
  });

  it("reads shared strings with line breaks, inline strings, booleans and skips errors", async () => {
    const file = await rawWorkbook(
      {
        S: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>в строке</t></is></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#N/A</v></c><c r="E1" t="str"><f>A1</f><v>текст</v></c></row><row><c><v>2</v></c><c><v>3</v></c></row>`,
      },
      ["Nov'26_x000D_\nProduction_x000D_\nOrder"],
    );
    const grid = await (await openSopWorkbook(file))[0]!.read();
    expect(grid.rows.get(1)!.get(0)!.v).toBe("Nov'26\r\nProduction\r\nOrder");
    expect(grid.rows.get(1)!.get(1)!.v).toBe("в строке");
    expect(grid.rows.get(1)!.get(2)!.v).toBe(true);
    expect(grid.rows.get(1)!.has(3)).toBe(false);
    expect(grid.rows.get(1)!.get(4)).toEqual({ v: "текст", f: "other" });
    // A row and cells without addresses follow the ones before.
    expect(grid.rows.get(2)!.get(1)!.v).toBe(3);
  });

  it("works without a shared-strings part", async () => {
    const file = await rawWorkbook({ S: `<row r="1"><c r="A1"><v>1</v></c></row>` }, null);
    const grid = await (await openSopWorkbook(file))[0]!.read();
    expect(grid.rows.get(1)!.get(0)!.v).toBe(1);
  });

  it("stops at the asked row and never opens the sheets it was not asked for", async () => {
    const rows = Array.from(
      { length: 50 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join("");
    const file = await rawWorkbook({ Good: rows, Broken: `<?xml version="1.0"?><worksheet><oops` });
    const [good, broken] = await openSopWorkbook(file);
    expect((await good!.read({ maxRow: 5 })).maxRow).toBe(5);
    expect((await good!.read()).maxRow).toBe(50);
    // The broken sheet is only a problem for whoever reads it.
    await expect(broken!.read()).rejects.toMatchObject({ code: "notXlsx" });
  });

  it("refuses what is not a workbook", async () => {
    await expect(openSopWorkbook(Buffer.from("just some text"))).rejects.toBeInstanceOf(
      SopReadError,
    );
    await expect(openSopWorkbook(Buffer.alloc(0))).rejects.toMatchObject({ code: "notXlsx" });
    const zip = new JSZip();
    zip.file("readme.txt", "not a workbook");
    await expect(
      openSopWorkbook(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toMatchObject({ code: "notXlsx" });
  });

  it("refuses a sheet with a cell address outside a sheet", async () => {
    const file = await rawWorkbook({ S: `<row r="1"><c r="ZZZZ1"><v>1</v></c></row>` });
    await expect((await openSopWorkbook(file))[0]!.read()).rejects.toMatchObject({
      code: "notXlsx",
    });
  });

  it("refuses a sheet with more rows than a sheet of this kind can have", async () => {
    const file = await rawWorkbook({ S: `<row r="900000"><c r="A900000"><v>1</v></c></row>` });
    await expect((await openSopWorkbook(file))[0]!.read()).rejects.toMatchObject({
      code: "tooBig",
    });
  });
});
