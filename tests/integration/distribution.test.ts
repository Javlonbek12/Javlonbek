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
  pendingImport,
  planogramFacts,
  resolvePendingImport,
  updatePosmSettings,
} from "@/modules/distribution/service";
import { equipmentOverview, regionEquipment } from "@/modules/distribution/equipment";
import { equipmentControl, outletReview } from "@/modules/distribution/control";
import { addPurchase, deletePurchase } from "@/modules/distribution/purchases";
import { importLaunchTemplate } from "@/modules/distribution/template";
import { NO_TSM } from "@/modules/distribution/types";
import { distributionXlsx } from "@/modules/distribution/xlsx";
import { saveEquipment } from "@/modules/planograms/library";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import {
  equipmentWorkbook,
  launchTemplateWorkbook,
  outletBaseWorkbook,
  posmWorkbook,
} from "@/tests/helpers/distribution";

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
    expect(await importEquipmentFile(owner, await equipmentWorkbook())).toMatchObject({
      status: "saved",
      rows: 23,
      units: 24,
      stock: 2,
      skipped: 1,
      noId: 0,
    });
    expect(await importOutletBase(owner, await outletBaseWorkbook())).toEqual({
      outlets: 24,
      withTsm: 14,
      units: 23,
      unitsWithTsm: 14,
      missing: 0,
      mismatched: 0,
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
    // TSMs come from the base only: Test Town's outlets have none there (the file's «Responsible»
    // column is not used), so they are «TSM не назначен».
    expect(d.destinations).toEqual([
      "Tashkent",
      "Test Town",
      "Tashkent · TSM_TEST_1",
      "Tashkent · TSM_TEST_2",
      `Test Town · ${NO_TSM}`,
    ]);
    const shelf = d.plans.find((p) => p.item.name === "Shelftalker (тест)")!;
    expect(shelf.byRegion.get("Tashkent")).toBe(12);
    expect(shelf.byTsm.get("Tashkent · TSM_TEST_1")).toBe(7);
    expect(shelf.byTsm.get(`Test Town · ${NO_TSM}`)).toBe(6);
    expect(shelf.tsmRest.get("Tashkent")).toBe(2);
    expect(shelf.tsmRest.get("Test Town")).toBe(0);
    expect(d.findings.map((f) => f.key)).toEqual(expect.arrayContaining(["gap", "noTsm"]));

    // A waybill for Test Town, then one line for a TSM.
    expect(
      await shipWaybill(
        owner,
        "Test Town",
        [{ posmId: shelf.item.id, quantity: 6 }],
        "2026-10-26",
        d,
      ),
    ).toMatchObject({ count: 1 });
    await addShipment(
      owner,
      {
        posmId: shelf.item.id,
        destination: "Tashkent · TSM_TEST_1",
        quantity: 5,
        shippedOn: "2026-10-26",
      },
      d,
    );
    await expect(
      addShipment(
        owner,
        { posmId: shelf.item.id, destination: "Nowhere", quantity: 5, shippedOn: "2026-10-26" },
        d,
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
    expect(waybill.getRow(1).values).toContain(NO_TSM);

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
      d,
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
        old,
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
      d,
    );
    // Someone else's record: only its author or a manager deletes it.
    await expect(deleteShipment(other, shipment!.id)).rejects.toMatchObject({ code: "forbidden" });
    await deleteShipment(member, shipment!.id);

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

describe("the equipment section", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("counts equipment by region, type and TSM", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    await importOutletBase(owner, await outletBaseWorkbook());
    const o = await equipmentOverview();
    expect(o.regions.map((r) => [r.region, r.installedTotal, r.stockTotal, r.outlets])).toEqual([
      ["Tashkent", 14, 2, 14],
      ["Test Town", 10, 0, 9],
    ]);
    expect(o.installedByType).toMatchObject({ POSI_L: 16, DG_C: 4, MW24_S: 2, POSI_MOD: 2 });
    expect(o.outletsByType.POSI_L).toBe(16);
    expect(o.outlets).toBe(23);
    const tashkent = await regionEquipment("Tashkent");
    expect(tashkent.tsms.map((t) => [t.tsm, t.outlets, t.units])).toEqual([
      ["TSM_TEST_1", 8, { POSI_L: 7, DG_C: 1 }],
      ["TSM_TEST_2", 6, { POSI_L: 3, DG_C: 3 }],
    ]);
    expect(tashkent.stock).toEqual({ POSI_L: 2 });
  });

  it("checks the control equation, holds a file with a minus, and lists new outlets", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    await importOutletBase(owner, await outletBaseWorkbook());
    // Bought: 18 POSI L (16 installed + 2 in stock → 0 unaccounted), 3 DG C (4 installed → −1).
    await addPurchase(owner, {
      types: ["POSI_L"],
      quantity: 20,
      date: "2026-01-10",
      document: "Накладная №1 (тест)",
    });
    const correction = await addPurchase(owner, {
      types: ["POSI_L"],
      quantity: -2,
      date: "2026-02-01",
      document: "Исправление (тест)",
    });
    await addPurchase(owner, { types: ["DG_C"], quantity: 3, date: "2026-01-10", document: "№2" });
    await expect(
      addPurchase(member, { types: ["DG_C"], quantity: 1, date: "2026-01-10", document: "№3" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addPurchase(owner, { types: ["NO_SUCH"], quantity: 1, date: "2026-01-10", document: "№3" }),
    ).rejects.toMatchObject({ code: "invalid" });

    // A minus: the file waits for a confirmation, nothing is saved.
    const held = await importEquipmentFile(owner, await equipmentWorkbook());
    expect(held.status).toBe("pending");
    expect(await db.distUnit.count()).toBe(0);
    const pending = await pendingImport(held.status === "pending" ? held.id : "");
    expect(pending?.control.find((r) => r.types.join() === "DG_C")).toMatchObject({
      purchased: 3,
      installed: 4,
      unaccounted: -1,
      tone: "bad",
    });
    expect(await resolvePendingImport(owner, pending!.id, true)).toMatchObject({ rows: 23 });
    expect(await db.distPendingImport.count()).toBe(0);
    const control = await equipmentControl();
    expect(control.rows.find((r) => r.types.join() === "POSI_L")).toMatchObject({
      purchased: 18,
      installed: 16,
      stock: 2,
      unaccounted: 0,
      tone: "ok",
    });

    // Once the purchase is right, the same file goes straight in; the journal is untouched.
    await addPurchase(owner, { types: ["DG_C"], quantity: 1, date: "2026-03-01", document: "№4" });
    await deletePurchase(owner, correction.id);
    const extra = await importEquipmentFile(owner, await equipmentWorkbook({ extra: true }));
    expect(extra).toMatchObject({ status: "saved", rows: 25, skipped: 2, noId: 1 });
    expect(await db.distPurchase.count()).toBe(3);
    // 20 bought − 18 installed − 2 in stock = 0 (outlet 15 and the row without an ID count).
    expect(
      (await equipmentControl()).rows.find((r) => r.types.join() === "POSI_L")?.unaccounted,
    ).toBe(0);

    // Outlet 15 is not in the base: installed, «TSM не назначен»; the TIN row has no TSM either.
    const review = await outletReview();
    expect(review.missing.map((o) => [o.outletId, o.region, o.posName])).toEqual([
      ["15", "Tashkent", "Точка 15"],
    ]);
    expect(review.missing[0]!.firstSeen).toBeInstanceOf(Date);
    expect(review.noId.map((o) => [o.key, o.tin, o.units])).toEqual([
      ["Test Town|tin:300000001", "300000001", 1],
    ]);
    expect(review.skipped.map((r) => r.reason)).toEqual(["unknownType", "noIdentity"]);
    const tashkent = await regionEquipment("Tashkent");
    expect(tashkent.tsms.map((t) => [t.tsm, t.outlets])).toEqual([
      ["TSM_TEST_1", 8],
      ["TSM_TEST_2", 6],
      [NO_TSM, 1],
    ]);
    const d = await loadDistribution();
    expect(d.regions.get("Test Town")).toMatchObject({ POSI_L: 7 });

    // The base: how many outlets of the file it lacks, and region mismatches (shown, not used).
    const base = await importOutletBase(owner, await outletBaseWorkbook());
    expect(base).toMatchObject({ missing: 1, mismatched: 0 });
  });

  it("takes a launch template into the purchase journal and the size catalog", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    const input = { fileName: "POSM_test.xlsx", date: "2026-06-28" };
    await expect(
      importLaunchTemplate(member, await launchTemplateWorkbook(), input),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      importLaunchTemplate(owner, await equipmentWorkbook(), input),
    ).rejects.toMatchObject({ code: "noTemplate" });

    const r = await importLaunchTemplate(owner, await launchTemplateWorkbook(), input);
    expect(r).toMatchObject({ launch: "Тестовый запуск", purchases: 3, bought: 36 });
    // Again: the file's purchases are replaced, not doubled.
    await importLaunchTemplate(owner, await launchTemplateWorkbook(), input);
    expect(await db.distPurchase.count()).toBe(3);
    const control = await equipmentControl();
    expect(control.rows.find((row) => row.types.length === 3)).toMatchObject({
      types: ["DG_L", "MW25_L", "MW24_L"],
      purchased: 20,
      installed: 0,
    });
    const shelf = await db.distElement.findUnique({
      where: { name: "Shelftalker №3" },
      include: { sizes: true },
    });
    expect(shelf?.sizes.map((x) => [x.type, x.widthMm, x.verified]).sort()).toEqual([
      ["DG_L", 310, true],
      ["MW24_L", 310, true],
      ["MW25_L", 310, true],
    ]);
  });

  it("links a planogram model to the equipment file's types, one model per type", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const geometry = { header: null, shelves: [{ slots: 10, offset: 0, group: 0 }] };
    const a = await saveEquipment(owner, null, {
      code: "TEST_L",
      name: "Тест L",
      channel: "MW/DG",
      geometry,
      distTypes: ["DG_L", "MW25_L"],
    });
    const b = await saveEquipment(owner, null, {
      code: "TEST_L2",
      name: "Тест L2",
      channel: "MW/DG",
      geometry,
      distTypes: ["MW25_L", "MW24_L"],
    });
    // MW-25 L moved to the second model.
    expect((await db.equipment.findUnique({ where: { id: a.id } }))?.distTypes).toEqual(["DG_L"]);
    expect((await db.equipment.findUnique({ where: { id: b.id } }))?.distTypes).toEqual([
      "MW25_L",
      "MW24_L",
    ]);
    const { links } = await planogramFacts();
    expect(links.find((l) => l.type === "DG_L")?.equipmentCode).toBe("TEST_L");
    expect(links.find((l) => l.type === "MW24_L")?.equipmentCode).toBe("TEST_L2");
    expect(links.find((l) => l.type === "POSI_L")?.equipmentCode).toBeNull();
    await expect(
      saveEquipment(owner, null, {
        code: "TEST_X",
        name: "X",
        channel: "X",
        geometry,
        distTypes: ["NO_SUCH"],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
