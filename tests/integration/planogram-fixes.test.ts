// @vitest-environment node
import { rm } from "node:fs/promises";

import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as publicImage } from "@/app/p/[token]/img/[kind]/[id]/route";
import { db } from "@/lib/db";
import { planogramIdsForProject } from "@/modules/planograms/export";
import { slotKey } from "@/modules/planograms/geometry";
import { readSpreadsheet } from "@/modules/planograms/import";
import { posmInUse, saveEquipment, saveImage, savePosm } from "@/modules/planograms/library";
import { adaptPlanogram, insertSkuEverywhere } from "@/modules/planograms/mass";
import { applyPriceList, createPriceList, previewPriceList } from "@/modules/planograms/pricing";
import { loadPlanogram } from "@/modules/planograms/repository";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import {
  approvePlanogram,
  archivePlanogram,
  copyPlanogram,
  createPlanogram,
  currentPriceList,
  findByShareToken,
  planogramCards,
  saveLayout,
  submitForApproval,
  validateStored,
} from "@/modules/planograms/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const meta = {
  channel: "POSI",
  project: "Проект (тест)",
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

async function approvedPog(owner: Awaited<ReturnType<typeof setup>>["owner"], title = "POG") {
  const pog = await createPlanogram(owner, {
    ...meta,
    title,
    equipmentId: (await equipment("POG_MINI")).id,
    fill: "auto",
  });
  await approvePlanogram(owner, pog.id);
  return pog;
}

const png = async (color: string) => {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 60, height: 20, channels: 3, background: color } })
    .png()
    .toBuffer();
};

afterAll(() => rm(".test-uploads", { recursive: true, force: true }));

describe("price lists", () => {
  beforeEach(resetDb);

  it("applying again doesn't make a second version of a planogram left a draft", async () => {
    const { owner } = await setup();
    await approvedPog(owner);
    // A SKU not on the planogram becomes mandatory: its new version can't be approved.
    const extra = await db.sku.create({
      data: { code: "SKU-TEST-900", brand: "ESSE", name: "Новый обязательный (тест)" },
    });
    await db.sku.update({ where: { id: extra.id }, data: { isMandatory: true } });
    const { list } = await createPriceList(
      owner,
      { name: "Повышение (тест)", effectiveFrom: "2030-01-01" },
      [{ code: "SKU-TEST-001", price: 33000 }],
    );
    expect(await previewPriceList(list.id)).toHaveLength(1);
    const first = await applyPriceList(owner, list.id);
    expect(first.drafts).toHaveLength(1);
    // The draft on this list counts as done: nothing to offer, nothing made twice.
    expect(await previewPriceList(list.id)).toEqual([]);
    expect((await applyPriceList(owner, list.id)).created).toEqual([]);
    expect(await db.planogram.count({ where: { priceListId: list.id } })).toBe(1);
  }, 60_000);

  it("reads formula and rich-text cells and reports rows it can't read", async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet("Цены");
    ws.addRow(["Код", "Цена"]);
    ws.addRow([
      { richText: [{ text: "SKU-TEST-" }, { text: "001" }] },
      { formula: "30000+3000", result: 33000 },
    ]);
    ws.addRow(["SKU-TEST-002", { formula: "A1*2" }]);
    ws.addRow(["SKU-TEST-003", "дорого"]);
    ws.addRow([null, 25000]);
    ws.addRow(["SKU-TEST-004", null]);
    const file = new File([new Uint8Array(await book.xlsx.writeBuffer())], "prices.xlsx");
    const { rows, unread } = await readSpreadsheet(file);
    expect(rows.find((r) => r.code === "SKU-TEST-001")).toMatchObject({ price: 33000 });
    expect(rows.find((r) => r.code === "SKU-TEST-004")?.price).toBeUndefined();
    expect(unread).toEqual([
      { line: 3, code: "SKU-TEST-002", problem: "price" },
      { line: 4, code: "SKU-TEST-003", problem: "price" },
      { line: 5, code: "", problem: "code" },
    ]);
  });

  it("a new planogram takes the applied list in force today, not a later one", async () => {
    const { owner } = await setup();
    const seeded = (await db.priceList.findFirstOrThrow()).id;
    expect((await currentPriceList("2026-11-08"))?.id).toBe(seeded);
    const { list: later } = await createPriceList(
      owner,
      { name: "С января (тест)", effectiveFrom: "2031-01-01" },
      [{ code: "SKU-TEST-001", price: 40000 }],
    );
    await db.priceList.update({ where: { id: seeded }, data: { appliedAt: new Date() } });
    await db.priceList.update({ where: { id: later.id }, data: { appliedAt: new Date() } });
    expect((await currentPriceList("2030-06-01"))?.id).toBe(seeded);
    expect((await currentPriceList("2031-01-01"))?.id).toBe(later.id);
    // The form's empty choice means no list on purpose.
    const none = await createPlanogram(owner, {
      ...meta,
      title: "Без цен",
      equipmentId: (await equipment("POG_MINI")).id,
      defaultPriceList: false,
    });
    expect(none.priceListId).toBeNull();
  });
});

