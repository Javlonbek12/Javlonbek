// @vitest-environment node
import { rm } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { exportPdf, exportPptx, planogramPng } from "@/modules/planograms/export";
import { importSkus, parseCsv, parseSpreadsheet } from "@/modules/planograms/import";
import { saveEquipment, saveImage } from "@/modules/planograms/library";
import {
  adaptPlanogram,
  insertSkuEverywhere,
  replaceSkuEverywhere,
} from "@/modules/planograms/mass";
import { applyPriceList, createPriceList, previewPriceList } from "@/modules/planograms/pricing";
import { loadPlanogram } from "@/modules/planograms/repository";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import {
  approvePlanogram,
  changesVsPrevious,
  copyPlanogram,
  createPlanogram,
  findByShareToken,
  saveLayout,
  submitForApproval,
  validateStored,
} from "@/modules/planograms/service";
import { slotKey } from "@/modules/planograms/geometry";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const meta = {
  channel: "POSI",
  project: "Тестовый проект",
  validFrom: null,
  validTo: null,
  priceListId: null,
  notes: null,
};
const equipment = (code: string) => db.equipment.findUniqueOrThrow({ where: { code } });
const skuByCode = (code: string) => db.sku.findUniqueOrThrow({ where: { code } });

async function setup() {
  await resetDb();
  const owner = await createTestUser("OWNER");
  const member = await createTestUser("MEMBER");
  await seedPlanogramLibrary();
  return { owner, member };
}

afterAll(() => rm(".test-uploads", { recursive: true, force: true }));

