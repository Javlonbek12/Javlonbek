// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { CYCLE, makeMaterial, makeModel, makeSku, MONTHS, sopWorkbook } from "@/tests/helpers/sop";

import {
  cleanText,
  detectCycle,
  fileDateOf,
  isPsiSheet,
  MAX_SOP_FILE_MB,
  monthHeader,
  parseSopWorkbook,
  SopFileError,
} from "./parse";

const flow = (value: number) => MONTHS.map(() => value);

describe("headers", () => {
  it("reads the month and the column from a header, whatever its apostrophe and line breaks", () => {
    expect(monthHeader("Nov'26\r\nProduction\r\nOrder")).toEqual({
      month: "2026-11",
      rest: "Production Order",
    });
    expect(monthHeader("Dec`23\nEntity\nStock")).toEqual({
      month: "2023-12",
      rest: "Entity Stock",
    });
    expect(monthHeader("Jan’27 Distributor\nSell-thru")?.month).toBe("2027-01");
    expect(monthHeader("Sept'2026 Outbound Plan")?.month).toBe("2026-09");
    expect(monthHeader("PRODUCT NAME")).toBeNull();
    expect(monthHeader("Xyz'26 Production Order")).toBeNull();
  });

  it("joins a header's lines into one", () => {
    expect(cleanText("  Unique\r\nCode ")).toBe("Unique Code");
    expect(cleanText(null)).toBe("");
  });

  it("finds the market's PSI sheet by its name", () => {
    expect(isPsiSheet("PSI TST (test)", "TST")).toBe(true);
    expect(isPsiSheet("psi tst", "tst")).toBe(true);
    expect(isPsiSheet("PSI Global Tst2", "TST")).toBe(false);
    expect(isPsiSheet("Total PSI TST", "TST")).toBe(false);
    expect(isPsiSheet("PSI TST", "")).toBe(false);
  });

  it("takes the date from the end of a file name", () => {
    expect(fileDateOf("Monthly plan_One Document_261113.xlsx")).toBe("2026-11-13");
    expect(fileDateOf("plan 261102 v2.xlsx")).toBe("2026-11-02");
    expect(fileDateOf("plan_269913.xlsx")).toBeNull();
    expect(fileDateOf("plan.xlsx")).toBeNull();
  });
});

