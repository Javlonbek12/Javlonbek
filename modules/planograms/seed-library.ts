import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";

import { EQUIPMENT_FIXTURES, SKU_FIXTURES } from "./fixtures";

// Test data only (obviously marked "тест"). Safe to run several times.
const POSM = [
  {
    name: "B1RINCHILAR DAVRI / ВРЕМЯ ПЕРВЫХ",
    type: "HEADER" as const,
    slotSpan: 1,
    color: "#0f172a",
  },
  { name: "QIROL QAYTDI", type: "BANNER" as const, slotSpan: 10, color: "#15803d" },
  { name: "ENDI 1MG", type: "STICKER" as const, slotSpan: 2, color: "#1e3a8a" },
  { name: "KAPSULALI YASHIL", type: "STICKER" as const, slotSpan: 2, color: "#166534" },
  { name: "BU YERDA", type: "STICKER" as const, slotSpan: 2, color: "#b45309" },
];

// Equipment, SKUs, POSM and a first price list (used by the seed and by tests).
export async function seedPlanogramLibrary() {
  for (const e of EQUIPMENT_FIXTURES) {
    await db.equipment.upsert({
      where: { code: e.code },
      create: {
        code: e.code,
        name: e.name,
        channel: e.channel,
        geometry: e.geometry as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  const skuIds = new Map<string, string>();
  for (const s of SKU_FIXTURES) {
    const sku = await db.sku.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        brand: s.brand,
        name: s.name,
        isNew: s.isNew,
        isMandatory: s.isMandatory,
        defaultBadges: s.defaultBadges,
        priceStyle: s.priceStyle,
        color: s.color,
      },
      update: {},
    });
    skuIds.set(s.code, sku.id);
  }

  for (const p of POSM) {
    if (!(await db.posm.findFirst({ where: { name: p.name } }))) await db.posm.create({ data: p });
  }

  if ((await db.priceList.count()) === 0) {
    await db.priceList.create({
      data: {
        name: "Тестовый прайс-лист",
        effectiveFrom: new Date(`${todayInTimezone(getEnv().DEFAULT_TIMEZONE)}T00:00:00Z`),
        createdById: "seed",
        prices: {
          create: SKU_FIXTURES.map((s) => ({ skuId: skuIds.get(s.code)!, price: s.price })),
        },
      },
    });
  }

  return skuIds;
}
