import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import {
  createCampaign,
  loadCampaign,
  makeList,
  saveComposition,
  setOrdered,
} from "@/modules/distribution/campaign";
import { addElement, deleteElement, saveElementSizes } from "@/modules/distribution/catalog";
import { remainder } from "@/modules/distribution/compute";
import { buildEas, easData } from "@/modules/distribution/eas";
import {
  addShipment,
  importEquipmentFile,
  importOutletBase,
  loadDistribution,
  setIncludeStock,
  shipWaybill,
} from "@/modules/distribution/service";
import { importLaunchTemplate } from "@/modules/distribution/template";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import {
  equipmentWorkbook,
  launchTemplateWorkbook,
  outletBaseWorkbook,
} from "@/tests/helpers/distribution";

const size = (type: string, over: Record<string, number | null> = {}) => ({
  type,
  heightMm: 200,
  widthMm: 640,
  perUnit: 1,
  price: 25000,
  material: null,
  note: null,
  ...over,
});

// Equipment and outlets loaded, a «Header» element on POSI L and DG C, and a campaign ordering it
// (+10 %, with the warehouses as asked).
async function setUp(withStock = true) {
  await resetDb();
  const owner = await withAccess(await createTestUser("OWNER"));
  await importEquipmentFile(owner, await equipmentWorkbook());
  await importOutletBase(owner, await outletBaseWorkbook());
  const header = await addElement(owner, "Header (тест)", "PVC");
  await saveElementSizes(owner, header.id, {
    name: "Header (тест)",
    material: "PVC",
    sizes: [size("POSI_L"), size("DG_C")],
  });
  const c = await createCampaign(owner, { name: "Кампания (тест)" });
  await saveComposition(owner, c.id, {
    reservePct: 0.1,
    reserveByType: {},
    withStock,
    elements: [{ elementId: header.id, types: ["POSI_L", "DG_C"], perUnit: {} }],
  });
  await makeList(owner, c.id);
  return { owner, header, campaign: c };
}

