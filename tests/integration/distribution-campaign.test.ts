import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import {
  createCampaign,
  importReplacement,
  loadCampaign,
  makeList,
  plannedOutlets,
  replacementXlsx,
  saveComposition,
  savePrices,
  setOrdered,
  updateConcept,
} from "@/modules/distribution/campaign";
import { buildEas, easData, easHtml, saveEas } from "@/modules/distribution/eas";
import {
  addElement,
  catalogXlsx,
  importCatalogFile,
  loadCatalog,
  saveElementSizes,
} from "@/modules/distribution/catalog";
import {
  importEquipmentFile,
  importOutletBase,
  loadDistribution,
} from "@/modules/distribution/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { equipmentWorkbook, outletBaseWorkbook } from "@/tests/helpers/distribution";

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

describe("a POSM campaign", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("goes from the concept to the replacement in the shops", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: { modules: ["distribution"], taskScope: "own" },
    });
    const member = await withAccess(await createTestUser("MEMBER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    await importOutletBase(owner, await outletBaseWorkbook());
    const header = await addElement(owner, "Header (тест)", "PVC");
    await saveElementSizes(owner, header.id, {
      name: "Header (тест)",
      material: "PVC",
      sizes: [size("POSI_L"), size("DG_C", { heightMm: 150, widthMm: 700, price: null })],
    });

    // 1–2. Concept.
    const c = await createCampaign(owner, { name: "Pine Purple (тест)" });
    await expect(createCampaign(member, { name: "x" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await updateConcept(owner, c.id, {
      name: "Pine Purple 4 SKU (тест)",
      description: "Новые SKU",
      projectId: null,
      approved: true,
    });

    // 3–4. Header on POSI L and DG C, 2 per DG C; +10 % reserve; equipment with stock.
    await saveComposition(owner, c.id, {
      reservePct: 0.1,
      withStock: true,
      elements: [{ elementId: header.id, types: ["POSI_L", "DG_C"], perUnit: { DG_C: 2 } }],
    });
    // 5. POSI L: 16 installed + 2 in stock = 18 × 1 × 1.1 → 20; DG C 4 × 2 × 1.1 → 9.
    expect(await makeList(owner, c.id)).toBe(2);
    let campaign = (await loadCampaign(c.id))!;
    expect(campaign.items.map((i) => [i.types, i.ordered, i.price, i.size])).toEqual([
      [["POSI_L"], 20, 25000, "200×640"],
      [["DG_C"], 9, null, "150×700"],
    ]);
    expect(campaign.steps).toMatchObject({ concept: true, composition: true, list: true });

    // 6. The printer's prices: a new one for DG C, the old one confirmed for POSI L.
    const [posi, dg] = campaign.items;
    expect(
      await savePrices(owner, c.id, {
        prices: [
          { posmId: posi!.id, price: 25000 },
          { posmId: dg!.id, price: 31000 },
        ],
        confirm: [posi!.id, dg!.id],
        supplier: "Типография (тест)",
        quoteNo: "КП-1",
        quotedOn: "2026-11-01",
      }),
    ).toBe(2);
    campaign = (await loadCampaign(c.id))!;
    expect(campaign.steps.prices).toBe(true);
    expect(campaign.total).toBe(20 * 25000 + 9 * 31000);
    // The confirmed price is in the catalog for the next campaign, with its history.
    const catalog = await loadCatalog();
    expect(
      catalog.elements.find((e) => e.id === header.id)!.sizes.find((s) => s.type === "DG_C")!.price,
    ).toBe(31000);
    expect(await db.distPriceQuote.count({ where: { supplier: "Типография (тест)" } })).toBe(2);

    // 7. Ordered: the list is fixed.
    await setOrdered(owner, c.id, "2026-11-02");
    await expect(makeList(owner, c.id)).rejects.toMatchObject({ code: "ordered" });

    // 8. The split by region: the reserve stays central.
    const d = await loadDistribution(c.id);
    const plan = d.plans.find((p) => p.item.id === posi!.id)!;
    expect(plan.toShip).toBe(18);
    expect(plan.central).toBe(2);

    // 9. Replacement: the outlets with POSI L or DG C, marked from a file.
    const outlets = await plannedOutlets(c.id);
    expect(outlets).toHaveLength(20);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await replacementXlsx(outlets)) as unknown as ArrayBuffer);
    const ws = book.worksheets[0]!;
    ws.getRow(2).getCell(5).value = "да";
    ws.getRow(3).getCell(5).value = "нет";
    ws.addRow(["999", "", "", "", "да"]);
    const filled = Buffer.from(await book.xlsx.writeBuffer());
    expect(await importReplacement(member, c.id, filled)).toEqual({
      rows: 3,
      replaced: 2,
      unknown: 1,
    });
    campaign = (await loadCampaign(c.id))!;
    expect(campaign.replacement.total).toMatchObject({ planned: 20, replaced: 1, notYet: 19 });
    const tashkent = campaign.replacement.tsms.get("Tashkent")!;
    expect([...tashkent.keys()]).toEqual(["TSM_TEST_1", "TSM_TEST_2"]);
  });

  it("fills the catalog from Excel", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await addElement(owner, "Header (тест)", "PVC");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await catalogXlsx(await loadCatalog(), true)) as unknown as ArrayBuffer);
    book.getWorksheet("Размеры POSM")!.eachRow((row, n) => {
      if (n === 1 || row.getCell(2).value !== "POSI_L") return;
      row.getCell(5).value = 200;
      row.getCell(6).value = 640;
      row.getCell(7).value = 1;
      row.getCell(8).value = 25000;
    });
    book.getWorksheet("Оборудование")!.addRow(["POSI_MOD", "Display MOD", 1200, 600, 400]);
    expect(await importCatalogFile(owner, Buffer.from(await book.xlsx.writeBuffer()))).toEqual({
      sizes: 1,
      types: 1,
    });
  });
});

