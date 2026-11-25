import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { fillOf, inkOf, linkHints, readBook, readPage, said } from "@/tests/helpers/connect-page";

import type { Tone } from "./tone";
import { GRID, Page, type TableDef } from "./xlsx-page";
import { addStyledSheet } from "./xlsx-style";

// The first sheet of the Connect download — the page on a grid of narrow columns — on made-up
// rows: what a reader sees (the blocks, the tiles, the tables with their colours, the bars as
// filled cells, the links) and that the numbers stay numbers.

const RED = "FFFED5D7";
const AMBER = "FFFFEEBF";
const GREEN = "FFD9F5EB";

function make(name = "Руководство") {
  const book = new ExcelJS.Workbook();
  const page = new Page(book, name, (...sheet) => addStyledSheet(book, ...sheet));
  return { book, page };
}
// Written and read back, as Excel would open it.
async function reopen(book: ExcelJS.Workbook) {
  const file = Buffer.from(await book.xlsx.writeBuffer());
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(file as unknown as ArrayBuffer);
  return { file, copy, ...readBook(copy) };
}

type Zone = { zone: string; person: string; visits: number; share: number; delta: number | null };
const zones: Zone[] = [
  { zone: "TSM_TST_1", person: "Тест Первый", visits: 1200, share: 41.4, delta: -2.5 },
  { zone: "TSM_TST_2", person: "Тест Второй", visits: 30, share: 95, delta: 1.4 },
  { zone: "TSM_TST_3", person: "Тест Третий", visits: 12, share: 88.8, delta: null },
];
const tone = (share: number): Tone => (share >= 95 ? "good" : share >= 80 ? "warn" : "bad");
const table = (rows = zones, always = false): TableDef<Zone> => ({
  rows,
  rowTone: (z) => (tone(z.share) === "good" ? null : tone(z.share)),
  full: { name: "Маршруты", source: "smartup", about: "Маршруты по зонам.", always },
  columns: [
    {
      header: "Зона",
      width: 20,
      value: (z) => z.zone,
      page: { w: 10, flex: true, sub: (z) => z.person },
    },
    { header: "Сотрудник", width: 30, value: (z) => z.person },
    { header: "Визитов", width: 10, format: "count", value: (z) => z.visits, page: { w: 4 } },
    {
      header: "Посещаемость, %",
      width: 10,
      format: "percent",
      value: (z) => z.share,
      tone: (z) => tone(z.share),
      page: { w: 4, header: "Посещаемость" },
    },
    {
      header: "Изменение, п.п.",
      width: 14,
      format: "change",
      unit: "п.п.",
      value: (z) => z.delta,
      tone: (z) => (z.delta === null || !z.delta ? null : z.delta > 0 ? "good" : "bad"),
      paint: "text",
      page: { w: 4, join: true, blank: true },
    },
  ],
});

