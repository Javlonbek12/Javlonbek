import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import {
  addElement,
  catalogXlsx,
  createOrderFromBuilder,
  importCatalogFile,
  loadCatalog,
  runBuilder,
  saveElementSizes,
} from "@/modules/distribution/catalog";
import { importEquipmentFile, loadDistribution } from "@/modules/distribution/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { equipmentWorkbook } from "@/tests/helpers/distribution";

const options = {
  types: ["POSI_L", "DG_C"],
  elements: [] as string[],
  reservePct: 0.1,
  merge: true,
  withStock: true,
};

describe("the order builder", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("fills sizes from Excel, counts the order and saves it as an order", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    const header = await addElement(owner, "Header (тест)", "PVC");
    await expect(addElement(owner, "Header (тест)", "")).rejects.toMatchObject({ code: "exists" });
    await expect(addElement(member, "Другой", "")).rejects.toMatchObject({ code: "forbidden" });

    // The "to fill in" file lists every type for the new element; fill two rows and upload it.
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await catalogXlsx(await loadCatalog(), true)) as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Размеры POSM")!;
    expect(sheet.rowCount).toBeGreaterThan(15);
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const type = row.getCell(2).value;
      if (type === "POSI_L") row.getCell(5).value = 200;
      if (type === "POSI_L") row.getCell(6).value = 640;
      if (type === "POSI_L") row.getCell(7).value = 1;
      if (type === "POSI_L") row.getCell(8).value = 25000;
      if (type === "DG_C") row.getCell(7).value = 2;
    });
    book.getWorksheet("Оборудование")!.addRow(["POSI_MOD", "Display MOD", 1200, 600, 400]);
    const filled = Buffer.from(await book.xlsx.writeBuffer());
    expect(await importCatalogFile(owner, filled)).toEqual({ sizes: 2, types: 1 });
    expect(await db.distTypeSize.findUnique({ where: { type: "POSI_MOD" } })).toMatchObject({
      heightMm: 1200,
    });

    // Tashkent 10 + Test Town 6 POSI L, plus 2 in stock = 18; DG C 4.
    const { lines } = await runBuilder({ ...options, elements: [header.id] });
    expect(lines.map((l) => [l.types, l.units, l.quantity, l.sum, l.gaps])).toEqual([
      [["POSI_L"], 18, 20, 500000, []],
      [["DG_C"], 4, 9, null, ["size", "price"]],
    ]);

    await saveElementSizes(owner, header.id, {
      name: "Header (тест)",
      material: "PVC",
      sizes: [
        {
          type: "DG_C",
          heightMm: 150,
          widthMm: 700,
          perUnit: 0,
          price: null,
          material: null,
          note: null,
        },
      ],
    });
    const order = await createOrderFromBuilder(
      owner,
      { name: "Заказ из конструктора (тест)", orderedOn: "2026-11-01" },
      { ...options, elements: [header.id] },
    );
    const d = await loadDistribution(order.id);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({
      name: "Header (тест) (POSI L (10*9))",
      ordered: 20,
      types: ["POSI_L"],
      norm: 1,
    });
    expect(d.plans[0]!.byRegion.get("Tashkent")).toBeGreaterThan(0);
    await expect(
      createOrderFromBuilder(member, { name: "x", orderedOn: "2026-11-01" }, options),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