describe("the EAS document", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is filled from the campaign and keeps the budget fields for the next one", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    await importEquipmentFile(owner, await equipmentWorkbook());
    const header = await addElement(owner, "Header (тест)", "PVC");
    await saveElementSizes(owner, header.id, {
      name: "Header (тест)",
      material: "PVC",
      sizes: [size("POSI_L")],
    });
    const c = await createCampaign(owner, { name: "Pine (тест)", description: "Запуск" });
    await saveComposition(owner, c.id, {
      reservePct: 0.1,
      withStock: true,
      elements: [{ elementId: header.id, types: ["POSI_L"], perUnit: {} }],
    });
    await makeList(owner, c.id);
    let campaign = (await loadCampaign(c.id))!;
    const data = await easData(campaign);
    expect(data.background).toBe("Запуск");
    await saveEas(owner, c.id, {
      ...data,
      account: "0000 (тест)",
      monthlyBudget: 1_000_000,
      purpose: "Первый пункт\nВторой пункт",
      groupPurpose: { "Header (тест)": "Заметность <SKU>" },
      suppliers: [
        { name: "Типография А", legalName: "ООО А (тест)", total: null },
        { name: "Типография Б", legalName: "", total: 600_000 },
      ],
      recommended: "Типография А",
    });
    campaign = (await loadCampaign(c.id))!;
    const doc = buildEas(campaign, await easData(campaign));
    // 20 × 25 000 = 500 000.
    expect(doc.requested).toBe(500_000);
    expect(doc.budget).toContainEqual(["Remaining budget amount", "500 000"]);
    expect(doc.purpose).toEqual(["Первый пункт", "Второй пункт"]);
    expect(doc.comparison).toEqual([
      { name: "Типография А", total: 500_000, diff: 0, pct: 0 },
      { name: "Типография Б", total: 600_000, diff: 100_000, pct: 0.2 },
    ]);
    expect(doc.finalRequest).toContain('"Типография А" (ООО А (тест))');
    const html = easHtml(doc);
    expect(html).toContain("Заметность &lt;SKU&gt;");
    expect(html).not.toContain("<SKU>");

    // A new campaign starts from these budget fields.
    const next = await createCampaign(owner, { name: "Следующая (тест)" });
    const fresh = await easData((await loadCampaign(next.id))!);
    expect(fresh).toMatchObject({ account: "0000 (тест)", monthlyBudget: 1_000_000, purpose: "" });
  });
});
