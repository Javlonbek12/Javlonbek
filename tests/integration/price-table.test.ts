import { rm } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { parseSpreadsheet } from "@/modules/planograms/import";
import {
  priceTable,
  priceTemplateXlsx,
  savePricesAsNewList,
  updatePriceListPrices,
} from "@/modules/planograms/price-table";
import { applyPriceList, createPriceList } from "@/modules/planograms/pricing";
import { seedPlanogramLibrary } from "@/modules/planograms/seed-library";
import { createTestUser, resetDb } from "@/tests/helpers/db";

async function setup() {
  await resetDb();
  const owner = await createTestUser("OWNER");
  const member = await createTestUser("MEMBER");
  await seedPlanogramLibrary();
  return { owner, member };
}
const skuId = async (code: string) => (await db.sku.findUniqueOrThrow({ where: { code } })).id;

afterAll(() => rm(".test-uploads", { recursive: true, force: true }));

describe("price table (Planograms → Price lists)", () => {
  beforeEach(resetDb);

  it("the template has every SKU with its latest price and comes back as a price list", async () => {
    const { owner } = await setup();
    const { rows } = await priceTable();
    expect(rows.length).toBe(await db.sku.count({ where: { archived: false } }));
    const one = rows.find((r) => r.code === "SKU-TEST-001")!;
    expect(one.price).toBe(31000);

    const file = new File([new Uint8Array(await priceTemplateXlsx())], "prices.xlsx");
    const parsed = await parseSpreadsheet(file);
    expect(parsed.find((r) => r.code === "SKU-TEST-001")).toMatchObject({ price: 31000 });
    // Every SKU is a row (one without a price too, to fill in).
    expect(parsed).toHaveLength(rows.length);

    // Changed in Excel and uploaded: a new list with that price, the rest carried over.
    const edited = parsed.map((r) => (r.code === "SKU-TEST-001" ? { ...r, price: 34000 } : r));
    const { list } = await createPriceList(
      owner,
      { name: "Из шаблона (тест)", effectiveFrom: "2026-12-01" },
      edited.filter((r) => r.price !== undefined).map((r) => ({ code: r.code, price: r.price! })),
    );
    const after = await priceTable(list.id);
    expect(after.rows.find((r) => r.code === "SKU-TEST-001")).toMatchObject({
      price: 34000,
      previous: 31000,
    });
  });

  it("prices typed on the page become a new list; only real changes count", async () => {
    const { owner, member } = await setup();
    const id = await skuId("SKU-TEST-002");
    const { rows } = await priceTable();
    const before = rows.find((r) => r.skuId === id)!.price!;
    const edits = new Map(rows.map((r) => [r.skuId, r.price]));
    await expect(
      savePricesAsNewList(owner, { name: "Без изменений", effectiveFrom: "2026-12-01" }, edits),
    ).rejects.toMatchObject({ code: "noChanges" });

    edits.set(id, before + 1000);
    const list = await savePricesAsNewList(
      member,
      { name: "Со страницы (тест)", effectiveFrom: "2026-12-01" },
      edits,
    );
    const table = await priceTable(list.id);
    expect(table.rows.find((r) => r.skuId === id)).toMatchObject({
      price: before + 1000,
      previous: before,
    });
    expect((await priceTable()).list?.id).toBe(list.id);
  });

  it("a list not applied yet is edited in place; an applied one is not", async () => {
    const { owner } = await setup();
    const id = await skuId("SKU-TEST-001");
    const { list } = await createPriceList(
      owner,
      { name: "Черновой (тест)", effectiveFrom: "2026-12-01" },
      [{ code: "SKU-TEST-001", price: 32000 }],
    );
    expect(await updatePriceListPrices(owner, list.id, new Map([[id, 32500]]))).toBe(1);
    expect((await priceTable(list.id)).rows.find((r) => r.skuId === id)?.price).toBe(32500);

    await applyPriceList(owner, list.id);
    await expect(
      updatePriceListPrices(owner, list.id, new Map([[id, 33000]])),
    ).rejects.toMatchObject({ code: "applied" });
  });
});