describe("distribution fixes", () => {
  beforeEach(resetDb);

  it("the region's waybill counts what went to its TSMs; a waybill can't be recorded twice", async () => {
    const { owner, campaign } = await setUp();
    await setOrdered(owner, campaign.id, "2026-11-02");
    let d = await loadDistribution(campaign.id);
    const posi = d.plans.find((p) => p.item.types.includes("POSI_L"))!;
    const share = posi.byRegion.get("Tashkent")!;
    const tsm = "Tashkent · TSM_TEST_1";
    const tsmPlan = posi.byTsm.get(tsm)!;
    expect(tsmPlan).toBeGreaterThan(0);
    await addShipment(
      owner,
      { posmId: posi.item.id, destination: tsm, quantity: tsmPlan, shippedOn: "2026-11-03" },
      d,
    );
    d = await loadDistribution(campaign.id);
    const plan = d.plans.find((p) => p.item.id === posi.item.id)!;
    expect(remainder(plan, "Tashkent", d.shipments)).toEqual({
      planned: share,
      shipped: 0,
      viaTsm: tsmPlan,
      toSend: share - tsmPlan,
    });

    // The page sends the whole plan; the server records only what is left, and only once.
    const line = [{ posmId: posi.item.id, quantity: share }];
    const first = await shipWaybill(owner, "Tashkent", line, "2026-11-04", d);
    expect(first.count).toBe(1);
    expect(await shipWaybill(owner, "Tashkent", line, "2026-11-04", d)).toEqual({
      count: 0,
      waybill: null,
    });
    const toRegion = await db.distShipment.findMany({
      where: { posmId: posi.item.id, destination: "Tashkent" },
    });
    expect(toRegion.map((s) => s.quantity)).toEqual([share - tsmPlan]);
    // Nothing left for the other TSM: the region took the rest of the share.
    d = await loadDistribution(campaign.id);
    expect(
      remainder(
        d.plans.find((p) => p.item.id === posi.item.id)!,
        "Tashkent · TSM_TEST_2",
        d.shipments,
      ).toSend,
    ).toBe(0);
  }, 60_000);

  it("a shipment over the plan needs «Сверх плана»; a double submit records once", async () => {
    const { owner, campaign } = await setUp();
    await setOrdered(owner, campaign.id, "2026-11-02");
    const d = await loadDistribution(campaign.id);
    const posi = d.plans.find((p) => p.item.types.includes("POSI_L"))!;
    const tsm = "Tashkent · TSM_TEST_1";
    const tsmPlan = posi.byTsm.get(tsm)!;
    const line = { posmId: posi.item.id, destination: tsm, shippedOn: "2026-11-03" };

    await expect(addShipment(owner, { ...line, quantity: tsmPlan + 1 }, d)).rejects.toMatchObject({
      code: "overPlan",
    });
    expect(await db.distShipment.count()).toBe(0);
    const over = await addShipment(owner, { ...line, quantity: tsmPlan + 1, overPlan: true }, d);
    expect(over?.quantity).toBe(tsmPlan + 1);
    // The same form sent twice in a row (a double tap, a retry): one record.
    expect(
      await addShipment(owner, { ...line, quantity: tsmPlan + 1, overPlan: true }, d),
    ).toBeNull();
    expect(await db.distShipment.count()).toBe(1);
  }, 60_000);

  it("the split follows the campaign's own «with stock» choice", async () => {
    const { owner } = await setUp(false);
    // The common setting says «with stock»; the campaign said without.
    await setIncludeStock(owner, true);
    const c = (await db.distOrder.findFirstOrThrow()).id;
    const d = await loadDistribution(c);
    expect(d.includeStock).toBe(false);
    expect(d.regions.get("Tashkent")).toMatchObject({ POSI_L: 10 });
  });

  it("an ordered campaign keeps its plan when a new equipment file comes", async () => {
    const { owner, campaign } = await setUp();
    await setOrdered(owner, campaign.id, "2026-11-02");
    const before = await loadDistribution(campaign.id);
    expect(before.frozenAt).not.toBeNull();
    const posi = before.plans.find((p) => p.item.types.includes("POSI_L"))!;

    await importEquipmentFile(owner, await equipmentWorkbook({ extra: true }));
    const after = await loadDistribution(campaign.id);
    expect(after.regions).toEqual(before.regions);
    expect(after.plans.find((p) => p.item.id === posi.item.id)!.byRegion).toEqual(posi.byRegion);

    // Undone before any shipment: planned live again, on the new file.
    await setOrdered(owner, campaign.id, null);
    const live = await loadDistribution(campaign.id);
    expect(live.frozenAt).toBeNull();
    expect(live.regions.get("Tashkent")!.POSI_L).toBe(before.regions.get("Tashkent")!.POSI_L! + 1);
  }, 60_000);

  it("an element used by a campaign can't be deleted", async () => {
    const { owner, header } = await setUp();
    await expect(deleteElement(owner, header.id)).rejects.toMatchObject({ code: "elementInUse" });
    const spare = await addElement(owner, "Запасной (тест)", "");
    await deleteElement(owner, spare.id);
    expect(await db.distElement.count()).toBe(1);
  });

  it("EAS coverage counts each equipment unit once", async () => {
    const { owner, header, campaign } = await setUp();
    const shelf = await addElement(owner, "Shelftalker (тест)", "PVC");
    await saveElementSizes(owner, shelf.id, {
      name: "Shelftalker (тест)",
      material: "PVC",
      sizes: [size("POSI_L", { heightMm: 38, widthMm: 600, price: null })],
    });
    await saveComposition(owner, campaign.id, {
      reservePct: 0.1,
      reserveByType: {},
      withStock: true,
      elements: [
        { elementId: header.id, types: ["POSI_L", "DG_C"], perUnit: {} },
        { elementId: shelf.id, types: ["POSI_L"], perUnit: {} },
      ],
    });
    await makeList(owner, campaign.id);
    const c = (await loadCampaign(campaign.id))!;
    // POSI L 16 + 2 in stock, DG C 4: 22 units, though two elements go on POSI L.
    expect(buildEas(c, await easData(c)).coverage).toMatch(/^22 equipment units/);
    expect(c.unpriced.map((i) => i.category)).toEqual(["Shelftalker (тест)"]);
  });

  it("a launch template uploaded again under another name replaces its purchases", async () => {
    const { owner } = await setUp();
    const file = await launchTemplateWorkbook();
    await importLaunchTemplate(owner, file, { fileName: "launch.xlsx", date: "2026-11-01" });
    await importLaunchTemplate(owner, file, { fileName: "launch (1).xlsx", date: "2026-11-02" });
    expect(await db.distPurchase.count()).toBe(3);
    expect(await db.distPurchase.count({ where: { document: "launch (1).xlsx" } })).toBe(3);
  });
});
