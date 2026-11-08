import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { withAccess } from "@/modules/core/access/actor";
import { outletReview, outletReviewXlsx, reviewCount } from "@/modules/distribution/control";
import { uploadHistory } from "@/modules/distribution/equipment";
import { dataSources, importEquipmentFile } from "@/modules/distribution/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { equipmentWorkbook } from "@/tests/helpers/distribution";

describe("equipment: data freshness, upload history, outlet check", () => {
  beforeEach(resetDb);

  it("says who loaded the file, what changed against the one before, and exports the check", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    await importEquipmentFile(owner, await equipmentWorkbook({ extra: true }));

    const sources = await dataSources();
    expect(sources.equipment?.by?.firstName).toBe(owner.firstName);

    const history = await uploadHistory();
    expect(history).toHaveLength(2);
    const [latest, first] = history;
    expect(first!.unitsDelta).toBeNull(); // nothing to compare the first file with
    expect(latest!.rows).toBeGreaterThan(first!.rows!);
    expect(latest!.rowsDelta).toBe(latest!.rows! - first!.rows!);
    expect(latest!.types.length).toBeGreaterThan(0);

    // Every outlet is missing from the (empty) outlet base: the check lists them, Excel too.
    const review = await outletReview();
    expect(reviewCount(review)).toBeGreaterThan(0);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await outletReviewXlsx(review)) as unknown as ArrayBuffer);
    const missing = book.getWorksheet("Нет в базе точек")!;
    expect(missing.rowCount).toBe(review.missing.length + 1);
  });
});
