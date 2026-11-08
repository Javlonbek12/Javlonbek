import { rm } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import { parseSpreadsheet } from "@/modules/planograms/import";
import {
  priceTable,
  priceTemplateXlsx,
  savePricesAsNewList,
  updatePriceListPrices,
} from "@/modules/planograms/price-table";
import { applyPriceList, createPriceList, listPriceLists } from "@/modules/planograms/pricing";
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
      { name: "Со страницы (тест)", effectiveFrom: "2099-12-01" },
      edits,
    );
    const table = await priceTable(list.id);
    expect(table.rows.find((r) => r.skuId === id)).toMatchObject({
      price: before + 1000,
      previous: before,
    });
    // Dated ahead, the new list is the next price beside the one in force, not in its place.
    const now = await priceTable();
    expect(now.list?.id).not.toBe(list.id);
    expect(now.rows.find((r) => r.skuId === id)).toMatchObject({
      price: before,
      future: { from: "2099-12-01", price: before + 1000, waiting: false },
    });
  });

  it("a future list never passes for the price in force; lists say where they stand", async () => {
    const { owner } = await setup();
    const gold = await skuId("SKU-TEST-001");
    const seeded = (await db.priceList.findFirstOrThrow()).id;
    const { list: future } = await createPriceList(
      owner,
      { name: "С января (тест)", effectiveFrom: "2099-01-01" },
      [{ code: "SKU-TEST-001", price: 99000 }],
    );
    const { rows, list } = await priceTable();
    expect(list?.id).toBe(seeded);
    expect(rows.find((r) => r.skuId === gold)).toMatchObject({
      price: 31000,
      future: { from: "2099-01-01", price: 99000, waiting: false },
    });
    // A price the later list doesn't change has no «future» beside it.
    expect(rows.find((r) => r.code === "SKU-TEST-002")?.future).toBeNull();
    const statuses = new Map((await listPriceLists()).map((l) => [l.id, l.status]));
    expect(statuses.get(seeded)).toBe("current");
    expect(statuses.get(future.id)).toBe("future");

    // A list put between today and January follows today's prices, not January's.
    const { list: between } = await createPriceList(
      owner,
      { name: "С декабря (тест)", effectiveFrom: "2098-12-01" },
      [{ code: "SKU-TEST-002", price: 1000 }],
    );
    expect((await priceTable(between.id)).rows.find((r) => r.skuId === gold)?.price).toBe(31000);

    // Its date has come but nobody applied it: the planograms' prices stay, the list waits.
    const applied = await db.priceList.update({
      where: { id: seeded },
      data: { appliedAt: new Date() },
    });
    const { list: late } = await createPriceList(
      owner,
      { name: "Не применён (тест)", effectiveFrom: toDateString(applied.effectiveFrom) },
      [{ code: "SKU-TEST-001", price: 30000 }],
    );
    expect((await listPriceLists()).find((l) => l.id === late.id)?.status).toBe("waiting");
    expect((await priceTable()).rows.find((r) => r.skuId === gold)).toMatchObject({
      price: 31000,
      future: { price: 30000, waiting: true },
    });
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