describe("planogram lifecycle (stage 7 «done» scenario)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("build → mandatory-SKU violation blocks approval → fix → approve → export PPTX and PDF", async () => {
    const { owner } = await setup();
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG MINI POSI",
      equipmentId: (await equipment("POG_MINI")).id,
    });

    // Two SKUs only: 7 of 9 mandatory SKUs are missing, plus undecided cells.
    const layout = {
      [slotKey(0, 0)]: {
        kind: "SKU" as const,
        skuId: (await skuByCode("SKU-TEST-001")).id,
        badges: [],
      },
      [slotKey(0, 1)]: {
        kind: "SKU" as const,
        skuId: (await skuByCode("SKU-TEST-002")).id,
        badges: ["YANGI", "1mg"],
      },
    };
    const violations = await saveLayout(owner, pog.id, layout, null);
    const mandatory = violations.find((v) => v.kind === "MANDATORY_SKUS")!;
    expect(mandatory).toMatchObject({ severity: "CRITICAL", params: { count: 7, total: 9 } });
    await submitForApproval(owner, pog.id);
    await expect(approvePlanogram(owner, pog.id)).rejects.toMatchObject({ code: "critical" });

    // Autofill a fresh one: no critical violations, approval works and gives a public link.
    const good = await createPlanogram(owner, {
      ...meta,
      title: "POG MINI POSI",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    expect(
      (await validateStored((await loadPlanogram(good.id))!)).filter(
        (v) => v.severity === "CRITICAL",
      ),
    ).toEqual([]);
    await approvePlanogram(owner, good.id);
    const approved = await db.planogram.findUniqueOrThrow({ where: { id: good.id } });
    expect(approved.status).toBe("APPROVED");
    expect(await findByShareToken(approved.shareToken!)).not.toBeNull();

    // After a new version is approved, the old link shows the new version.
    const next = await copyPlanogram(owner, good.id);
    await approvePlanogram(owner, next.id);
    expect((await findByShareToken(approved.shareToken!))?.record.id).toBe(next.id);

    const pptx = await exportPptx([good.id]);
    expect(pptx.subarray(0, 2).toString()).toBe("PK"); // a zip (PowerPoint) file
    const pdf = await exportPdf([good.id]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const png = await planogramPng((await loadPlanogram(good.id))!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);

  it("a MEMBER can't create or approve planograms", async () => {
    const { member } = await setup();
    await expect(
      createPlanogram(member, {
        ...meta,
        title: "x",
        equipmentId: (await equipment("POG_MINI")).id,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("new price list → preview → new versions of all approved planograms; old versions keep old prices", async () => {
    const { owner } = await setup();
    const a = await createPlanogram(owner, {
      ...meta,
      title: "A",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    const b = await createPlanogram(owner, {
      ...meta,
      title: "B",
      equipmentId: (await equipment("DISPLAY_L")).id,
      fill: "auto",
    });
    await approvePlanogram(owner, a.id);
    await approvePlanogram(owner, b.id);

    const { list, unknown } = await createPriceList(
      owner,
      { name: "Повышение (тест)", effectiveFrom: "2026-11-01" },
      [
        { code: "SKU-TEST-001", price: 33000 },
        { code: "NO-SUCH", price: 1 },
      ],
    );
    expect(unknown).toEqual(["NO-SUCH"]);
    // Unchanged prices are carried over from the previous list.
    expect(await db.skuPrice.count({ where: { priceListId: list.id } })).toBe(18);

    const preview = await previewPriceList(list.id);
    expect(preview.map((p) => p.title).sort()).toEqual(["A", "B"]);
    const sku1 = await skuByCode("SKU-TEST-001");
    expect(preview[0].changes).toEqual([{ skuId: sku1.id, from: 31000, to: 33000 }]);

    const created = await applyPriceList(owner, list.id);
    expect(created).toHaveLength(2);
    const newA = (await loadPlanogram(created[0]))!;
    expect(newA.record).toMatchObject({ status: "APPROVED", version: 2, priceListId: list.id });
    expect(newA.prices.get(sku1.id)).toBe(33000);
    const oldA = (await loadPlanogram(a.id))!;
    expect(oldA.record.status).toBe("ARCHIVED");
    expect(oldA.prices.get(sku1.id)).toBe(31000);
    // The automatic change list shows the new price tag.
    expect(await changesVsPrevious(newA)).toEqual([
      { type: "price", itemType: "SKU", id: sku1.id, from: 31000, to: 33000 },
    ]);
    // Applying again changes nothing.
    expect(await previewPriceList(list.id)).toEqual([]);
  }, 60_000);

  it("mass operations: replace a SKU, add a new item, adapt to other equipment", async () => {
    const { owner } = await setup();
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    await approvePlanogram(owner, pog.id);
    const [from, to] = [await skuByCode("SKU-TEST-003"), await skuByCode("SKU-TEST-005")];

    const replaced = await replaceSkuEverywhere(owner, from.id, to.id);
    expect(replaced).toHaveLength(1);
    const version = (await loadPlanogram(replaced[0]))!;
    expect(version.record.status).toBe("PENDING_APPROVAL");
    expect(Object.values(version.layout).some((c) => c.kind === "SKU" && c.skuId === from.id)).toBe(
      false,
    );

    const fresh = await db.sku.create({
      data: { code: "SKU-TEST-NEW", brand: "ESSE", name: "ESSE Новинка (тест)", isNew: true },
    });
    const inserted = await insertSkuEverywhere(
      owner,
      (await equipment("POG_MINI")).id,
      fresh.id,
      0,
      0,
    );
    expect(inserted.created).toHaveLength(1);
    expect((await loadPlanogram(inserted.created[0]))!.layout["0:0"]).toEqual({
      kind: "SKU",
      skuId: fresh.id,
      badges: ["YANGI"],
    });

    const { planogram } = await adaptPlanogram(owner, pog.id, (await equipment("LEGO_21")).id);
    const adapted = (await loadPlanogram(planogram.id))!;
    expect(adapted.record).toMatchObject({ channel: "DG", version: 1, status: "DRAFT" });
    expect((await validateStored(adapted)).filter((v) => v.kind === "MANDATORY_SKUS")).toEqual([]);
  }, 60_000);

  it("templates and versions", async () => {
    const { owner } = await setup();
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    const template = await copyPlanogram(owner, pog.id, {
      asNew: true,
      isTemplate: true,
      title: "Шаблон POG",
    });
    const fromTemplate = await createPlanogram(owner, {
      ...meta,
      title: "Из шаблона",
      equipmentId: (await equipment("POG_MINI")).id,
      templateId: template.id,
    });
    expect((await loadPlanogram(fromTemplate.id))!.layout).toEqual(
      (await loadPlanogram(pog.id))!.layout,
    );
    await expect(approvePlanogram(owner, template.id)).rejects.toMatchObject({ code: "invalid" });

    await approvePlanogram(owner, pog.id);
    const v2 = await copyPlanogram(owner, pog.id);
    expect(v2).toMatchObject({
      version: 2,
      status: "DRAFT",
      previousVersionId: pog.id,
      rootId: pog.id,
    });
    // Approved versions are not edited in place.
    await expect(saveLayout(owner, pog.id, {}, null)).rejects.toMatchObject({ code: "notDraft" });
  });

  it("equipment shape can't change once it has planograms", async () => {
    const { owner } = await setup();
    const e = await equipment("POG_MINI");
    await createPlanogram(owner, { ...meta, title: "POG", equipmentId: e.id });
    await expect(
      saveEquipment(owner, e.id, {
        code: e.code,
        name: e.name,
        channel: e.channel,
        geometry: { header: null, shelves: [{ slots: 5 }] },
      }),
    ).rejects.toMatchObject({ code: "inUse" });
  });
});

describe("library import and pictures", () => {
  it("parses CSV with ; and quotes, Russian headers", () => {
    expect(parseCsv('код;бренд;название;цена\nSKU-1;ESSE;"ESSE ""Тест""";31 000\n')).toEqual([
      ["код", "бренд", "название", "цена"],
      ["SKU-1", "ESSE", 'ESSE "Тест"', "31 000"],
    ]);
  });

  it("imports SKUs from a file and stores a pack picture", async () => {
    const { owner } = await setup();
    const csv = new File(
      [
        "code,brand,name,mandatory\nSKU-TEST-001,ESSE,Переименован (тест),да\nSKU-TEST-100,PINE,PINE Новый (тест),нет\nSKU-X,,,",
      ],
      "skus.csv",
    );
    const rows = await parseSpreadsheet(csv);
    expect(await importSkus(owner, rows)).toEqual({ created: 1, updated: 1, skipped: ["SKU-X"] });
    expect((await skuByCode("SKU-TEST-001")).name).toBe("Переименован (тест)");

    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 40, height: 80, channels: 3, background: "#1d4ed8" },
    })
      .png()
      .toBuffer();
    const sku = await skuByCode("SKU-TEST-100");
    await saveImage(
      owner,
      "sku",
      sku.id,
      new File([new Uint8Array(png)], "pack.png", { type: "image/png" }),
    );
    const saved = await skuByCode("SKU-TEST-100");
    expect(saved.imagePath).toMatch(/^planograms\/sku\//);
    // The 3D sides take the picture's edge colour.
    expect(saved.sideColor).toBe("#1d4ed8");
    await expect(
      saveImage(owner, "sku", sku.id, new File(["not an image"], "x.png")),
    ).rejects.toMatchObject({ code: "badFile" });
  });
});