describe("the first sheet of the Connect download: the page on a grid", () => {
  it("writes a block: its title, whose data it is, the hint, and a link to it at the top", async () => {
    const { book, page } = make();
    page.title("Аналитика Connect — Руководство: 2–8 нояб.");
    page.facts([["Период", "2–8 нояб."]]);
    page.chips();
    page.section("Требует внимания · 3", {
      sources: ["smartup", "bot"],
      hint: "Сотрудники, у которых показатели ниже нормы.",
      nav: "Требует внимания",
    });
    page.text("Таких сотрудников нет.", "good");
    page.section("Маршруты и дисциплина", { sources: ["smartup"] });
    page.section("Календарь", { nav: false });
    page.section("Market Visit", { sources: ["bot"] });
    page.section("Нормы и цвета", { own: true });
    page.finish();
    const file = await reopen(book);
    const ws = file.page.ws;

    // A designed page: the title over the whole grid, nothing frozen, no filter, no tab colour;
    // on paper it lies across the sheet, fitted to its width.
    expect(ws.name).toBe("Руководство");
    expect(ws.getCell("A1").value).toBe("Аналитика Connect — Руководство: 2–8 нояб.");
    expect(ws.getCell(1, GRID).master.address).toBe("A1");
    expect(ws.getCell("A1").font).toMatchObject({ bold: true, size: 16 });
    expect(ws.views[0]?.state).not.toBe("frozen");
    expect(ws.autoFilter).toBeUndefined();
    expect(ws.properties.tabColor).toBeUndefined();
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1, fitToHeight: 0 });
    expect(ws.columnCount).toBe(GRID);
    expect(file.page.find("Период").map(said)).toEqual(["Период", "2–8 нояб."]);

    // The blocks in order; a block that belongs to the one above has no link at the top.
    expect(file.page.titles).toEqual([
      "Требует внимания · 3",
      "Маршруты и дисциплина",
      "Календарь",
      "Market Visit",
      "Нормы и цвета",
    ]);
    const chips = file.page.links;
    expect(chips.map((chip) => chip.text)).toEqual([
      "Требует внимания",
      "Маршруты и дисциплина",
      "Market Visit",
      "Нормы и цвета",
    ]);
    expect(chips.every((chip) => chip.sheet === "Руководство")).toBe(true);
    expect(said(ws.getRow(chips[0]!.row).getCell(1))).toBe("Требует внимания · 3");
    expect(said(ws.getRow(chips[2]!.row).getCell(1))).toBe("Market Visit");

    // Whose data the block is, in the page's tags; the hint; a good piece of news in green.
    const block = file.page.block("Требует внимания");
    expect(block.cells.flat().map((cell) => [cell.text, fillOf(cell)])).toEqual(
      expect.arrayContaining([
        ["Smart Up", "FFF4EEFF"],
        ["Connect-бот", "FFE6F6FE"],
      ]),
    );
    expect(block.texts).toContain("Сотрудники, у которых показатели ниже нормы.");
    expect(inkOf(block.find("Таких сотрудников нет.")[0]!)).toBe("FF007A55");
  });

  it("keeps the links at the top for a page of three blocks and more, as the page does", async () => {
    const { book, page } = make();
    page.title("Тест");
    page.chips();
    page.section("Маршрут TSM_TST_1");
    page.section("Market Visit");
    page.section("Нормы и цвета", { own: true });
    page.finish();
    expect((await reopen(book)).page.links).toEqual([]);
  });

  it("puts the tiles in a row: the number in its colour, the bar, the change, the note", async () => {
    const { book, page } = make();
    page.tiles(
      [
        {
          label: "План визитов выполнен",
          value: 84,
          format: "percent",
          tone: "bad",
          meter: 84,
          trend: { delta: -2, tone: "bad", unit: "п.п." },
          note: "17 583 из 20 863 визитов",
        },
        { label: "Connect на визитах", value: 91.4, format: "percent", tone: "good", meter: 50 },
        { label: "Заказов", value: 2760, note: "85 903 пач." },
        { label: "Сумма заказов", value: 1_730_000_000, format: "money" },
      ],
      4,
    );
    page.stats([
      { label: "Пропущено", value: 4730, tone: "warn", note: "точек ни разу не посещено: 154" },
      { label: "Hit rate DR", value: 60.1, format: "percent", tone: "bad" },
      { label: "Продано за период", value: 45_040_000, format: "money" },
      { label: "Во время визита", value: null, note: "нет времени визита" },
    ]);
    page.finish();
    const { page: sheet } = await reopen(book);
    const ws = sheet.ws;

    // Four tiles across the grid, each a box of four rows.
    const plan = sheet.stat("План визитов выполнен");
    expect([plan.value, plan.cell.numFmt, plan.note]).toEqual([
      84,
      '0"%"',
      "17 583 из 20 863 визитов",
    ]);
    // Under its norm: the number in red, the tile outlined.
    expect(inkOf(plan.cell)).toBe("FFE7000B");
    expect(plan.cell.border?.left).toMatchObject({ style: "medium", color: { argb: "FFFB2C36" } });
    const label = sheet.find("План визитов выполнен")[0]!;
    expect(label.border?.top?.color?.argb).toBe("FFFB2C36");
    // The change next to the number: its sign is an arrow, its colour says better or worse.
    const change = ws.getRow(Number(plan.cell.row)).getCell(7);
    expect([change.value, change.numFmt, inkOf(change)]).toEqual([
      -2,
      '"▲ "0.0" п.п.";"▼ "0.0" п.п.";0.0" п.п."',
      "FFE7000B",
    ]);
    // The bar under the number: 84% of the tile's 11 cells are filled in the tone's colour.
    const bar = Array.from({ length: 11 }, (_, i) =>
      fillOf(ws.getRow(Number(plan.cell.row) + 1).getCell(1 + i)),
    );
    expect(bar.filter((color) => color === "FFDC2626")).toHaveLength(9);
    expect(bar.filter((color) => color === "FFECEEF2")).toHaveLength(2);
    const connect = sheet.stat("Connect на визитах");
    expect([connect.value, connect.cell.numFmt, inkOf(connect.cell)]).toEqual([
      91.4,
      '0.0"%"',
      "FF007A55",
    ]);
    expect(connect.cell.border?.left?.color?.argb).toBe("FFC3C9D3");
    // Money reads as on the page («1,73 млрд сум») and is the number it was.
    const sum = sheet.stat("Сумма заказов");
    expect(sum.value).toBe(1_730_000_000);
    expect(sum.cell.numFmt).toContain("млрд сум");
    expect(sheet.stat("Заказов")).toMatchObject({ value: 2760, note: "85 903 пач." });

    // The numbers of a block: a label, the number (in colour when the page writes it so), a
    // note; far under the norm has a red edge.
    const missed = sheet.stat("Пропущено");
    expect([missed.value, inkOf(missed.cell), missed.note]).toEqual([
      4730,
      "FFBB4D00",
      "точек ни разу не посещено: 154",
    ]);
    const hit = sheet.stat("Hit rate DR");
    expect([hit.value, inkOf(hit.cell)]).toEqual([60.1, "FFE7000B"]);
    expect(hit.cell.border?.left).toMatchObject({ style: "medium", color: { argb: "FFFB2C36" } });
    expect(sheet.stat("Продано за период").cell.numFmt).toBe('#,##0,," млн сум"');
    expect(sheet.stat("Во время визита").value).toBe("—");
  });

  it("makes a table as the page shows it and links to the sheet with the whole list", async () => {
    const { book, page } = make();
    page.section("Маршруты и дисциплина", { sources: ["smartup"] });
    const shown = page.table(table(), { limit: 2 });
    page.section("Зоны", { nav: false });
    // The same list in another block: the same sheet.
    page.table(table(), { limit: 2 });
    page.finish();
    expect(shown).toEqual({ shown: 2, total: 3 });
    const file = await reopen(book);
    const block = file.page.block("Маршруты и дисциплина");
    const [made] = block.tables();

    // The page's columns over the grid: the first takes what the others leave; the change stands
    // under the header of the share before it.
    expect(made!.head).toEqual(["Зона", "Визитов", "Посещаемость"]);
    const head = made!.headCells;
    expect(head.map((cell) => cell.address)).toEqual(["A6", "AK6", "AO6"]);
    expect(file.page.ws.getCell("AJ6").master.address).toBe("A6");
    // The header of the change is the share's: its own cell is empty.
    expect(file.page.ws.getCell("AS6").value).toBeNull();
    expect(fillOf(file.page.ws.getCell("AS6"))).toBe("FFF0F3F7");
    expect(head[0]!.font).toMatchObject({ bold: true, size: 9 });
    expect(head[2]!.alignment).toMatchObject({ horizontal: "right", wrapText: true });
    // The first rows, in order. A name stands under its code; numbers are numbers.
    expect(made!.rows).toEqual([
      ["TSM_TST_1\nТест Первый", 1200, 41.4, -2.5],
      ["TSM_TST_2\nТест Второй", 30, 95, 1.4],
    ]);
    const [first, second] = made!.cells;
    expect(first![1]!.numFmt).toBe("#,##0");
    expect([first![2]!.numFmt, second![2]!.numFmt]).toEqual(['0.0"%"', '0"%"']);
    // The page's colours: a share against its norm tints the cell, the change is written in
    // colour, a row to look at has a thick edge on its left.
    expect([fillOf(first![2]!), fillOf(second![2]!)]).toEqual([RED, GREEN]);
    expect([inkOf(first![3]!), inkOf(second![3]!)]).toEqual(["FFE7000B", "FF007A55"]);
    expect(first![3]!.numFmt).toBe('"▲ "0.0" п.п.";"▼ "0.0" п.п.";0.0" п.п."');
    expect(first![0]!.border?.left).toMatchObject({ style: "thick", color: { argb: "FFFB2C36" } });
    expect(second![0]!.border?.left).toBeUndefined();
    expect(fillOf(first![0]!)).toBeUndefined();

    // Under the table: the link to the whole list, which says what the list is.
    expect(block.links).toEqual([{ text: "Весь список: 3 строки →", sheet: "Маршруты", row: 1 }]);
    expect(await linkHints(file.file)).toEqual(["Маршруты по зонам.", "Маршруты по зонам."]);
    // One sheet for both blocks, with every row and every column, and the way back to the first.
    expect(file.names).toEqual(["Руководство", "Маршруты"]);
    expect(file.orphans).toEqual([]);
    const list = file.copy.getWorksheet("Маршруты")!;
    expect((list.getRow(1).values as unknown[]).slice(1, 6)).toEqual([
      "Зона",
      "Сотрудник",
      "Визитов",
      "Посещаемость, %",
      "Изменение, п.п.",
    ]);
    expect(file.rows("Маршруты")).toEqual([
      ["TSM_TST_1", "Тест Первый", 1200, 41.4, -2.5],
      ["TSM_TST_2", "Тест Второй", 30, 95, 1.4],
      ["TSM_TST_3", "Тест Третий", 12, 88.8],
    ]);
    expect(list.autoFilter).toBe("A1:E4");
    expect(fillOf(list.getRow(4).getCell(4))).toBe(AMBER);
    expect(file.back("Маршруты")).toEqual({
      text: "← Руководство: Маршруты и дисциплина",
      sheet: "Руководство",
      row: 2,
      at: "Маршруты и дисциплина",
    });
  });

  it("makes a sheet of a list only when the page cuts it or people work through it", async () => {
    const all = make();
    all.page.section("Зоны");
    all.page.table(table(), { limit: 10 });
    all.page.finish();
    const whole = await reopen(all.book);
    // Every row is on the page: no sheet, no link.
    expect(whole.names).toEqual(["Руководство"]);
    expect(whole.page.links).toEqual([]);
    expect(whole.page.block("Зоны").tables()[0]!.rows).toHaveLength(3);

    // A list people work through has its sheet all the same: it has every column.
    const kept = make();
    kept.page.section("Зоны");
    kept.page.table(table(zones, true), { limit: 10 });
    kept.page.finish();
    expect((await reopen(kept.book)).names).toEqual(["Руководство", "Маршруты"]);

    // A table without a sheet says how many more there are; an empty one that there is none.
    const plain = make();
    plain.page.section("Зоны");
    plain.page.table({ ...table(), full: undefined }, { limit: 1 });
    plain.page.table({ ...table([]), full: undefined });
    plain.page.finish();
    const cut = await reopen(plain.book);
    expect(cut.names).toEqual(["Руководство"]);
    expect(cut.page.texts).toEqual(expect.arrayContaining(["и ещё 2", "Нет."]));
  });

  it("draws bars as filled cells next to their numbers", async () => {
    const { book, page } = make();
    page.section("Market Visit");
    page.bars(
      [
        { label: "Display TST", value: 40, note: "22% проверок" },
        { label: "Тест стойка", value: 10 },
      ],
      { color: "#eb6834" },
    );
    page.section("Визиты");
    page.stages([
      { label: "Всё в Connect", value: 36, color: "#1f9d55", note: "75%" },
      { label: "Нет Market Visit", value: 12, color: "#eb6834", note: "25%" },
      { label: "Другой сотрудник", value: 0, color: "#8a6fd1" },
    ]);
    page.section("По дням");
    page.days(
      [
        { label: "9 нояб.", values: [10, 5, 0] },
        { label: "10 нояб.", values: [20, 20, 10] },
      ],
      [
        { label: "По плану", color: "#c9c7bf" },
        { label: "Посещено", color: "#2a78d6" },
        { label: "С Connect", color: "#1f9d55" },
      ],
    );
    page.finish();
    const { page: sheet } = await reopen(book);
    const ws = sheet.ws;
    const fills = (row: number) =>
      Array.from({ length: GRID }, (_, i) => fillOf(ws.getRow(row).getCell(1 + i)));
    const count = (row: number, color: string) => fills(row).filter((c) => c === color).length;

    // A list of bars: the label, the bar up to the value's share of the largest, the number
    // and its note.
    const bars = sheet.block("Market Visit");
    const first = bars.find("Display TST");
    expect(first.map(said)).toEqual(["Display TST", 40, "· 22% проверок"]);
    const top = Number(first[0]!.row);
    expect(count(top, "FFEB6834")).toBe(15);
    expect(count(top, "FFECEEF2")).toBe(0);
    // A quarter of the largest.
    expect([count(top + 1, "FFEB6834"), count(top + 1, "FFECEEF2")]).toEqual([4, 11]);

    // The parts of a whole: one bar across the block, each part its share of the cells, and
    // the legend under it — a mark, the part, its number, a note.
    const stages = sheet.block("Визиты");
    const whole = Number(stages.find("Всё в Connect")[0]!.row) - 2;
    expect([count(whole, "FF1F9D55"), count(whole, "FFEB6834"), count(whole, "FF8A6FD1")]).toEqual([
      36, 12, 0,
    ]);
    expect(stages.find("Всё в Connect").map(said)).toEqual(["Всё в Connect", 36, "· 75%"]);
    expect(fillOf(ws.getRow(whole + 2).getCell(1))).toBe("FF1F9D55");

    // Numbers by day: a row a day with its numbers and one bar — the plan in grey as far as it
    // goes past the visits, those in blue past the ones with Connect, which are green.
    const days = sheet.block("По дням").tables()[0]!;
    expect(days.head).toEqual(["День", "По плану", "Посещено", "С Connect"]);
    expect(days.rows).toEqual([
      ["9 нояб.", 10, 5, 0],
      ["10 нояб.", 20, 20, 10],
    ]);
    const day = Number(days.cells[0]![0]!.row);
    // 35 cells of bar: 10 of 20 is half of them, 5 of 20 a quarter.
    expect([count(day, "FFC9C7BF"), count(day, "FF2A78D6"), count(day, "FF1F9D55")]).toEqual([
      9, 9, 0,
    ]);
    expect([
      count(day + 1, "FFC9C7BF"),
      count(day + 1, "FF2A78D6"),
      count(day + 1, "FF1F9D55"),
    ]).toEqual([0, 17, 18]);
  });

  it("draws a calendar as a grid of tinted cells and the matrix as its four corners", async () => {
    const { book, page } = make();
    page.section("Календарь посещаемости TSM");
    page.calendar({
      head: "Зона",
      total: "Посещаемость",
      days: [
        { top: "пн", bottom: "9", weekend: false },
        { top: "вт", bottom: "10", weekend: false },
        { top: "сб", bottom: "14", weekend: true },
      ],
      rows: [
        {
          label: "TSM_TST_1",
          sub: "Тест Первый",
          cells: [{ text: "0", tone: "bad" }, { text: "3", tone: "good" }, null],
          share: 41.4,
          tone: "bad",
          of: "12 / 29",
        },
        {
          label: "TSM_TST_2",
          sub: null,
          cells: [{ text: "+", tone: null }, { text: "2", tone: "warn" }, null],
          share: null,
          tone: null,
          of: "0 / 0",
        },
      ],
      legend: [
        { tone: "good", text: "цель 95% выполнена" },
        { tone: null, text: "нет плана на этот день" },
      ],
      note: "«+» — только визиты вне плана",
    });
    page.section("Матрица DR");
    page.quadrants({
      columns: ["Посещаемость: меньше 95%", "Посещаемость: от 95%"],
      rows: ["Hit rate: от 90%", "Hit rate: меньше 90%"],
      cells: [
        [
          { title: "Одна ниже цели", count: 1, tone: "warn", items: "DR_TST_3" },
          { title: "Обе цели выполнены", count: 2, tone: "good", items: "DR_TST_1, DR_TST_2" },
        ],
        [
          { title: "Обе ниже цели", count: 0, tone: "bad", items: "" },
          { title: "Одна ниже цели", count: 4, tone: "warn", items: "DR_TST_4, DR_TST_5" },
        ],
      ],
    });
    page.finish();
    const { page: sheet } = await reopen(book);

    // A row a zone, a cell a day: the number, tinted against the target; a day without a share
    // grey, a day without a route pale; the period's share at the end of the row.
    const calendar = sheet.block("Календарь посещаемости TSM");
    const zone = calendar.cells.find((row) => row[0]!.text.startsWith("TSM_TST_1"))!;
    expect(zone.map(said)).toEqual(["TSM_TST_1\nТест Первый", 0, 3, 41.4, "12 / 29"]);
    expect(zone.slice(1, 4).map(fillOf)).toEqual([RED, GREEN, RED]);
    const second = calendar.cells.find((row) => row[0]!.text === "TSM_TST_2")!;
    expect(second.map(said)).toEqual(["TSM_TST_2", "+", 2, "—", "0 / 0"]);
    expect(second.slice(1, 3).map(fillOf)).toEqual(["FFF0F3F7", AMBER]);
    // A day is one column of the grid, after the zone's.
    expect(zone[1]!.address).toBe(`J${zone[1]!.row}`);
    expect(fillOf(sheet.ws.getRow(Number(zone[0]!.row)).getCell(12))).toBe("FFF8F9FB");
    expect(calendar.texts).toEqual(
      expect.arrayContaining(["пн", "сб", "цель 95% выполнена", "«+» — только визиты вне плана"]),
    );
    expect(inkOf(calendar.find("сб")[0]!)).toBe("FFBB4D00");

    // The four corners of the matrix: how many zones and which, tinted by the class.
    const matrix = sheet.block("Матрица DR");
    expect(matrix.texts).toEqual(
      expect.arrayContaining([
        "Посещаемость: меньше 95%",
        "Hit rate: от 90%",
        "2  Обе цели выполнены",
        "DR_TST_1, DR_TST_2",
        "0  Обе ниже цели",
        "4  Одна ниже цели",
      ]),
    );
    const corner = (text: string) => fillOf(matrix.cells.flat().find((c) => c.text === text)!);
    expect([corner("2  Обе цели выполнены"), corner("0  Обе ниже цели")]).toEqual([
      "FFE0F1E7",
      "FFFAE1E1",
    ]);
    expect(corner("DR_TST_1, DR_TST_2")).toBe("FFE0F1E7");
  });

  it("sets two blocks next to each other and starts a block that does not fit on a new sheet of paper", async () => {
    const { book, page } = make();
    page.section("Автосток (OOS) и заказы");
    page.split(
      () => {
        page.sub("По сотрудникам", { level: 4 });
        page.table({ ...table(), full: undefined });
      },
      () => {
        page.sub("По товарам", { level: 4 });
        page.table({ ...table(zones.slice(0, 1)), full: undefined });
      },
    );
    page.text("Под обеими таблицами.");
    // A block longer than a sheet of paper, then a short one.
    page.section("Точки");
    for (let i = 0; i < 55; i++) page.text(`Тест магазин ${900001 + i}`);
    page.section("Нормы и цвета");
    for (let i = 0; i < 8; i++) page.text("Норма");
    page.finish();
    const { page: sheet, copy, file } = await reopen(book);
    const ws = sheet.ws;

    // The two tables start on one row, each in its half of the grid; what follows starts under
    // the taller of them.
    const left = sheet.sub("По сотрудникам");
    const right = sheet.sub("По товарам");
    expect(left.from).toBe(right.from);
    expect(left.tables()[0]!.rows).toHaveLength(3);
    expect(right.tables()[0]!.rows).toEqual([["TSM_TST_1\nТест Первый", 1200, 41.4, -2.5]]);
    const lead = (part: typeof left) => part.tables()[0]!.headCells[0]!;
    expect([lead(left).col, lead(right).col]).toEqual([1, 26]);
    const after = sheet.find("Под обеими таблицами.")[0]!;
    expect(Number(after.row)).toBeGreaterThan(Number(left.tables()[0]!.cells[2]![0]!.row));

    // The merges the sheet was written with are all in the file (they are kept aside while it
    // is written), and no cell is in two of them.
    const merges = (copy.worksheets[0] as unknown as { _merges: Record<string, { tl: string }> })
      ._merges;
    expect(Object.keys(merges).length).toBeGreaterThan(60);
    expect(ws.getCell("A2").isMerged).toBe(true);

    // On paper: a block that does not fit the sheet with what is above it starts a new one
    // (the break is after the row above the gap over its title), and so does the block after a
    // table longer than a sheet.
    const xml = await (
      await JSZip.loadAsync(file)
    )
      .file("xl/worksheets/sheet1.xml")!
      .async("string");
    const breaks = [...xml.matchAll(/<brk id="(\d+)"/g)].map((match) => Number(match[1]));
    expect(breaks.map((row) => said(ws.getRow(row + 2).getCell(1)))).toEqual([
      "Точки",
      "Нормы и цвета",
    ]);
    expect(readPage(ws).titles).toEqual(["Автосток (OOS) и заказы", "Точки", "Нормы и цвета"]);
  });
});