describe("parseSopWorkbook", () => {
  const model = makeModel(
    [
      makeSku("SKU A", {
        po: [0, 200, 0, 300, 0, 400, 0, 250, 0, 0, 300],
        sellIn: [0, 100, 110, 120, 130.5, 100, 100, 100, 100, 100, 100],
        sellThru: flow(90),
        entityStock: [50, 150, 40, 220, 89.5],
        distStock: [100, 110, 130, 160, 200.5],
        formulas: { sellIn: "nnnnsnnnnnn", entityStock: "nnnnsoooooo" },
        parts: { "sellIn:4": [100.5, 30], "entityStock:4": [60, 29.5] },
      }),
      makeSku("ALFA 100", {
        factory: "BBB",
        type: "83 S",
        status: "New (not launched)",
        code: "",
        po: [0, 0, 0, 0, 0, 0, 300],
        // HQ left the plan and the stocks of this row empty.
        formulas: { plan: "lllll------", entityStock: "nnnnn------", distStock: "nnnnn------" },
      }),
    ],
    {
      materials: {
        sheet: "3. Materials",
        planMonths: MONTHS.slice(5),
        rows: [
          makeMaterial("SKU A", {
            totalKsh: 120.5,
            totalBox: 800,
            plan: [400, 0, 250, 0, 0, 300],
            planTotal: 950,
            salesForecast: 95,
            turnover: 8.4,
            note: "проверить",
          }),
        ],
      },
    },
  );

  it("reads the sheet back as it was written: months, values, formulas, totals, materials", async () => {
    const parsed = await parseSopWorkbook(
      await sopWorkbook(model, { extraSheets: ["Other", "PSI Global Zzz"] }),
      "tst",
    );
    expect(parsed.sheet).toBe("PSI TST (test)");
    expect(parsed.market).toBe("TST");
    expect(parsed.headerRow).toBe(7);
    expect(parsed.months).toEqual(MONTHS);
    expect(parsed.skus.map((s) => [s.key, s.row, s.factory, s.type, s.status, s.code])).toEqual([
      ["AAA|SKU A", 8, "AAA", "84 SS", "Steady", "T-SKUA"],
      ["BBB|ALFA 100", 9, "BBB", "83 S", "New (not launched)", ""],
    ]);
    const a = parsed.skus[0]!;
    // The opening month has stocks only.
    expect(a.values.po[0]).toBeNull();
    expect(a.formulas.po[0]).toBe("-");
    expect(a.values.entityStock[0]).toBe(50);
    expect(a.values.po.slice(1)).toEqual(model.skus[0]!.values.po.slice(1));
    expect(a.values.sellIn[4]).toBe(130.5);
    expect(a.formulas.sellIn.slice(1)).toBe("nnnsnnnnnn");
    expect(a.parts).toEqual({ "sellIn:4": [100.5, 30], "entityStock:4": [60, 29.5] });
    expect(a.formulas.plan.slice(1)).toBe("llllllllll");
    expect(a.formulas.entityStock).toBe("nnnnsoooooo");
    expect(a.values.entityStock.slice(5)).toEqual(model.skus[0]!.values.entityStock.slice(5));
    const b = parsed.skus[1]!;
    expect(b.values.plan[6]).toBeNull();
    expect(b.formulas.entityStock.slice(5)).toBe("------");
    // The sheet's own totals: by factory and the grand total.
    expect(parsed.subtotals.map((s) => [s.row, s.label])).toEqual([
      [2, "AAA"],
      [3, "BBB"],
      [4, "Total"],
    ]);
    expect(parsed.subtotals[2]!.values.po![6]).toBe(300);
    expect(parsed.subtotals[0]!.values.po![5]).toBe(400);
    // Materials: only our market's rows, the newest code, the plan by month.
    expect(parsed.materials).toEqual({
      sheet: "3. Materials",
      planMonths: MONTHS.slice(5),
      rows: [
        expect.objectContaining({
          factory: "AAA",
          code: "T-SKUA",
          name: "SKU A",
          totalKsh: 120.5,
          totalBox: 800,
          plan: [400, 0, 250, 0, 0, 300],
          planTotal: 950,
          salesForecast: 95,
          turnover: 8.4,
          note: "проверить",
        }),
      ],
    });
    expect(parsed.lastActual).toBe("2026-10");
    expect(parsed.detectedCycle).toBe(CYCLE);
  });

  it("reads a file without a materials sheet", async () => {
    const parsed = await parseSopWorkbook(await sopWorkbook(model, { noMaterials: true }), "TST");
    expect(parsed.materials).toBeNull();
    expect(parsed.skus).toHaveLength(2);
  });

  it("takes «Inbound Plan» for the shipment and rows with the same name apart", async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet("PSI TST");
    ws.getRow(3).values = [
      "FAC",
      "PRODUCT NAME",
      "Jan'26 Production Order",
      "Jan'26\nInbound\nPlan",
      "Jan'26 Entity Stock",
      "Feb'26 Production Order",
      "Feb'26 Outbound Plan",
      "Feb'26 Entity Stock",
    ];
    ws.addRow(["AAA", "SKU A", 200, 180, 50, 0, 20, { formula: "E4+G4", result: 70 }]);
    ws.addRow(["AAA", "SKU A", 0, 0, 5, 0, 0, { formula: "E5+G5", result: 5 }]);
    ws.addRow([null, null, 999]);
    const parsed = await parseSopWorkbook(Buffer.from(await book.xlsx.writeBuffer()), "TST");
    expect(parsed.headerRow).toBe(3);
    expect(parsed.months).toEqual(["2026-01", "2026-02"]);
    expect(parsed.skus.map((s) => s.key)).toEqual(["AAA|SKU A", "AAA|SKU A#2"]);
    expect(parsed.skus[0]!.values.out).toEqual([180, 20]);
    expect(parsed.skus[0]!.code).toBe("");
    expect(parsed.detectedCycle).toBe("2026-02");
  });

  it("says what is wrong with a file it cannot use", async () => {
    const code = (promise: Promise<unknown>) =>
      promise.then(
        () => "ok",
        (error) => (error instanceof SopFileError ? error.code : `other: ${error}`),
      );
    expect(await code(parseSopWorkbook(Buffer.from("not a workbook at all"), "TST"))).toBe(
      "notXlsx",
    );
    expect(await code(parseSopWorkbook(await sopWorkbook(model), "ZZZ"))).toBe("noSheet");
    const book = new ExcelJS.Workbook();
    book.addWorksheet("PSI TST").addRow(["FAC", "NAME", "Jan'26 Production Order"]);
    expect(await code(parseSopWorkbook(Buffer.from(await book.xlsx.writeBuffer()), "TST"))).toBe(
      "noHeader",
    );
    const noMonths = new ExcelJS.Workbook();
    noMonths.addWorksheet("PSI TST").addRow(["FAC", "PRODUCT NAME", "Production Order"]);
    expect(
      await code(parseSopWorkbook(Buffer.from(await noMonths.xlsx.writeBuffer()), "TST")),
    ).toBe("noMonths");
    const noSkus = new ExcelJS.Workbook();
    noSkus.addWorksheet("PSI TST").addRow(["FAC", "PRODUCT NAME", "Jan'26 Production Order"]);
    expect(await code(parseSopWorkbook(Buffer.from(await noSkus.xlsx.writeBuffer()), "TST"))).toBe(
      "noSkus",
    );
    expect(
      await code(parseSopWorkbook(Buffer.alloc(MAX_SOP_FILE_MB * 1024 * 1024 + 1), "TST")),
    ).toBe("tooBig");
  });
});