describe("mandatory SKUs", () => {
  beforeEach(resetDb);

  it("an archived SKU still marked mandatory doesn't block approval", async () => {
    const { owner } = await setup();
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    await db.sku.create({
      data: {
        code: "SKU-TEST-901",
        brand: "ESSE",
        name: "Снят с продажи (тест)",
        isMandatory: true,
        archived: true,
      },
    });
    const loaded = (await loadPlanogram(pog.id))!;
    expect((await validateStored(loaded)).filter((v) => v.kind === "MANDATORY_SKUS")).toEqual([]);
    await approvePlanogram(owner, pog.id);
  });

  it("a model's own list replaces the global marks", async () => {
    const { owner } = await setup();
    const pogModel = await equipment("POG_MINI");
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG",
      equipmentId: pogModel.id,
    });
    const one = await skuByCode("SKU-TEST-003");
    await saveEquipment(owner, pogModel.id, {
      code: pogModel.code,
      name: pogModel.name,
      channel: pogModel.channel,
      geometry: pogModel.geometry as never,
      distTypes: [],
      mandatorySkuIds: [one.id, "no-such-sku"],
    });
    expect((await equipment("POG_MINI")).mandatorySkuIds).toEqual([one.id]);
    await saveLayout(
      owner,
      pog.id,
      { [slotKey(0, 0)]: { kind: "SKU", skuId: one.id, badges: [] } },
      null,
    );
    const mandatory = (await validateStored((await loadPlanogram(pog.id))!)).filter(
      (v) => v.kind === "MANDATORY_SKUS",
    );
    // Only SKU-TEST-003 is mandatory here, and it stands: the 9 global ones don't apply.
    expect(mandatory).toEqual([]);
  });
});

describe("the merchandiser link", () => {
  beforeEach(resetDb);

  it("serves the shelftalker pictures and says when nothing is in force", async () => {
    const { owner } = await setup();
    const model = await equipment("MODULE_9x2");
    await db.equipment.update({
      where: { id: model.id },
      data: {
        geometry: {
          header: null,
          shelves: [
            { slots: 9, offset: 0, group: 3, talker: true },
            { slots: 9, offset: 0, group: 3 },
          ],
        },
      },
    });
    const talker = await savePosm(owner, null, {
      name: "Полоса (тест)",
      type: "SHELFTALKER",
      slotSpan: 1,
      color: "#ff0000",
    });
    await saveImage(
      owner,
      "posm",
      talker.id,
      new File([new Uint8Array(await png("#ff0000"))], "talker.png", { type: "image/png" }),
    );
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "Модуль",
      equipmentId: model.id,
      fill: "auto",
    });
    const loaded = (await loadPlanogram(pog.id))!;
    await saveLayout(owner, pog.id, loaded.layout, null, { 0: talker.id });
    await approvePlanogram(owner, pog.id);
    const token = (await db.planogram.findUniqueOrThrow({ where: { id: pog.id } })).shareToken!;

    const response = await publicImage(
      new Request(`http://localhost/p/${token}/img/posm/${talker.id}`),
      {
        params: Promise.resolve({ token, kind: "posm", id: talker.id }),
      },
    );
    expect(response.status).toBe(200);

    expect((await findByShareToken(token))?.inForce).toBe(true);
    await archivePlanogram(owner, pog.id);
    expect((await findByShareToken(token))?.inForce).toBe(false);
  }, 60_000);
});

describe("lists and exports", () => {
  beforeEach(resetDb);

  it("one card per planogram; the project file has only the versions in force", async () => {
    const { owner } = await setup();
    const a = await approvedPog(owner, "Альфа");
    const draft = await copyPlanogram(owner, a.id);
    await approvedPog(owner, "Бета");
    const template = await copyPlanogram(owner, a.id, {
      asNew: true,
      isTemplate: true,
      title: "Шаблон",
    });
    await db.planogram.update({ where: { id: template.id }, data: { project: "Шаблоны (тест)" } });

    const cards = await planogramCards();
    expect(cards.map((c) => c.title).sort()).toEqual(["Альфа", "Бета"]);
    const alpha = cards.find((c) => c.title === "Альфа")!;
    expect(alpha).toMatchObject({ id: a.id, status: "APPROVED" });
    expect(alpha.working).toEqual([{ id: draft.id, version: 2, status: "DRAFT" }]);
    expect((await planogramCards({ query: "бет" })).map((c) => c.title)).toEqual(["Бета"]);

    const ids = await planogramIdsForProject("Проект (тест)");
    expect(ids.sort()).toEqual([a.id, cards.find((c) => c.title === "Бета")!.id].sort());
  }, 60_000);
});

