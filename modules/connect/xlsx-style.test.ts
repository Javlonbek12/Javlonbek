import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  addCoverSheet,
  addStyledSheet,
  fillCoverSheet,
  numberFormat,
  sheetName,
  textLines,
  type Cover,
  type SheetColumn,
  type SheetRow,
} from "./xlsx-style";

// The style layer of the Connect download, on made-up rows: what a reader of the file sees (the
// header, the formats, the colours, the tab) and that the values stay what they were.

// Written and read back, as Excel would open it.
async function reopen(book: ExcelJS.Workbook) {
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load((await book.xlsx.writeBuffer()) as ArrayBuffer);
  return copy;
}
const fillOf = (cell: ExcelJS.Cell) =>
  cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined;
const inkOf = (cell: ExcelJS.Cell) => cell.font?.color?.argb;

const RED = "FFFED5D7";
const AMBER = "FFFFEEBF";
const GREEN = "FFD9F5EB";

const columns: SheetColumn[] = [
  { header: "Зона", width: 20, format: "text" },
  { header: "Визитов", width: 10, format: "count" },
  {
    header: "Посещаемость, %",
    width: 10,
    format: "percent",
    tone: (value) =>
      typeof value !== "number" ? null : value >= 95 ? "good" : value >= 80 ? "warn" : "bad",
  },
  {
    header: "Изменение, п.п.",
    width: 14,
    format: "change",
    unit: "п.п.",
    tone: (value) => (typeof value !== "number" || !value ? null : value > 0 ? "good" : "bad"),
    paint: "text",
  },
  { header: "Продано", width: 16, format: "money" },
  { header: "Статус", width: 20, format: "text", color: (value) => (value ? "#1f9d55" : null) },
];
const rows: SheetRow[] = [
  ["TSM_TST_1", 1200, 41.4, -2.5, 1500000, "Тест доставлено"],
  ["TSM_TST_2", 30, 95, 1.4, 20000, null],
  ["TSM_TST_3", 12.5, 88.8, 0, 0, null],
];