describe("detectCycle", () => {
  const skus = (entityStock: string) => [
    makeSku("SKU A", { formulas: { entityStock } }),
    makeSku("SKU B", { formulas: { entityStock } }),
    makeSku("SKU C", { formulas: { entityStock: "nnnnnoooooo" } }),
  ];

  it("takes the last month whose Entity Stock is mostly typed as the closed one", () => {
    expect(detectCycle(makeModel(skus("nnnnnoooooo")))).toEqual({
      lastActual: "2026-10",
      cycle: "2026-11",
    });
    // Formulas in the middle of the history do not move the cycle back.
    expect(detectCycle(makeModel(skus("nnoonoooooo"))).cycle).toBe("2026-11");
    // One typed cell in the plan does not move it forward.
    expect(
      detectCycle(
        makeModel([
          ...skus("nnnnnoooooo"),
          makeSku("SKU D", { formulas: { entityStock: "nnnnnonoooo" } }),
        ]),
      ).cycle,
    ).toBe("2026-11");
  });

  it("takes a closing stock typed as a sum of two numbers for a typed one", () => {
    // Our own version before sending: October's Entity Stock is «=warehouse+in transit».
    expect(detectCycle(makeModel(skus("nnnnsoooooo").slice(0, 2)))).toEqual({
      lastActual: "2026-10",
      cycle: "2026-11",
    });
  });

  it("cannot tell when nothing is a formula or the last month is typed", () => {
    expect(detectCycle(makeModel(skus("nnnnnnnnnnn").slice(0, 2)))).toEqual({
      lastActual: null,
      cycle: null,
    });
    expect(detectCycle(makeModel(skus("ooooooooonn").slice(0, 2))).cycle).toBeNull();
  });
});
