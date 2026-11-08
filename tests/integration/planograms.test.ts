// @vitest-environment node
import { rm } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { exportPdf, exportPptx, planogramPng, planogramSvg } from "@/modules/planograms/export";
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
  archivePlanogram,
  changesVsPrevious,
  copyPlanogram,
  createPlanogram,
  findByShareToken,
  planogramsAwaitingApproval,
  returnToDraft,
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
    // With critical violations it is neither sent nor approved.
    await expect(submitForApproval(owner, pog.id)).rejects.toMatchObject({ code: "critical" });
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

  it("everyone builds planograms and sends them for approval; only OWNER/MANAGER approve", async () => {
    const { owner, member } = await setup();
    const pog = await createPlanogram(member, {
      ...meta,
      title: "От сотрудника (тест)",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    // Someone else's draft is approved only once its author sends it; the manager hears that.
    await expect(approvePlanogram(owner, pog.id)).rejects.toMatchObject({ code: "notDraft" });
    await submitForApproval(member, pog.id);
    expect(await db.notification.count({ where: { userId: owner.id, type: "planogram" } })).toBe(1);
    // The author takes it back without a reason; someone else's is returned only by an
    // approver, and only with the reason, which the author gets.
    await returnToDraft(member, pog.id);
    await submitForApproval(member, pog.id);
    const colleague = await createTestUser("MEMBER");
    await expect(returnToDraft(colleague, pog.id, "Не так")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(returnToDraft(owner, pog.id, "  ")).rejects.toMatchObject({ code: "reason" });
    await returnToDraft(owner, pog.id, "Добавьте новинки (тест)");
    const told = await db.notification.findFirstOrThrow({
      where: { userId: member.id, type: "planogram" },
      orderBy: { createdAt: "desc" },
    });
    expect(told.body).toContain("Добавьте новинки (тест)");
    await submitForApproval(member, pog.id);
    await expect(approvePlanogram(member, pog.id)).rejects.toMatchObject({ code: "forbidden" });
    // The decision list: what waits, who sent it — only for those who approve.
    expect(await planogramsAwaitingApproval(member)).toEqual([]);
    expect(await planogramsAwaitingApproval(owner)).toMatchObject([
      { id: pog.id, title: "От сотрудника (тест)" },
    ]);
    await expect(archivePlanogram(member, pog.id)).rejects.toMatchObject({ code: "forbidden" });
    const { list } = await createPriceList(
      member,
      { name: "От сотрудника (тест)", effectiveFrom: "2026-11-01" },
      [{ code: "SKU-TEST-001", price: 33000 }],
    );
    await expect(applyPriceList(member, list.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await db.planogram.findUniqueOrThrow({ where: { id: pog.id } })).status).toBe(
      "PENDING_APPROVAL",
    );
    // Approved: the author hears it.
    await approvePlanogram(owner, pog.id);
    expect(
      await db.notification.count({
        where: { userId: member.id, type: "planogram", title: "Планограмма утверждена" },
      }),
    ).toBe(1);
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

    // A list older than the one the planograms are on offers nothing: applying it would roll the
    // prices back.
    const { list: older } = await createPriceList(
      owner,
      { name: "Старый (тест)", effectiveFrom: "2020-01-01" },
      [{ code: "SKU-TEST-001", price: 20000 }],
    );
    expect(await previewPriceList(older.id)).toEqual([]);

    const { list, unknown } = await createPriceList(
      owner,
      { name: "Повышение (тест)", effectiveFrom: "2030-11-01" },
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

    const { created, drafts } = await applyPriceList(owner, list.id);
    expect(created).toHaveLength(2);
    expect(drafts).toEqual([]);
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

  it("keeps a shelftalker per shelf, carries it to a new version and draws it", async () => {
    const { owner } = await setup();
    const display = await equipment("DISPLAY_L");
    const geometry = display.geometry as { header: null; shelves: { slots: number }[] };
    // Shelftalkers can be set on equipment that already has planograms (no slot moves).
    const pog = await createPlanogram(owner, { ...meta, title: "Тест", equipmentId: display.id });
    await saveEquipment(owner, display.id, {
      code: display.code,
      name: display.name,
      channel: display.channel,
      geometry: {
        ...geometry,
        shelves: geometry.shelves.map((s, i) => ({ ...s, talker: i === 0 })),
      },
    });
    const talker = await db.posm.create({
      data: { name: "Шелфтокер (тест)", type: "SHELFTALKER", color: "#1d4ed8" },
    });
    await saveLayout(owner, pog.id, {}, null, { 0: talker.id });
    expect((await loadPlanogram(pog.id))!.shelftalkers).toEqual({ 0: talker.id });
    await expect(saveLayout(owner, pog.id, {}, null, { 99: talker.id })).rejects.toMatchObject({
      code: "layout",
    });
    // Its strip in its colour (the price tags stand on it).
    expect(await planogramSvg((await loadPlanogram(pog.id))!)).toMatch(
      /<rect [^>]*height="26" rx="2" fill="#1d4ed8"\/>/,
    );
    const copy = await copyPlanogram(owner, pog.id);
    expect((await loadPlanogram(copy.id))!.shelftalkers).toEqual({ 0: talker.id });
  });
});
