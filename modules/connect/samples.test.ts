// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { ConnectKind } from "@/lib/generated/prisma/enums";

import { detectKind, parseWorkbook, saleLines, type Cell, type ParsedSheet } from "./parse";
import { CONNECT_SAMPLES, connectSampleWorkbook, SAMPLE_MARK, type ConnectSample } from "./samples";

const KINDS: ConnectKind[] = [
  "SU_VISIT",
  "SU_PERSON",
  "VISIT",
  "OOS",
  "ORDER",
  "PAYMENT",
  "AUDIT",
  "ISM_CHECK",
  "ROUTE",
  "CLIENT",
  "SU_POSITION",
  "SALE",
];
// Made on 9 November, 18:00 in Tashkent: the last day of the route sample.
const CREATED = new Date("2026-11-09T13:00:00Z");

const hasMark = (cell: Cell) => typeof cell === "string" && cell.includes(SAMPLE_MARK);
// The samples as real rows: the mark taken off.
const unmarked = (samples = CONNECT_SAMPLES): ConnectSample[] =>
  samples.map((sample) => ({
    ...sample,
    rows: sample.rows.map((row) =>
      row.map((cell) => (hasMark(cell) ? String(cell).replace(SAMPLE_MARK, "").trim() : cell)),
    ),
  }));
// A sample with only some of its columns (by the header's name).
const columns = (sample: ConnectSample, keep: (name: string) => boolean) => {
  const names = sample.headers[0]!.map((name) => String(name ?? ""));
  const cut = (rows: Cell[][]) => rows.map((row) => row.filter((_, i) => keep(names[i] ?? "")));
  return {
    ...sample,
    before: cut(sample.before),
    headers: cut(sample.headers),
    rows: cut(sample.rows),
    after: cut(sample.after),
  };
};
// What a sheet has: a sale's store-day counts as its lines (a row of the report each).
const lines = (sheet: ParsedSheet) =>
  sheet.rows.reduce(
    (count, row) => count + (row.kind === "SALE" ? saleLines(row.record).length : 1),
    0,
  );
const sampleOf = (kind: ConnectKind) => CONNECT_SAMPLES.find((s) => s.kind === kind)!;
const WEEKDAY = /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)$/;

