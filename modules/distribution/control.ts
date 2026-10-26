import { db } from "@/lib/db";

import { sortRegions, TYPE_CODES, type DistType } from "./types";

// The control equation of each equipment type: bought (the purchase journal, entered by hand) =
// installed (rows of «BW management») + in stock («Current stock») + unaccounted. Unaccounted is
// never entered: it is what is left. A small plus is normal (in transit, written off); a large
// plus means something did not reach the warehouse count; a minus is an error in the file
// (duplicate rows, dismantled equipment still listed). Display MOD is counted in 18-slot units
// everywhere, as the equipment file itself does.

export type ControlTone = "ok" | "warn" | "bad" | "none";

export type ControlRow = {
  type: DistType;
  // null: nothing bought is entered for the type.
  purchased: number | null;
  installed: number;
  stock: number;
  unaccounted: number | null;
  tone: ControlTone;
};

// A plus above this share of what was bought (and above one unit) is «large».
export const LARGE_SHARE = 0.05;
const EPS = 0.01;

export function controlTone(purchased: number | null, unaccounted: number | null): ControlTone {
  if (purchased === null || unaccounted === null) return "none";
  if (unaccounted < -EPS) return "bad";
  if (unaccounted > Math.max(1, purchased * LARGE_SHARE)) return "warn";
  return "ok";
}

export function controlRows(
  purchased: Partial<Record<string, number>>,
  installed: Partial<Record<string, number>>,
  stock: Partial<Record<string, number>>,
): ControlRow[] {
  return TYPE_CODES.flatMap((type) => {
    const p = purchased[type] ?? null;
    const i = installed[type] ?? 0;
    const s = stock[type] ?? 0;
    if (p === null && !i && !s) return [];
    const unaccounted = p === null ? null : p - i - s;
    return [
      {
        type,
        purchased: p,
        installed: i,
        stock: s,
        unaccounted,
        tone: controlTone(p, unaccounted),
      },
    ];
  });
}

export function controlTotal(rows: ControlRow[]) {
  const known = rows.filter((r) => r.purchased !== null);
  return {
    purchased: known.length ? known.reduce((s, r) => s + r.purchased!, 0) : null,
    installed: rows.reduce((s, r) => s + r.installed, 0),
    stock: rows.reduce((s, r) => s + r.stock, 0),
    unaccounted: known.length ? known.reduce((s, r) => s + r.unaccounted!, 0) : null,
  };
}

export const hasMinus = (rows: ControlRow[]) => rows.some((r) => r.tone === "bad");

export async function purchasedByType(): Promise<Record<string, number>> {
  const rows = await db.distPurchase.groupBy({ by: ["type"], _sum: { quantity: true } });
  return Object.fromEntries(rows.map((r) => [r.type, r._sum.quantity ?? 0]));
}

export async function stockByType(): Promise<Record<string, number>> {
  const rows = await db.distEquipmentCount.groupBy({
    by: ["type"],
    where: { kind: "STOCK", tsm: "" },
    _sum: { count: true },
  });
  return Object.fromEntries(rows.map((r) => [r.type, r._sum.count ?? 0]));
}

// The control table on what is loaded now.
export async function equipmentControl() {
  const [purchased, installed, stock] = await Promise.all([
    purchasedByType(),
    db.distUnit.groupBy({ by: ["type"], _sum: { units: true } }),
    stockByType(),
  ]);
  const rows = controlRows(
    purchased,
    Object.fromEntries(installed.map((r) => [r.type, r._sum.units ?? 0])),
    stock,
  );
  return { rows, total: controlTotal(rows) };
}

// ——— Outlets: new, without an ID, skipped, region mismatches ———

export type OutletRow = {
  key: string;
  outletId: string;
  posName: string;
  tin: string;
  region: string;
  types: string[];
  units: number;
  firstSeen: Date | null;
};

const sortOutlets = (rows: OutletRow[]) => {
  const order = sortRegions(rows.map((r) => r.region));
  return rows.sort(
    (a, b) =>
      order.indexOf(a.region) - order.indexOf(b.region) ||
      a.key.localeCompare(b.key, "ru", { numeric: true }),
  );
};

export async function outletReview() {
  const [missing, noId, mismatches, skipped] = await Promise.all([
    // In the file with a Smartup ID the outlet base does not have: installed, «TSM не назначен».
    db.$queryRaw<OutletRow[]>`
      SELECT u."outletId" AS "key", u."outletId", MAX(u."posName") AS "posName",
             MAX(u."tin") AS "tin", MIN(u."region") AS "region",
             ARRAY_AGG(DISTINCT u."type") AS "types", SUM(u."units")::float8 AS "units",
             MIN(s."firstSeen") AS "firstSeen"
      FROM "DistUnit" u
      LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
      LEFT JOIN "DistSeenOutlet" s ON s."outletId" = u."outletId"
      WHERE u."outletId" <> '' AND o."outletId" IS NULL
      GROUP BY u."outletId"`,
    // Without an ID: known by region + TIN (or name); counted, no TSM.
    db.$queryRaw<OutletRow[]>`
      SELECT u."outletKey" AS "key", '' AS "outletId", MAX(u."posName") AS "posName",
             MAX(u."tin") AS "tin", MIN(u."region") AS "region",
             ARRAY_AGG(DISTINCT u."type") AS "types", SUM(u."units")::float8 AS "units",
             NULL::timestamp AS "firstSeen"
      FROM "DistUnit" u
      WHERE u."outletId" = ''
      GROUP BY u."outletKey"`,
    // The base puts the outlet in another region than the file (the file wins).
    db.$queryRaw<{ outletId: string; fileRegion: string; baseRegion: string; posName: string }[]>`
      SELECT u."outletId", MIN(u."region") AS "fileRegion", MIN(o."region") AS "baseRegion",
             MAX(u."posName") AS "posName"
      FROM "DistUnit" u JOIN "DistOutlet" o ON o."outletId" = u."outletId"
      WHERE u."outletId" <> '' AND o."region" IS NOT NULL AND NOT (u."region" = ANY(string_to_array(o."region", ', ')))
      GROUP BY u."outletId"`,
    db.distSkippedRow.findMany({ orderBy: { row: "asc" } }),
  ]);
  return {
    missing: sortOutlets(missing),
    noId: sortOutlets(noId),
    mismatches: mismatches.sort((a, b) =>
      a.outletId.localeCompare(b.outletId, "ru", { numeric: true }),
    ),
    skipped,
  };
}

// Outlets of the equipment file that are not in the outlet base (with an ID).
export async function outletsMissingFromBase(): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(DISTINCT u."outletId")::int AS "n"
    FROM "DistUnit" u LEFT JOIN "DistOutlet" o ON o."outletId" = u."outletId"
    WHERE u."outletId" <> '' AND o."outletId" IS NULL`;
  return row?.n ?? 0;
}
