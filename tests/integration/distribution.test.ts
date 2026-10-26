import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig, DEFAULT_ROLE_CONFIG } from "@/modules/core/access/config";
import {
  addShipment,
  createOrder,
  deleteOrder,
  deletePosm,
  deleteShipment,
  importEquipmentFile,
  importOutletBase,
  importPosmList,
  loadDistribution,
  setIncludeStock,
  setOrderClosed,
  shipWaybill,
  updatePosmSettings,
} from "@/modules/distribution/service";
import { distributionXlsx } from "@/modules/distribution/xlsx";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { equipmentWorkbook, outletBaseWorkbook, posmWorkbook } from "@/tests/helpers/distribution";

async function setUp() {
  const owner = await withAccess(await createTestUser("OWNER"));
  await importEquipmentFile(owner, await equipmentWorkbook());
  await importOutletBase(owner, await outletBaseWorkbook());
  const order = await createOrder(
    owner,
    { name: "Заказ (тест)", orderedOn: "2026-10-01" },
    await posmWorkbook(),
  );
  return { owner, order };
}

describe("POSM distribution", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads the files, breaks every region down by TSM, records shipments and exports Excel", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    expect(await importEquipmentFile(owner, await equipmentWorkbook())).toEqual({
      rows: 23,
      units: 24,
      stock: 2,
      skipped: 1,
      unknown: ["Fridge"],
    });
    expect(await importOutletBase(owner, await outletBaseWorkbook())).toEqual({
      outlets: 24,
      withTsm: 14,
      units: 23,
      unitsWithTsm: 14,
    });
    const order = await createOrder(
      owner,
      { name: "Заказ (тест)", orderedOn: "2026-10-01" },
      await posmWorkbook(),
    );

    let d = await loadDistribution(order.id);
    expect(d.order?.id).toBe(order.id);
    expect(d.includeStock).toBe(true);
    expect(d.regions.get("Tashkent")).toEqual({ POSI_L: 12, DG_C: 4 });
    expect(d.regions.get("Test Town")).toEqual({ POSI_L: 6, MW24_S: 2, POSI_MOD: 2 });
    // Tashkent's TSMs come from the base; Test Town's from the equipment file.
    expect(d.destinations).toEqual([
      "Tashkent",
      "Test Town",
      "Tashkent · TSM_TEST_1",
      "Tashkent · TSM_TEST_2",
      "Test Town · TSM_TOWN_1",
    ]);
    const shelf = d.plans.find((p) => p.item.name === "Shelftalker (тест)")!;
    expect(shelf.byRegion.get("Tashkent")).toBe(12);
    expect(shelf.byTsm.get("Tashkent · TSM_TEST_1")).toBe(7);
    expect(shelf.byTsm.get("Test Town · TSM_TOWN_1")).toBe(4);
    expect(shelf.tsmRest.get("Tashkent")).toBe(2);
    expect(shelf.tsmRest.get("Test Town")).toBe(2);
    expect(d.findings.map((f) => f.key)).toEqual(expect.arrayContaining(["gap", "noTsm"]));

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
    d = await loadDistribution(order.id);
    expect(d.stock.find((s) => s.item.id === shelf.item.id)).toMatchObject({
      shipped: 11,
      onHand: 8,
    });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await distributionXlsx(d)) as unknown as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining(["Распределение", "Разбивка по TSM", "Склад", "Накладная Test Town"]),
    );
    const waybill = book.getWorksheet("Накладная Test Town")!;
    expect(waybill.getRow(1).values).toContain("TSM_TOWN_1");

    // A new equipment file and base keep the order and its shipments.
    await importEquipmentFile(owner, await equipmentWorkbook());
    await importOutletBase(owner, await outletBaseWorkbook());
    expect(await db.distShipment.count()).toBe(2);
    expect(await db.distUnit.count()).toBe(23);
  });

  it("keeps old orders as versions", async () => {
    const { owner, order } = await setUp();
    let d = await loadDistribution(order.id);
    const shelf = d.items.find((i) => i.name === "Shelftalker (тест)")!;
    await addShipment(
      owner,
      { posmId: shelf.id, destination: "Test Town", quantity: 6, shippedOn: "2026-10-02" },
      d.destinations,
    );

    // The next order copies the items; what is left of the old one becomes its stock.
    await setOrderClosed(owner, order.id, true);
    const next = await createOrder(
      owner,
      { name: "Заказ 2 (тест)", orderedOn: "2026-10-20", copyFrom: order.id },
      null,
    );
    d = await loadDistribution(next.id);
    expect(d.items).toHaveLength(3);
    expect(d.items.find((i) => i.name === "Shelftalker (тест)")).toMatchObject({
      inStock: 13,
      ordered: 0,
      norm: 1,
    });
    expect(d.shipments).toHaveLength(0);

    // The closed order keeps its shipments and takes no new ones.
    const old = await loadDistribution(order.id);
    expect(old.order?.closed).toBe(true);
    expect(old.shipments).toHaveLength(1);
    await expect(
      addShipment(
        owner,
        { posmId: shelf.id, destination: "Test Town", quantity: 1, shippedOn: "2026-10-21" },
        old.destinations,
      ),
    ).rejects.toMatchObject({ code: "closed" });
    await expect(importPosmList(owner, order.id, await posmWorkbook())).rejects.toMatchObject({
      code: "closed",
    });

    // A refreshed list updates the open order by name.
    expect(await importPosmList(owner, next.id, await posmWorkbook())).toBe(3);
    expect(
      (await loadDistribution(next.id)).items.find((i) => i.name === "Shelftalker (тест)"),
    ).toMatchObject({ inStock: 0, ordered: 19 });

    // An order or item with shipments can't be deleted; an empty one can.
    await expect(deleteOrder(owner, order.id)).rejects.toMatchObject({ code: "hasShipments" });
    const tag = d.items.find((i) => i.name.startsWith("Ценник"))!;
    await deletePosm(owner, tag.id);
    expect((await loadDistribution(next.id)).items).toHaveLength(2);
    await deleteOrder(owner, next.id);
    expect(await db.distOrder.count()).toBe(1);

    // Without an order picked, the pages show the latest open one, else the latest.
    expect((await loadDistribution()).order?.id).toBe(order.id);
  });

  it("everyone with the section records shipments; settings, orders and uploads are for managers", async () => {
    const { owner, order } = await setUp();
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: { modules: ["distribution"], taskScope: "own" },
    });
    const member = await withAccess(await createTestUser("MEMBER"));
    const other = await withAccess(await createTestUser("MEMBER"));
    const d = await loadDistribution(order.id);
    const item = d.items[0]!;

    await expect(importEquipmentFile(member, await equipmentWorkbook())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(importOutletBase(member, await outletBaseWorkbook())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      createOrder(member, { name: "x", orderedOn: "2026-10-01" }, await posmWorkbook()),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(setOrderClosed(member, order.id, true)).rejects.toMatchObject({
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
