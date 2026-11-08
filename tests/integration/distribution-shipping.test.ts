import { beforeEach, describe, expect, it } from "vitest";

import { withAccess } from "@/modules/core/access/actor";
import {
  createCampaign,
  makeList,
  saveComposition,
  setOrdered,
} from "@/modules/distribution/campaign";
import { addElement, saveElementSizes } from "@/modules/distribution/catalog";
import { shippingRows } from "@/modules/distribution/compute";
import {
  currentOrder,
  importEquipmentFile,
  importOutletBase,
  listOrders,
  loadDistribution,
  loadWaybill,
  orderStageOf,
  setOrderClosed,
  shipWaybill,
  waybillsTo,
} from "@/modules/distribution/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { equipmentWorkbook, outletBaseWorkbook } from "@/tests/helpers/distribution";

async function setUp() {
  await resetDb();
  const owner = await withAccess(await createTestUser("OWNER"));
  await importEquipmentFile(owner, await equipmentWorkbook());
  await importOutletBase(owner, await outletBaseWorkbook());
  const header = await addElement(owner, "Header (тест)", "PVC");
  await saveElementSizes(owner, header.id, {
    name: "Header (тест)",
    material: "PVC",
    sizes: ["POSI_L", "DG_C"].map((type) => ({
      type,
      heightMm: 200,
      widthMm: 640,
      perUnit: 1,
      price: 25000,
      material: null,
      note: null,
    })),
  });
  const campaign = async (name: string) => {
    const c = await createCampaign(owner, { name });
    await saveComposition(owner, c.id, {
      reservePct: 0.1,
      reserveByType: {},
      withStock: true,
      elements: [{ elementId: header.id, types: ["POSI_L", "DG_C"], perUnit: {} }],
    });
    await makeList(owner, c.id);
    return c;
  };
  return { owner, campaign };
}

describe("distribution shipments", () => {
  beforeEach(resetDb);

  it("opens the running campaign, not a draft; a draft only when nothing was ordered", async () => {
    const { owner, campaign } = await setUp();
    const running = await campaign("Идёт (тест)");
    expect((await currentOrder())?.id).toBe(running.id);
    await setOrdered(owner, running.id, "2026-10-20");
    // A newer draft sorts after the running campaign; a closed one goes last.
    const draft = await campaign("Черновик (тест)");
    const old = await campaign("Старая (тест)");
    await setOrdered(owner, old.id, "2026-09-01");
    await setOrderClosed(owner, old.id, true);
    const orders = await listOrders();
    expect(orders.map((o) => [o.id, orderStageOf(o)])).toEqual([
      [running.id, "running"],
      [draft.id, "draft"],
      [old.id, "closed"],
    ]);
    expect((await currentOrder(orders))?.id).toBe(running.id);
  });

  it("a waybill can send less than is left; each gets the next number", async () => {
    const { owner, campaign } = await setUp();
    const c = await campaign("Кампания (тест)");
    await setOrdered(owner, c.id, "2026-11-02");
    let d = await loadDistribution(c.id);
    const posi = d.plans[0]!;
    // The region with the biggest share.
    const [region, share] = [...posi.byRegion].sort((a, b) => b[1] - a[1])[0]!;
    expect(share).toBeGreaterThan(1);

    // Part now: only that is recorded, the rest stays to send.
    const first = await shipWaybill(
      owner,
      region,
      [{ posmId: posi.item.id, quantity: 1 }],
      "2026-11-04",
      d,
    );
    expect(first.count).toBe(1);
    d = await loadDistribution(c.id);
    const town = shippingRows(d.plans, d.shipments, d.destinations).find(
      (r) => r.destination === region,
    )!;
    expect(town).toMatchObject({ shipped: 1, status: "partial", over: false });

    // The rest: the next number; the document has the campaign, the date and the lines.
    const second = await shipWaybill(
      owner,
      region,
      d.plans.map((p) => ({ posmId: p.item.id, quantity: 10_000 })),
      "2026-11-05",
      d,
    );
    expect(second.waybill).toBe(first.waybill! + 1);
    const doc = await loadWaybill(second.waybill!);
    expect(doc).toMatchObject({
      destination: region,
      campaign: "Кампания (тест)",
      lines: expect.arrayContaining([
        expect.objectContaining({ name: posi.item.name, quantity: share - 1 }),
      ]),
    });
    expect((await waybillsTo(region, c.id)).map((w) => w.number)).toEqual([
      second.waybill,
      first.waybill,
    ]);
    d = await loadDistribution(c.id);
    expect(
      shippingRows(d.plans, d.shipments, d.destinations).find((r) => r.destination === region),
    ).toMatchObject({ left: 0, status: "done" });
  });
});
