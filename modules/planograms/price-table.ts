import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { toDateString, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { PriceLabelStyle } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canManagePlanograms } from "./access";
import { PlanogramError } from "./errors";
import { priceListStatus } from "./price-status";
import { createPriceList } from "./pricing";
import { currentPriceList } from "./service";

// Prices of every SKU in one table (Planograms → Price lists): the prices in force today (with the
// next price where a later list changes it), or one chosen list next to the list before it. The
// same table is downloaded as an Excel template, filled in and uploaded back, or edited on the page.

// A later list's price for a SKU: from its date, or once it is applied (`waiting`: its date has
// come, but planograms still carry the prices in force).
export type FuturePrice = { from: string; price: number; waiting: boolean };

export type PriceTableRow = {
  skuId: string;
  code: string;
  brand: string;
  name: string;
  format: string | null;
  priceStyle: PriceLabelStyle;
  price: number | null;
  // The price in the list before this one (to show what changed).
  previous: number | null;
  // Only in the table of prices in force: the next price a later list sets.
  future: FuturePrice | null;
};

const ORDER = [{ effectiveFrom: "desc" as const }, { createdAt: "desc" as const }];

// The list that was current just before this one.
async function listBefore(list: { id: string; effectiveFrom: Date; createdAt: Date }) {
  return db.priceList.findFirst({
    where: {
      id: { not: list.id },
      OR: [
        { effectiveFrom: { lt: list.effectiveFrom } },
        { effectiveFrom: list.effectiveFrom, createdAt: { lt: list.createdAt } },
      ],
    },
    orderBy: ORDER,
    include: { prices: true },
  });
}

// The prices in force today (the list new planograms get) and, by SKU, the first later price
// that differs from it. A list dated ahead must never pass for the current price.
export async function currentPrices(today = todayInTimezone(getEnv().DEFAULT_TIMEZONE)) {
  const inForce = await currentPriceList(today);
  const [list, later] = await Promise.all([
    inForce
      ? db.priceList.findUnique({ where: { id: inForce.id }, include: { prices: true } })
      : null,
    db.priceList.findMany({
      where: inForce
        ? {
            OR: [
              { effectiveFrom: { gt: inForce.effectiveFrom } },
              { effectiveFrom: inForce.effectiveFrom, createdAt: { gt: inForce.createdAt } },
            ],
          }
        : {},
      orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
      include: { prices: true },
    }),
  ]);
  const prices = new Map(list?.prices.map((p) => [p.skuId, p.price]) ?? []);
  const future = new Map<string, FuturePrice>();
  for (const next of later) {
    const status = priceListStatus(next, inForce, today);
    for (const { skuId, price } of next.prices)
      if (!future.has(skuId) && price !== prices.get(skuId))
        future.set(skuId, {
          from: toDateString(next.effectiveFrom),
          price,
          waiting: status === "waiting",
        });
  }
  return { list, prices, future };
}

// Every SKU in use with its price: in the given list, or (by default) in force today.
export async function priceTable(listId?: string) {
  const chosen = listId
    ? await db.priceList.findUnique({ where: { id: listId }, include: { prices: true } })
    : null;
  if (listId && !chosen) throw new PlanogramError("notFound");
  const inForce = listId ? null : await currentPrices();
  const list = chosen ?? inForce?.list ?? null;
  const previous = list ? await listBefore(list) : null;
  const skus = await db.sku.findMany({
    where: { archived: false },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
  });
  const prices = new Map(list?.prices.map((p) => [p.skuId, p.price]) ?? []);
  const before = new Map(previous?.prices.map((p) => [p.skuId, p.price]) ?? []);
  const rows: PriceTableRow[] = skus.map((sku) => ({
    skuId: sku.id,
    code: sku.code,
    brand: sku.brand,
    name: sku.name,
    format: sku.format,
    priceStyle: sku.priceStyle,
    price: prices.get(sku.id) ?? null,
    previous: before.get(sku.id) ?? null,
    future: inForce?.future.get(sku.id) ?? null,
  }));
  return { list, previous, rows };
}

