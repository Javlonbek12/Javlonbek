import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig, DEFAULT_ROLE_CONFIG } from "@/modules/core/access/config";
import {
  addShipment,
  deleteShipment,
  getIncludeStock,
  importDistributionFile,
  loadDistribution,
  setIncludeStock,
  shipWaybill,
  updatePosmSettings,
} from "@/modules/distribution/service";
import { distributionXlsx } from "@/modules/distribution/xlsx";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { distributionWorkbook } from "@/tests/helpers/distribution";

describe("POSM distribution", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("imports the file, plans by region and TSM, records shipments and exports Excel", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    expect(await importDistributionFile(owner, await distributionWorkbook())).toEqual({
      counts: 9,
      posm: 3,
    });
    let d = await loadDistribution();
    expect(d.includeStock).toBe(true);
    expect(d.destinations).toEqual([
      "Tashkent",
      "Test Town",
      "Tashkent · TSM_TEST_1",
      "Tashkent · TSM_TEST_2",
    ]);
    const shelf = d.plans.find((p) => p.item.name === "Shelftalker (тест)")!;
    expect(shelf.byRegion.get("Tashkent")).toBe(12);
    expect(shelf.byTsm.get("TSM_TEST_1")).toBe(8);
    expect(d.findings.map((f) => f.key)).toContain("gap");

    // A waybill for Test Town, then one line for a TSM.
    expect(
      await shipWaybill(
        owner,
        "Test Town",
        [{ posmId: shelf.item.id, quantity: 6 }],
        "2026-10-26",
        d.destinations,
      ),
    ).toBe(1);
    await addShipment(
      owner,
      {
        posmId: shelf.item.id,
        destination: "Tashkent · TSM_TEST_1",
        quantity: 5,
        shippedOn: "2026-10-26",
      },
      d.destinations,
    );
    await expect(
      addShipment(
        owner,
        { posmId: shelf.item.id, destination: "Nowhere", quantity: 5, shippedOn: "2026-10-26" },
        d.destinations,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    d = await loadDistribution();
    expect(d.stock.find((s) => s.item.id === shelf.item.id)).toMatchObject({
      shipped: 11,
      onHand: 8,
    });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await distributionXlsx(d)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining(["Распределение", "Склад", "Накладная Test Town"]),
    );

    // A new file keeps the shipments; the switch follows the file.
    await importDistributionFile(owner, await distributionWorkbook({ includeStock: "Нет" }));
    expect(await getIncludeStock()).toBe(false);
    expect(await db.distShipment.count()).toBe(2);
  });

  it("everyone with the section records shipments; settings and uploads are for managers", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importDistributionFile(owner, await distributionWorkbook());
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: { modules: ["distribution"], taskScope: "own" },
    });
    const member = await withAccess(await createTestUser("MEMBER"));
    const other = await withAccess(await createTestUser("MEMBER"));
    const d = await loadDistribution();
    const item = d.items[0]!;

    await expect(
      importDistributionFile(member, await distributionWorkbook()),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(setIncludeStock(member, false)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updatePosmSettings(member, item.id, { ...item, types: item.types }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const shipment = await addShipment(
      member,
      { posmId: item.id, destination: "Test Town", quantity: 2, shippedOn: "2026-10-26" },
      d.destinations,
    );
    // Someone else's record: only its author or a manager deletes it.
    await expect(deleteShipment(other, shipment.id)).rejects.toMatchObject({ code: "forbidden" });
    await deleteShipment(member, shipment.id);

    await updatePosmSettings(owner, item.id, {
      inStock: 1,
      ordered: 2,
      reservePct: 0,
      base: "UNITS",
      norm: null,
      normReserve: 0,
      types: ["POSI_L"],
    });
    expect(await db.distPosm.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      inStock: 1,
      norm: null,
    });
    await expect(
      updatePosmSettings(owner, item.id, { ...item, types: ["NO_SUCH"] }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
