import { db } from "@/lib/db";

import { loadCatalog } from "./catalog";
import { sortRegions, TYPE_CODES } from "./types";

// The equipment section: what is installed where (from the equipment file, unit by unit), what is
// in the warehouses, in how many outlets, and each type's dimensions.

export type TypeCounts = Record<string, number>;

export type EquipmentOverview = Awaited<ReturnType<typeof equipmentOverview>>;

export async function equipmentOverview() {
  const [byRegionType, outletsByRegion, outletsByType, stockRows, legacy, catalog, outletsTotal] =
    await Promise.all([
      db.$queryRaw<{ region: string; type: string; units: number; outlets: number }[]>`
        SELECT "region", "type", SUM("units")::float8 AS "units",
               COUNT(DISTINCT "outletId")::int AS "outlets"
        FROM "DistUnit" GROUP BY 1, 2`,
      db.$queryRaw<{ region: string; outlets: number }[]>`
        SELECT "region", COUNT(DISTINCT "outletId")::int AS "outlets" FROM "DistUnit" GROUP BY 1`,
      db.$queryRaw<{ type: string; outlets: number }[]>`
        SELECT "type", COUNT(DISTINCT "outletId")::int AS "outlets" FROM "DistUnit" GROUP BY 1`,
      db.distEquipmentCount.findMany({ where: { kind: "STOCK", tsm: "" } }),
      db.distEquipmentCount.findMany({ where: { kind: "INSTALLED", tsm: "" } }),
      loadCatalog(),
      db.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT "outletId")::int AS "n" FROM "DistUnit"`,
    ]);
  // Before the first equipment file: the old counts, without outlets.
  const installedRows =
    byRegionType.length > 0
      ? byRegionType
      : legacy.map((c) => ({ region: c.region, type: c.type, units: c.count, outlets: 0 }));

  const installed = new Map<string, TypeCounts>();
  const stock = new Map<string, TypeCounts>();
  const add = (map: Map<string, TypeCounts>, region: string, type: string, n: number) => {
    const row = map.get(region) ?? {};
    row[type] = (row[type] ?? 0) + n;
    map.set(region, row);
  };
  for (const r of installedRows) add(installed, r.region, r.type, r.units);
  for (const s of stockRows) add(stock, s.region, s.type, s.count);
  const regions = sortRegions([...installed.keys(), ...stock.keys()]);
  const sum = (row: TypeCounts | undefined) => Object.values(row ?? {}).reduce((a, b) => a + b, 0);
  const byType = (map: Map<string, TypeCounts>) => {
    const out: TypeCounts = {};
    for (const row of map.values())
      for (const [t, n] of Object.entries(row)) out[t] = (out[t] ?? 0) + n;
    return out;
  };
  const outletsOfRegion = new Map(outletsByRegion.map((r) => [r.region, r.outlets]));
  const outletsOfType = new Map(outletsByType.map((r) => [r.type, r.outlets]));
  return {
    regions: regions.map((region) => ({
      region,
      installed: installed.get(region) ?? {},
      stock: stock.get(region) ?? {},
      installedTotal: sum(installed.get(region)),
      stockTotal: sum(stock.get(region)),
      outlets: outletsOfRegion.get(region) ?? 0,
    })),
    installedByType: byType(installed),
    stockByType: byType(stock),
    outletsByType: Object.fromEntries(TYPE_CODES.map((t) => [t, outletsOfType.get(t) ?? 0])),
    installedTotal: sum(byType(installed)),
    stockTotal: sum(byType(stock)),
    outlets: outletsTotal[0]?.n ?? 0,
    sizes: catalog.types,
    hasUnits: byRegionType.length > 0,
  };
}

// One region: its equipment by type and by responsible TSM (from the outlet base, else the file).
export async function regionEquipment(region: string) {
  const [rows, stock] = await Promise.all([
    db.$queryRaw<{ tsm: string; type: string; units: number; outlets: number }[]>`
      SELECT COALESCE(NULLIF(o."tsm", ''), NULLIF(u."tsm", ''), '') AS "tsm", u."type",
             SUM(u."units")::float8 AS "units", COUNT(DISTINCT u."outletId")::int AS "outlets"
      FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
      WHERE u."region" = ${region}
      GROUP BY 1, 2`,
    db.distEquipmentCount.findMany({ where: { kind: "STOCK", tsm: "", region } }),
  ]);
  const tsms = new Map<string, { units: TypeCounts; outlets: number }>();
  for (const r of rows) {
    const row = tsms.get(r.tsm) ?? { units: {}, outlets: 0 };
    row.units[r.type] = (row.units[r.type] ?? 0) + r.units;
    tsms.set(r.tsm, row);
  }
  const outletRows = await db.$queryRaw<{ tsm: string; outlets: number }[]>`
    SELECT COALESCE(NULLIF(o."tsm", ''), NULLIF(u."tsm", ''), '') AS "tsm",
           COUNT(DISTINCT u."outletId")::int AS "outlets"
    FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
    WHERE u."region" = ${region}
    GROUP BY 1`;
  for (const r of outletRows) {
    const row = tsms.get(r.tsm);
    if (row) row.outlets = r.outlets;
  }
  const names = [...tsms.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ru", { numeric: true }),
  );
  return {
    tsms: names.map((tsm) => ({ tsm, ...tsms.get(tsm)! })),
    stock: Object.fromEntries(stock.map((s) => [s.type, s.count])) as TypeCounts,
  };
}