// The Excel template: every SKU with its price in force. The columns are the ones the upload reads
// (код, цена); brand, name and format are there to find the line.
export async function priceTemplateXlsx(): Promise<Buffer> {
  const { list, rows } = await priceTable();
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const ws = book.addWorksheet(t("planograms.library.prices.sheet"));
  ws.columns = [
    { header: "Код", key: "code", width: 18 },
    { header: "Бренд", key: "brand", width: 14 },
    { header: "Название", key: "name", width: 36 },
    { header: "Формат", key: "format", width: 12 },
    { header: "Цена", key: "price", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of rows)
    ws.addRow({
      code: row.code,
      brand: row.brand,
      name: row.name,
      format: row.format ?? "",
      price: row.price ?? undefined,
    });
  ws.getColumn("price").numFmt = "# ##0";
  const help = book.addWorksheet(t("planograms.library.prices.helpSheet"));
  help.getColumn(1).width = 100;
  for (const line of [
    t("planograms.library.prices.helpFrom", {
      list: list ? `${list.name} (${toDateString(list.effectiveFrom)})` : "—",
    }),
    t("planograms.library.prices.helpEdit"),
    t("planograms.library.prices.helpUpload"),
  ])
    help.addRow([line]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

// Prices typed on the page: SKU id → price in sum (null: the field was emptied).
export type PriceEdits = Map<string, number | null>;

// Only what really changed against the table the page showed.
function changed(rows: PriceTableRow[], edits: PriceEdits) {
  const current = new Map(rows.map((r) => [r.skuId, r]));
  const result = new Map<string, number | null>();
  for (const [skuId, price] of edits) {
    const row = current.get(skuId);
    if (!row) continue;
    const next = price === null || !Number.isFinite(price) || price <= 0 ? null : Math.round(price);
    if (next !== row.price) result.set(skuId, next);
  }
  return result;
}

// New prices from the page become a new price list, like an upload: the list in force on its date
// plus the changes (an emptied field keeps the old price there).
export async function savePricesAsNewList(
  actor: Actor,
  input: { name: string; effectiveFrom: string },
  edits: PriceEdits,
) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const { rows } = await priceTable();
  const codes = new Map(rows.map((r) => [r.skuId, r.code]));
  const changes = [...changed(rows, edits)].filter(([, price]) => price !== null);
  if (changes.length === 0) throw new PlanogramError("noChanges");
  const { list } = await createPriceList(
    actor,
    input,
    changes.map(([skuId, price]) => ({ code: codes.get(skuId)!, price: price! })),
  );
  return list;
}

// A list nobody applied yet is still being prepared: its prices are changed in place. Once it is
// applied (planograms got versions with it), changes go into a new list.
export async function updatePriceListPrices(actor: Actor, listId: string, edits: PriceEdits) {
  if (!canManagePlanograms(actor.role)) throw new PlanogramError("forbidden");
  const { list, rows } = await priceTable(listId);
  if (!list) throw new PlanogramError("notFound");
  if (list.appliedAt) throw new PlanogramError("applied");
  const changes = changed(rows, edits);
  if (changes.size === 0) throw new PlanogramError("noChanges");
  await db.$transaction(
    [...changes].map(([skuId, price]) =>
      price === null
        ? db.skuPrice.deleteMany({ where: { priceListId: listId, skuId } })
        : db.skuPrice.upsert({
            where: { priceListId_skuId: { priceListId: listId, skuId } },
            create: { priceListId: listId, skuId, price },
            update: { price },
          }),
    ),
  );
  await logActivity({
    actorId: actor.id,
    action: "price_list.edited",
    entityType: "PriceList",
    entityId: listId,
    details: { changes: changes.size },
  });
  return changes.size;
}
