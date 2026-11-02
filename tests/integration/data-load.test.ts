import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { importConnectRows } from "@/modules/connect/service";
import { withAccess } from "@/modules/core/access/actor";
import { loadPlanogramBundle, type PlanogramBundle } from "@/modules/planograms/bulk-load";
import { loadPlanogram } from "@/modules/planograms/repository";
import { createTestUser, resetDb } from "@/tests/helpers/db";

async function pixel() {
  const png = await sharp({
    create: { width: 4, height: 6, channels: 3, background: "#1d4ed8" },
  })
    .png()
    .toBuffer();
  return png.toString("base64");
}

describe("data-load: a whole planogram library and Connect rows at once", () => {
  beforeEach(resetDb);

  it("creates equipment, SKUs with pictures, POSM, prices and a draft planogram; a repeat changes nothing", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const image = await pixel();
    const bundle: PlanogramBundle = {
      equipment: [
        {
          code: "TEST_DISPLAY",
          name: "Тестовый дисплей",
          channel: "POSI",
          geometry: {
            header: "horizontal",
            shelves: [
              { slots: 3, offset: 0, group: 0 },
              { slots: 3, offset: 0, group: 0 },
            ],
          },
        },
      ],
      skus: [
        { code: "SKU-TEST-001", brand: "ESSE", name: "Тестовая пачка 1", isNew: true, image },
        { code: "SKU-TEST-002", brand: "PINE", name: "Тестовая пачка 2", priceStyle: "MING" },
      ],
      posm: [
        { name: "Тестовый хедер", type: "HEADER", slotSpan: 1, image },
        { name: "Тестовый баннер", type: "BANNER", slotSpan: 3 },
      ],
      priceList: {
        name: "Тестовые цены",
        effectiveFrom: "2026-11-02",
        prices: { "SKU-TEST-001": 28000, "SKU-TEST-002": 19000 },
      },
      planograms: [
        {
          title: "Тестовая планограмма",
          equipment: "TEST_DISPLAY",
          channel: "POSI",
          header: "Тестовый хедер",
          notes: "Тестовая заметка",
          slots: [
            { shelf: 0, position: 0, sku: "SKU-TEST-001", badges: ["YANGI", "1mg"] },
            { shelf: 0, position: 1, sku: "SKU-TEST-002" },
            { shelf: 0, position: 2 },
            { shelf: 1, position: 0, posm: "Тестовый баннер" },
          ],
        },
      ],
    };

    expect(await loadPlanogramBundle(owner, bundle)).toEqual([
      "equipment: 1",
      "skus: 2",
      "posm: 2",
      "planograms created: 1",
    ]);
    const sku = await db.sku.findUniqueOrThrow({ where: { code: "SKU-TEST-001" } });
    expect(sku.imagePath).toMatch(/\.png$/);
    const planogram = await db.planogram.findFirstOrThrow({
      where: { title: "Тестовая планограмма" },
    });
    const loaded = await loadPlanogram(planogram.id);
    expect(loaded?.record.status).toBe("DRAFT");
    expect(loaded?.record.headerPosm?.name).toBe("Тестовый хедер");
    expect(loaded?.layout["0:0"]).toEqual({ kind: "SKU", skuId: sku.id, badges: ["YANGI", "1mg"] });
    expect(loaded?.layout["0:2"]).toEqual({ kind: "EMPTY" });
    expect(loaded?.layout["1:0"]).toMatchObject({ kind: "POSM", span: 3 });
    const prices = await db.skuPrice.findMany({ where: { priceListId: planogram.priceListId! } });
    expect(prices.map((p) => p.price).sort()).toEqual([19000, 28000]);

    // Loading again keeps the planogram and adds nothing.
    expect(await loadPlanogramBundle(owner, bundle)).toContain("kept as is: Тестовая планограмма");
    expect(await db.planogram.count()).toBe(1);
    expect(await db.sku.count()).toBe(2);
    expect(await db.priceList.count()).toBe(1);
  });

  it("adds shelftalkers to a model in use and to its drafts that have none", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const image = await pixel();
    await loadPlanogramBundle(owner, {
      equipment: [
        {
          code: "TEST_DISPLAY",
          name: "Тестовый дисплей",
          channel: "POSI",
          geometry: {
            header: "horizontal",
            shelves: [
              { slots: 2, offset: 0, group: 0 },
              { slots: 2, offset: 0, group: 0 },
            ],
          },
        },
      ],
      planograms: [
        { title: "Тестовая планограмма", equipment: "TEST_DISPLAY", channel: "POSI", slots: [] },
      ],
    });
    const talkers: PlanogramBundle = {
      posm: [
        { name: "Тестовый шелфтокер 1", type: "SHELFTALKER", slotSpan: 1, image },
        { name: "Тестовый шелфтокер 2", type: "SHELFTALKER", slotSpan: 1 },
      ],
      shelftalkers: [{ equipment: "TEST_DISPLAY", shelves: { "1": "Тестовый шелфтокер 1" } }],
    };
    expect(await loadPlanogramBundle(owner, talkers)).toContain(
      "shelftalkers TEST_DISPLAY: shelves 1, planograms 1 of 1",
    );
    const equipment = await db.equipment.findUniqueOrThrow({ where: { code: "TEST_DISPLAY" } });
    expect(
      (equipment.geometry as { shelves: { talker?: boolean }[] }).shelves.map((s) => !!s.talker),
    ).toEqual([false, true]);
    const first = await db.posm.findFirstOrThrow({ where: { name: "Тестовый шелфтокер 1" } });
    const planogram = await db.planogram.findFirstOrThrow();
    expect(planogram.shelftalkers).toEqual({ "1": first.id });

    // Shelftalkers chosen already stay.
    talkers.shelftalkers = [
      { equipment: "TEST_DISPLAY", shelves: { "1": "Тестовый шелфтокер 2" } },
    ];
    expect(await loadPlanogramBundle(owner, talkers)).toContain(
      "shelftalkers TEST_DISPLAY: shelves 1, planograms 0 of 1",
    );
    expect((await db.planogram.findFirstOrThrow()).shelftalkers).toEqual({ "1": first.id });

    // With overwrite every planogram of the model gets them.
    talkers.shelftalkers = [
      { equipment: "TEST_DISPLAY", shelves: { "1": "Тестовый шелфтокер 2" }, overwrite: true },
    ];
    expect(await loadPlanogramBundle(owner, talkers)).toContain(
      "shelftalkers TEST_DISPLAY: shelves 1, planograms 1 of 1",
    );
    const second = await db.posm.findFirstOrThrow({ where: { name: "Тестовый шелфтокер 2" } });
    expect((await db.planogram.findFirstOrThrow()).shelftalkers).toEqual({ "1": second.id });
  });

  it("fills a new planogram from the SKU list when asked", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await loadPlanogramBundle(owner, {
      equipment: [
        {
          code: "TEST_POG",
          name: "Тестовый POG",
          channel: "POSI",
          geometry: { header: null, shelves: [{ slots: 4, offset: 0, group: 0 }] },
        },
      ],
      skus: [
        { code: "SKU-TEST-001", brand: "ESSE", name: "Тестовая пачка 1" },
        { code: "SKU-TEST-002", brand: "PINE", name: "Тестовая пачка 2" },
      ],
      planograms: [{ title: "Тестовый POG", equipment: "TEST_POG", channel: "POSI", fill: "auto" }],
    });
    const planogram = await db.planogram.findFirstOrThrow({ where: { title: "Тестовый POG" } });
    const loaded = await loadPlanogram(planogram.id);
    expect(Object.values(loaded!.layout).filter((c) => c.kind === "SKU")).toHaveLength(4);
  });

  it("saves Connect rows sent as parsed records", async () => {
    const owner = await createTestUser("OWNER");
    const record = {
      id: "1",
      storeCode: "101",
      storeName: "Тестовый магазин",
      city: "Тестоград",
      channel: "Retail",
      at: "2026-10-05T10:00",
      day: "2026-10-05",
      month: "2026-10",
      person: "TSM_TEST_1 - Тестовый сотрудник",
      missing: 1,
      low: 0,
      orderCreated: false,
      orderNo: null,
      delivery: null,
      skus: { "SKU-TEST-001": "OUT" as const },
    };
    expect(await importConnectRows(owner.id, "Тест", [{ kind: "OOS", record }])).toEqual([
      { kind: "OOS", created: 1, updated: 0, skipped: 0 },
    ]);
    expect(await importConnectRows(owner.id, "Тест", [{ kind: "OOS", record }])).toEqual([
      { kind: "OOS", created: 0, updated: 1, skipped: 0 },
    ]);
  });
});