describe("Connect samples", () => {
  it("has one sample per kind, each row marked, under a header with the required columns", () => {
    expect(CONNECT_SAMPLES.map((s) => s.kind)).toEqual(KINDS);
    // Every kind there is: a kind added later needs its sample.
    expect([...KINDS].sort()).toEqual(Object.values(ConnectKind).sort());
    const names = CONNECT_SAMPLES.map((s) => s.sheet);
    expect(new Set(names).size).toBe(names.length);
    for (const sample of CONNECT_SAMPLES) {
      // What Excel takes for a sheet's name.
      expect(sample.sheet).toMatch(/^[^[\]:*?/\\]{1,31}$/);
      expect(sample.headers.length).toBeGreaterThan(0);
      const header = sample.headers.flat();
      expect(header).toEqual(expect.arrayContaining(sample.required));
      // The importer knows the export by the header (the first row of it).
      expect(detectKind(sample.headers[0]!.map((name) => String(name ?? "")))).toBe(
        sample.kind === "AUDIT" ? "VISIT" : sample.kind,
      );
      const width = sample.headers[0]!.length;
      expect(sample.headers.every((row) => row.length === width)).toBe(true);
      expect(sample.rows.length).toBeGreaterThanOrEqual(3);
      expect(sample.rows.length).toBeLessThanOrEqual(4);
      for (const row of sample.rows) {
        expect(row).toHaveLength(width);
        // The mark is in one cell, a text one.
        expect(row.filter(hasMark)).toHaveLength(1);
      }
      for (const row of [...sample.before, ...sample.after]) {
        expect(row.length).toBeLessThanOrEqual(width);
        expect(row.some(hasMark)).toBe(false);
      }
    }
    // The route sample shows every code.
    expect(sampleOf("ROUTE").rows.flat()).toEqual(
      expect.arrayContaining(["P", "PD", "U", "UD", "X", "O"]),
    );
  });

  it("gives a workbook that changes nothing when uploaded as it is", async () => {
    const guide = {
      sheet: "Как загрузить",
      rows: [
        ["Лист", "Что это"],
        ["Market Visit", "…"],
      ],
    };
    const buffer = await connectSampleWorkbook({ guide, created: CREATED });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(book.worksheets.map((ws) => ws.name)).toEqual([
      guide.sheet,
      ...CONNECT_SAMPLES.map((s) => s.sheet),
    ]);
    // The header is bold and stays in sight, under what the export has above it.
    const route = book.getWorksheet("Анализ маршрута")!;
    expect(route.views[0]).toMatchObject({ state: "frozen", ySplit: 11 });
    expect([9, 10, 11, 12].map((r) => route.getRow(r).getCell(3).font?.bold ?? false)).toEqual([
      false,
      true,
      true,
      false,
    ]);

    // Every sheet is known, has no rows, and says how many samples it left out.
    const sheets = await parseWorkbook(buffer);
    expect(sheets.map((s) => [s.kind, s.rows.length, s.skipped, s.samples])).toEqual(
      CONNECT_SAMPLES.map((s) => [s.kind, 0, 0, s.rows.length]),
    );
  });

  it("has the columns of the real exports: without the mark every row is read", async () => {
    const buffer = await connectSampleWorkbook({ samples: unmarked(), created: CREATED });
    const sheets = await parseWorkbook(buffer);
    expect(sheets.map((s) => [s.kind, lines(s), s.skipped, s.samples])).toEqual(
      CONNECT_SAMPLES.map((s) => [s.kind, s.rows.length, 0, undefined]),
    );
    // The sales sheet did not keep the workbook from the other sheets, and came as store-days.
    const sales = sheets.at(-1)!;
    expect(
      sales.rows.map((r) => [r.record.id, r.kind === "SALE" && saleLines(r.record).length]),
    ).toEqual([
      ["900001|2026-11-03", 2],
      ["900002|2026-11-04", 1],
      ["900003|2026-11-07", 1],
    ]);
    // What was read is what the sample shows: the store, the day, the person.
    const first = (kind: ConnectKind) => sheets.find((s) => s.kind === kind)!.rows[0]!.record;
    expect(first("OOS")).toMatchObject({
      id: "5001",
      storeCode: "900001",
      storeName: "Тест магазин 1",
      day: "2026-11-02",
      person: "TSM_TST_1 - Тест Первый",
      missing: 2,
      low: 1,
      orderNo: "#TST-0001",
      skus: { "ESSE Change": "OUT", "Pine Blue": "OUT", "ESSE Blue": "LOW" },
    });
    expect(first("ORDER")).toMatchObject({
      id: "#TST-0001",
      sourceCheck: "5001",
      packs: 40,
      skus: { "ESSE Change": 20, "Pine Blue": 10, "ESSE Blue": 10 },
    });
    expect(first("AUDIT")).toMatchObject({ id: "7101", template: "BDM Audit Опросник 11.2026" });
    expect(first("PAYMENT")).toMatchObject({ id: "301", paid: "Оплачено", checks: { length: 7 } });
    expect(first("ISM_CHECK")).toMatchObject({ id: "801", requestNo: "1", checks: { length: 7 } });
    expect(first("SU_PERSON")).toMatchObject({ id: "TSM_TST_1", name: "Тест Первый" });
    expect(first("SU_POSITION")).toMatchObject({ title: "BDM 99", user: "Тест Руководитель" });
    expect(first("CLIENT")).toMatchObject({
      id: "900001",
      person: "TSM_TST_1",
      contractSum: 500000,
    });
  });

  it("names the columns the importer cannot do without", async () => {
    const parse = async (sample: ConnectSample) => {
      const buffer = await connectSampleWorkbook({ samples: [sample], created: CREATED });
      return (await parseWorkbook(buffer))
        .filter((s) => s.kind === sample.kind)
        .reduce((count, sheet) => count + lines(sheet), 0);
    };
    for (const sample of unmarked()) {
      // (The days of a route are columns too: a weekday over each.)
      const needed = (name: string) => sample.required.includes(name) || WEEKDAY.test(name);
      // The required columns alone are enough for every row…
      expect([sample.kind, await parse(columns(sample, needed))]).toEqual([
        sample.kind,
        sample.rows.length,
      ]);
      // …and without any one of them the sheet is not known, or its rows are not kept.
      for (const name of sample.required)
        expect([name, await parse(columns(sample, (other) => other !== name))]).toEqual([name, 0]);
    }
  });

  it("gives the sheets asked for; the route analysis is of the month the workbook was made", async () => {
    const samples = unmarked();
    const one = (created: Date) => connectSampleWorkbook({ kinds: ["ROUTE"], samples, created });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await one(CREATED)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((ws) => ws.name)).toEqual(["Анализ маршрута"]);

    const [sheet, ...others] = await parseWorkbook(await one(CREATED));
    expect(others).toEqual([]);
    expect(sheet).toMatchObject({ kind: "ROUTE", skipped: 0 });
    expect(sheet!.rows.map((r) => r.record)).toMatchObject([
      {
        id: "2026-11|DR_TST_1|DR_TST_1|900001",
        storeName: "Тест магазин 1",
        month: "2026-11",
        day: "2026-11-09",
        lead: false,
        days: { "02": "PD", "04": "P", "06": "X", "09": "O" },
      },
      { id: "2026-11|DR_TST_1|DR_TST_1|900003", days: { "03": "U", "05": "UD", "09": "O" } },
      { id: "2026-11|TSM_TST_1|TSM_TST_1|900001", days: { "02": "P", "09": "O" } },
      { id: "2026-11|TSM_TST_1|TSM_TST_1|900002", days: { "03": "X", "07": "U" } },
    ]);
    // Made in another month, it is that month's.
    const [later] = await parseWorkbook(await one(new Date("2027-02-15T07:00:00Z")));
    expect(later!.rows.map((r) => r.record.month)).toEqual(Array(4).fill("2027-02"));
    // With the mark on, the same sheet has no rows.
    expect(await parseWorkbook(await connectSampleWorkbook({ kinds: ["ROUTE"] }))).toEqual([
      { kind: "ROUTE", rows: [], skipped: 0, samples: 4 },
    ]);
  });

  it("leaves the samples out of a sales report read by the light reader", async () => {
    // A workbook with nothing but sales (and a sheet of text) is not read with exceljs.
    const guide = { sheet: "Как загрузить", rows: [["Что это"], ["Отчёт по продажам"]] };
    const sample = sampleOf("SALE");
    const real = unmarked([sample])[0]!.rows;
    const mixed = { ...sample, rows: [sample.rows[0]!, real[1]!, sample.rows[2]!, real[3]!] };
    const buffer = await connectSampleWorkbook({ samples: [mixed], guide });
    const exceljs = vi.spyOn(ExcelJS, "Workbook");
    const sheets = await parseWorkbook(buffer);
    expect(exceljs).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(sheets).toMatchObject([{ kind: "SALE", skipped: 0, samples: 2 }]);
    expect(sheets[0]!.rows.map((r) => r.record)).toMatchObject([
      { id: "900001|2026-11-03", skus: { "Pine Blue": 1 }, staff: "DR_TST_1", tsm: "TSM_TST_1" },
      { id: "900003|2026-11-07", skus: { "Pine Green": 2 }, tsm: "TSM_TST_2" },
    ]);
  });

  it("counts an audit's sample as an audit's, next to real Market Visits", async () => {
    const [visits] = unmarked([sampleOf("VISIT")]);
    const audits = sampleOf("AUDIT");
    // One sheet, as the bot exports it: the visits' questions, both templates.
    const width = visits!.headers[0]!.length;
    const sheet = {
      ...visits!,
      rows: [...visits!.rows, ...audits.rows.map((row) => row.slice(0, width))],
    };
    const sheets = await parseWorkbook(await connectSampleWorkbook({ samples: [sheet] }));
    expect(sheets.map((s) => [s.kind, s.rows.length, s.samples])).toEqual([
      ["VISIT", 3, undefined],
      ["AUDIT", 0, 3],
    ]);
  });

  it("does not take a guide that reads as an export", async () => {
    const guide = { sheet: "Как загрузить", rows: [["Столбцы"], sampleOf("SALE").required] };
    await expect(connectSampleWorkbook({ guide })).rejects.toThrow(/guide/);
  });
});