describe("the Connect download's style layer", () => {
  it("writes numbers as the page shows them, keeping their values", () => {
    expect(numberFormat("count")).toBe("#,##0");
    expect(numberFormat("money")).toBe("#,##0");
    // The value is already in percent: only the sign is written after it.
    expect(numberFormat("percent")).toBe('0.0"%"');
    // A change: ▲ for growth, ▼ for a fall (the minus is the arrow), neither for no change.
    expect(numberFormat("change")).toBe('"▲ "0.0"%";"▼ "0.0"%";0.0"%"');
    expect(numberFormat("change", "п.п.")).toBe('"▲ "0.0" п.п.";"▼ "0.0" п.п.";0.0" п.п."');
    expect(numberFormat("text")).toBeUndefined();
    expect(numberFormat("date")).toBeUndefined();
  });

  it("counts the lines of a wrapped text and cleans a sheet's name", () => {
    expect(textLines("Точек", 12)).toBe(1);
    expect(textLines("Проверок с OOS (Connect-бот)", 16)).toBe(2);
    expect(textLines("первая\nвторая", 40)).toBe(2);
    // A word longer than the cell breaks inside it.
    expect(textLines("Посещаемость", 6, 1)).toBe(3);
    expect(sheetName("Оплаты: ISM [ноябрь] / 2026?")).toBe("Оплаты ISM ноябрь 2026");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
  });

  it("makes a table: the header, the frozen row, the filter, the formats and the tones", async () => {
    const book = new ExcelJS.Workbook();
    addStyledSheet(book, "Маршруты", columns, rows, {
      source: "smartup",
      about: "Тест",
      rowTone: (row) => (row[0] === "TSM_TST_1" ? "bad" : row[0] === "TSM_TST_2" ? "good" : "warn"),
    });
    const ws = (await reopen(book)).getWorksheet("Маршруты")!;

    // The values are what was given: a table to filter, sort and pivot.
    expect(
      ws
        .getSheetValues()
        .filter(Boolean)
        .map((row) => (row as ExcelJS.CellValue[]).slice(1)),
    ).toEqual([
      ["Зона", "Визитов", "Посещаемость, %", "Изменение, п.п.", "Продано", "Статус"],
      ["TSM_TST_1", 1200, 41.4, -2.5, 1500000, "Тест доставлено"],
      ["TSM_TST_2", 30, 95, 1.4, 20000],
      ["TSM_TST_3", 12.5, 88.8, 0, 0],
    ]);

    // The header: bold on a soft fill with a line under it, wrapped, in the middle; numbers right.
    const head = ws.getRow(1);
    expect(head.getCell(1).font).toMatchObject({ bold: true });
    expect(fillOf(head.getCell(1))).toBe("FFF0F3F7");
    expect(head.getCell(1).border?.bottom?.style).toBe("thin");
    expect(head.getCell(1).alignment).toMatchObject({
      horizontal: "left",
      vertical: "middle",
      wrapText: true,
    });
    expect(head.getCell(2).alignment).toMatchObject({ horizontal: "right", wrapText: true });
    // Two lines of «Посещаемость, %»; the column is as wide as its longest word.
    expect(head.height).toBeGreaterThan(30);
    expect(ws.getColumn(3).width).toBeGreaterThanOrEqual(16);
    expect(ws.getColumn(1).width).toBe(20);

    // The header stays in place, the table can be filtered, the grid is the cells' own lines.
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1, xSplit: 0 });
    expect(ws.views[0]!.showGridLines).toBe(false);
    expect(ws.autoFilter).toBe("A1:F4");
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1 });
    // Whose data: Smart Up is violet.
    expect(ws.properties.tabColor?.argb).toBe("FF8E51FF");

    // Formats by column; text left, numbers right; a thin line under every row.
    const [bad, good, warn] = [ws.getRow(2), ws.getRow(3), ws.getRow(4)];
    expect(bad.getCell(2).numFmt).toBe("#,##0");
    expect(bad.getCell(3).numFmt).toBe('0.0"%"');
    expect(bad.getCell(4).numFmt).toBe('"▲ "0.0" п.п.";"▼ "0.0" п.п.";0.0" п.п."');
    expect(bad.getCell(5).numFmt).toBe("#,##0");
    expect(bad.getCell(1).alignment?.horizontal).toBe("left");
    expect(bad.getCell(2).alignment?.horizontal).toBe("right");
    expect(bad.getCell(2).border?.bottom).toMatchObject({ style: "thin" });
    // A cell without a value has its line too.
    expect(good.getCell(6).border?.bottom).toMatchObject({ style: "thin" });
    // A text right after a number keeps a little off it.
    expect(bad.getCell(6).alignment).toMatchObject({ horizontal: "left", indent: 1 });

    // A tone is a tinted cell with dark text of the same family…
    expect([fillOf(bad.getCell(3)), inkOf(bad.getCell(3))]).toEqual([RED, "FF82181A"]);
    expect([fillOf(good.getCell(3)), inkOf(good.getCell(3))]).toEqual([GREEN, "FF004F3B"]);
    expect([fillOf(warn.getCell(3)), inkOf(warn.getCell(3))]).toEqual([AMBER, "FF7B3306"]);
    // …or only coloured text, where the page writes it so; no change has no colour.
    expect([fillOf(bad.getCell(4)), inkOf(bad.getCell(4))]).toEqual([undefined, "FFE7000B"]);
    expect([fillOf(good.getCell(4)), inkOf(good.getCell(4))]).toEqual([undefined, "FF007A55"]);
    expect(inkOf(warn.getCell(4))).toBeUndefined();
    // A cell without a tone is plain.
    expect(fillOf(bad.getCell(2))).toBeUndefined();
    // A count that is not whole keeps its decimals on the screen.
    expect(warn.getCell(2).numFmt).toBe("#,##0.0#");
    // A status in its own colour.
    expect(inkOf(bad.getCell(6))).toBe("FF1F9D55");

    // A marked row: its first cell tinted with a coloured left edge; a good row has no mark.
    expect(fillOf(bad.getCell(1))).toBe(RED);
    expect(bad.getCell(1).border?.left).toMatchObject({
      style: "medium",
      color: { argb: "FFFB2C36" },
    });
    expect(fillOf(warn.getCell(1))).toBe(AMBER);
    expect(warn.getCell(1).border?.left?.color?.argb).toBe("FFFFB900");
    expect(fillOf(good.getCell(1))).toBeUndefined();
    expect(good.getCell(1).border?.left).toBeUndefined();
  });

  it("gives a list of numbers each row's own format and tone, and no filter", async () => {
    const book = new ExcelJS.Workbook();
    addStyledSheet(
      book,
      "Визиты",
      [
        { header: "Показатель", width: 50, format: "text" },
        { header: "Значение", width: 18, format: "count" },
      ],
      [
        ["С чем сравнивать", "К предыдущей проверке"],
        { cells: ["По плану", 20863] },
        { cells: ["Посещено, %", 84], format: "percent" },
        { cells: ["Не посещено", 3280], tone: "warn" },
        { cells: ["Сумма, сум", 1500000], format: "money", tone: null },
        [],
        { cells: ["Заказ после OOS", null], kind: "title" },
        { cells: ["Точка", "Сумма"], kind: "header", formats: ["text", "money"] },
        { cells: ["Тест магазин 900001", 400000, 9], formats: ["text", "money", "count"] },
        { cells: ["Всего", 5], bold: true },
        { cells: ["TSM_TST_1", 1], indent: 2 },
      ],
      { source: "both", about: "Тест", list: true },
    );
    addStyledSheet(book, "OOS", [{ header: "Товар", width: 20 }], [["SKU-TEST 1"]], {
      source: "bot",
      about: "Тест",
    });
    // Two blocks with one name (it happens in a translation): the second gets a number.
    const twin = addStyledSheet(book, "oos", [{ header: "Товар", width: 20 }], [], {
      source: "bot",
      about: "Тест",
    });
    expect(twin.name).toBe("oos 2");
    const copy = await reopen(book);
    const ws = copy.getWorksheet("Визиты")!;
    expect(ws.autoFilter).toBeUndefined();
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    // Both sources compared: neither's colour. The bot's own sheet is sky.
    expect(ws.properties.tabColor?.argb).toBe("FF62748E");
    expect(copy.getWorksheet("OOS")!.properties.tabColor?.argb).toBe("FF00A6F4");

    const value = (row: number) => ws.getRow(row).getCell(2);
    expect(value(2).value).toBe("К предыдущей проверке");
    expect(value(3).numFmt).toBe("#,##0");
    expect([value(4).value, value(4).numFmt]).toEqual([84, '0.0"%"']);
    expect([fillOf(value(5)), value(5).numFmt]).toEqual([AMBER, "#,##0"]);
    expect(fillOf(value(6))).toBeUndefined();
    // A heading and a second header inside the sheet.
    expect(ws.getRow(8).getCell(1).font).toMatchObject({ bold: true });
    expect(ws.getRow(8).getCell(1).border?.bottom).toBeUndefined();
    expect(fillOf(ws.getRow(9).getCell(1))).toBe("FFF0F3F7");
    expect(ws.getRow(9).getCell(2).alignment?.horizontal).toBe("right");
    // A row of a table of its own: its own formats, also outside the sheet's columns.
    expect(ws.getRow(10).getCell(3).numFmt).toBe("#,##0");
    expect(ws.getRow(10).getCell(3).alignment?.horizontal).toBe("right");
    expect(ws.getRow(11).getCell(1).font).toMatchObject({ bold: true });
    expect(ws.getRow(12).getCell(1).alignment?.indent).toBe(2);
  });

  it("keeps the first column of a wide table in place and filters up to the first empty row", async () => {
    const book = new ExcelJS.Workbook();
    const many = Array.from({ length: 9 }, (_, i): SheetColumn => ({
      header: `Колонка ${i + 1}`,
      width: 12,
      format: i ? "count" : "text",
      source: i < 5 ? "bot" : "smartup",
    }));
    addStyledSheet(book, "Путь OOS", many, [["a", 1], ["b", 2], [], ["Найден OOS", 3]], {
      source: "both",
      about: "Тест",
    });
    const ws = (await reopen(book)).getWorksheet("Путь OOS")!;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1, xSplit: 1 });
    expect(ws.autoFilter).toBe("A1:I3");
    // Whose data a column is: the line under its header in the source's colour.
    expect(ws.getRow(1).getCell(1).border?.bottom).toMatchObject({
      style: "medium",
      color: { argb: "FF00A6F4" },
    });
    expect(ws.getRow(1).getCell(9).border?.bottom?.color?.argb).toBe("FF8E51FF");
  });

  it("makes the cover: the title, the tiles in their colours, the norms and the links", async () => {
    const cover: Cover = {
      title: "Аналитика Connect — Руководство: 2–8 нояб.",
      tilesHead: ["Показатель", "Значение"],
      tiles: [
        {
          label: "План визитов выполнен, %",
          value: 84,
          format: "percent",
          tone: "bad",
          change: { delta: -2, tone: "bad" },
          note: "17 583 из 20 863 визитов",
        },
        { label: "Заказов", value: 2760, format: "count" },
      ],
      changeUnit: "п.п.",
      caption: "▲ ▼ — изменение к предыдущему периоду.",
      facts: { title: "О файле", rows: [["Период", "2–8 нояб."]] },
      norms: {
        title: "Нормы и цвета",
        hint: "Зелёный — норма выполнена.",
        head: ["Норма", "Значение", "Зелёный", "Жёлтый", "Красный"],
        rows: [
          {
            label: "Посещаемость — цель",
            value: "95%",
            good: "от 95%",
            warn: "от 80,75%, но меньше 95%",
            bad: "меньше 80,75%",
          },
        ],
        more: { title: "Что ещё выделено цветом", rows: [["Продажи по зонам", "Рост — зелёный."]] },
      },
      sheets: {
        title: "Листы",
        hint: "Название листа — ссылка.",
        head: ["Лист", "Что на листе", "Источник данных"],
        rows: [
          {
            name: "Маршруты",
            about: "Маршруты по зонам.",
            source: "smartup",
            sourceLabel: "Smart Up",
          },
          {
            name: "Тест's лист",
            about: "С апострофом.",
            source: "bot",
            sourceLabel: "Connect-бот",
          },
        ],
      },
    };
    const book = new ExcelJS.Workbook();
    fillCoverSheet(addCoverSheet(book, "Сводка"), cover);
    book.addWorksheet("Маршруты");
    book.addWorksheet("Тест's лист");
    const copy = await reopen(book);
    expect(copy.worksheets[0]!.name).toBe("Сводка");
    const ws = copy.worksheets[0]!;
    const texts: string[] = [];
    const links: string[] = [];
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.isMerged && cell.master !== cell) return;
        texts.push(cell.text);
        if (cell.hyperlink) links.push(cell.hyperlink);
      }),
    );
    // A designed page: the title over the whole width, no frozen row and no filter.
    expect(ws.getCell("A1").value).toBe(cover.title);
    expect(ws.getCell("E1").master.address).toBe("A1");
    expect(ws.getCell("A1").font).toMatchObject({ bold: true, size: 16 });
    expect(ws.views[0]?.state).not.toBe("frozen");
    expect(ws.autoFilter).toBeUndefined();
    // The tiles: the number in its colour, the change with its arrow, the note.
    expect([ws.getCell("A2").value, ws.getCell("B2").value]).toEqual(["Показатель", "Значение"]);
    expect([ws.getCell("A3").value, ws.getCell("B3").value]).toEqual([
      "План визитов выполнен, %",
      84,
    ]);
    expect([fillOf(ws.getCell("B3")), ws.getCell("B3").numFmt]).toEqual([RED, '0.0"%"']);
    expect(ws.getCell("C3").value).toBe(-2);
    expect(ws.getCell("C3").numFmt).toContain('"▼ "0.0" п.п."');
    expect(inkOf(ws.getCell("C3"))).toBe("FFE7000B");
    expect(ws.getCell("D3").value).toBe("17 583 из 20 863 визитов");
    expect(fillOf(ws.getCell("B4"))).toBeUndefined();
    // Everything said is there.
    expect(texts).toEqual(
      expect.arrayContaining([
        "▲ ▼ — изменение к предыдущему периоду.",
        "О файле",
        "2–8 нояб.",
        "Нормы и цвета",
        "Посещаемость — цель",
        "95%",
        "Что ещё выделено цветом",
        "Рост — зелёный.",
        "Листы",
        "Маршруты по зонам.",
        "Smart Up",
      ]),
    );
    // The legend is in the colours it explains.
    const band = (text: string) => {
      let found: ExcelJS.Cell | undefined;
      ws.eachRow((row) => row.eachCell((cell) => (cell.value === text ? (found = cell) : null)));
      return fillOf(found!);
    };
    expect([band("от 95%"), band("от 80,75%, но меньше 95%"), band("меньше 80,75%")]).toEqual([
      GREEN,
      AMBER,
      RED,
    ]);
    expect([band("Smart Up"), band("Connect-бот")]).toEqual(["FFF4EEFF", "FFE6F6FE"]);
    // A sheet's name opens it (an apostrophe in a name is doubled).
    expect(links).toEqual(["#'Маршруты'!A1", "#'Тест''s лист'!A1"]);
  });
});