describe("library and mass operations", () => {
  beforeEach(resetDb);

  it("a POSM's size is locked while approved planograms use it", async () => {
    const { owner } = await setup();
    const sticker = (await db.posm.findFirstOrThrow({ where: { name: "ENDI 1MG" } }))!;
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "POG",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    const layout = (await loadPlanogram(pog.id))!.layout;
    layout[slotKey(0, 0)] = { kind: "POSM", posmId: sticker.id, span: 2, rows: 1 };
    delete layout[slotKey(0, 1)];
    await saveLayout(owner, pog.id, layout, null);
    const input = { name: sticker.name, type: sticker.type, color: sticker.color };
    // A draft doesn't lock it.
    await savePosm(owner, sticker.id, { ...input, slotSpan: 2, shelfSpan: 1 });
    await submitForApproval(owner, pog.id);
    expect(await posmInUse(sticker.id)).toBe(1);
    await expect(
      savePosm(owner, sticker.id, { ...input, slotSpan: 3, shelfSpan: 1 }),
    ).rejects.toMatchObject({ code: "posmInUse" });
    // Other fields still change.
    await savePosm(owner, sticker.id, { ...input, color: "#000000", slotSpan: 2, shelfSpan: 1 });
  });

  it("adapting keeps the title, header and shelftalkers it can; insert reports packs pushed off", async () => {
    const { owner } = await setup();
    const header = (await db.posm.findFirstOrThrow({ where: { type: "HEADER" } }))!;
    const pog = await createPlanogram(owner, {
      ...meta,
      title: "Display L (тест)",
      equipmentId: (await equipment("DISPLAY_L")).id,
      fill: "auto",
    });
    const loaded = (await loadPlanogram(pog.id))!;
    await saveLayout(owner, pog.id, loaded.layout, header.id);
    const { planogram, dropped } = await adaptPlanogram(
      owner,
      pog.id,
      (await equipment("DISPLAY_M")).id,
    );
    const adapted = (await loadPlanogram(planogram.id))!;
    expect(adapted.record.title).toBe("Display L (тест)");
    expect(adapted.record.headerPosmId).toBe(header.id);
    expect(dropped).toEqual([]);
    // The order on each shelf stays: the first 6 places of shelf 1 are as on Display L.
    for (let p = 0; p < 6; p++)
      expect(adapted.layout[slotKey(0, p)]).toEqual(loaded.layout[slotKey(0, p)]);
    // Without a header place, none is carried over.
    const onModule = await adaptPlanogram(owner, pog.id, (await equipment("MODULE_9x2")).id);
    expect((await loadPlanogram(onModule.planogram.id))!.record.headerPosmId).toBeNull();

    const pogMini = await approvedPog(owner);
    const fresh = await db.sku.create({
      data: { code: "SKU-TEST-902", brand: "ESSE", name: "Новинка (тест)", isNew: true },
    });
    const last = (await loadPlanogram(pogMini.id))!.layout[slotKey(0, 17)];
    const inserted = await insertSkuEverywhere(
      owner,
      (await equipment("POG_MINI")).id,
      fresh.id,
      0,
      0,
    );
    expect(inserted.pushedOff).toEqual([
      {
        planogramId: inserted.created[0],
        title: "POG",
        skuId: (last as { skuId: string }).skuId,
      },
    ]);
  }, 60_000);

  it("editing a version waiting for approval tells the approver it is back in draft", async () => {
    const { owner, member } = await setup();
    const pog = await createPlanogram(member, {
      ...meta,
      title: "POG",
      equipmentId: (await equipment("POG_MINI")).id,
      fill: "auto",
    });
    expect(await submitForApproval(member, pog.id)).toHaveLength(1);
    const before = await db.notification.count({ where: { userId: owner.id } });
    await saveLayout(member, pog.id, (await loadPlanogram(pog.id))!.layout, null);
    expect((await db.planogram.findUniqueOrThrow({ where: { id: pog.id } })).status).toBe("DRAFT");
    expect(await db.notification.count({ where: { userId: owner.id } })).toBe(before + 1);
  });
});
