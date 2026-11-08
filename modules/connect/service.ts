import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { canUseModule } from "@/modules/core/access/actor";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { isTestStore, type Dataset } from "./analytics";
import { parseWorkbook, type ParsedRow, type RecordOf } from "./parse";

type Viewer = Parameters<typeof canUseModule>[0];

// Everyone with the section sees the executor level; leadership and manager levels and
// uploading new exports are for the owner and managers.
export const canSeeConnect = (user: Viewer) => canUseModule(user, "connect");
export const canLeadConnect = (user: Viewer) =>
  (user.role === "OWNER" || user.role === "MANAGER") && canSeeConnect(user);

export class ConnectError extends Error {
  constructor(public readonly code: "forbidden" | "empty" | "unknown" | "tooBig") {
    super(code);
    this.name = "ConnectError";
  }
}

export type ConnectFilter = { from?: string; to?: string; city?: string; channel?: string };

type Row = { kind: ConnectKind; data: unknown; storeName: string; storeCode: string };

// The records of the period (months from..to, inclusive), split by kind.
export async function loadDataset(filter: ConnectFilter = {}): Promise<Dataset> {
  const rows: Row[] = await db.connectRecord.findMany({
    where: {
      month: { gte: filter.from || undefined, lte: filter.to || undefined },
      city: filter.city || undefined,
      channel: filter.channel || undefined,
    },
    select: { kind: true, data: true, storeName: true, storeCode: true },
    orderBy: { day: "asc" },
  });
  const real = rows.filter((r) => !isTestStore(r.storeName, r.storeCode));
  const of = <K extends ConnectKind>(kind: K) =>
    real.filter((r) => r.kind === kind).map((r) => r.data as RecordOf<K>);
  return { oos: of("OOS"), orders: of("ORDER"), payments: of("PAYMENT"), visits: of("VISIT") };
}

// What the filters can offer: months with data, cities and channels.
export async function connectFacets() {
  const [months, cities, channels, total] = await Promise.all([
    db.connectRecord.findMany({ distinct: ["month"], select: { month: true } }),
    db.connectRecord.findMany({ distinct: ["city"], select: { city: true } }),
    db.connectRecord.findMany({ distinct: ["channel"], select: { channel: true } }),
    db.connectRecord.count(),
  ]);
  const sorted = (values: (string | null)[]) =>
    values.filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b));
  return {
    months: sorted(months.map((m) => m.month)),
    cities: sorted(cities.map((c) => c.city)),
    channels: sorted(channels.map((c) => c.channel)),
    total,
  };
}

export async function lastImports(take = 8) {
  return db.connectImport.findMany({ orderBy: { createdAt: "desc" }, take });
}

export type ImportResult = {
  name: string;
  sheets: {
    kind: ConnectKind;
    created: number;
    updated: number;
    skipped: number;
    // Rows kept as they were: the file is older than what was loaded (`newer` = up to when).
    kept: number;
    newer: string | null;
  }[];
};

const MAX_FILE = 20 * 1024 * 1024;

// Uploads exports: rows with an ID already in the base are updated, new ones are added.
export async function importConnectFiles(
  actor: Actor,
  files: { name: string; buffer: Buffer }[],
): Promise<ImportResult[]> {
  if (!canLeadConnect(actor)) throw new ConnectError("forbidden");
  if (!files.length) throw new ConnectError("empty");
  if (files.some((f) => f.buffer.length > MAX_FILE)) throw new ConnectError("tooBig");
  const parsed = [];
  for (const file of files) {
    const sheets = await parseWorkbook(file.buffer).catch(() => []);
    if (!sheets.length) throw new ConnectError("unknown");
    parsed.push({ name: file.name, sheets });
  }
  const results: ImportResult[] = [];
  for (const file of parsed) {
    const log = await db.connectImport.create({
      data: {
        userId: actor.id,
        fileName: file.name.slice(0, 200),
        kinds: [...new Set(file.sheets.map((s) => s.kind))].join(","),
        created: 0,
        updated: 0,
        skipped: 0,
      },
    });
    const sheets = [];
    for (const sheet of file.sheets) {
      const counts = await saveRows(sheet.kind, sheet.rows, log.id);
      sheets.push({ kind: sheet.kind, ...counts, skipped: sheet.skipped });
    }
    await db.connectImport.update({
      where: { id: log.id },
      data: {
        created: sheets.reduce((a, s) => a + s.created, 0),
        updated: sheets.reduce((a, s) => a + s.updated, 0),
        skipped: sheets.reduce((a, s) => a + s.skipped, 0),
        kept: sheets.reduce((a, s) => a + s.kept, 0),
      },
    });
    results.push({ name: file.name, sheets });
  }
  await logActivity({
    actorId: actor.id,
    action: "connect.imported",
    entityType: "ConnectImport",
    entityId: results
      .map((r) => r.name)
      .join(", ")
      .slice(0, 200),
    details: results,
  });
  return results;
}

// Rows parsed elsewhere (the server's data-load script): saved the same way as an upload.
export async function importConnectRows(userId: string | null, name: string, rows: ParsedRow[]) {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const log = await db.connectImport.create({
    data: {
      userId,
      fileName: name.slice(0, 200),
      kinds: kinds.join(","),
      created: 0,
      updated: 0,
      skipped: 0,
    },
  });
  const sheets = [];
  for (const kind of kinds) {
    const counts = await saveRows(
      kind,
      rows.filter((r) => r.kind === kind),
      log.id,
    );
    sheets.push({ kind, ...counts, skipped: 0 });
  }
  await db.connectImport.update({
    where: { id: log.id },
    data: {
      created: sheets.reduce((a, s) => a + s.created, 0),
      updated: sheets.reduce((a, s) => a + s.updated, 0),
      kept: sheets.reduce((a, s) => a + s.kept, 0),
    },
  });
  // The script reports what changed; rows kept as newer are in the upload history.
  return sheets.map(({ kind, created, updated, skipped }) => ({ kind, created, updated, skipped }));
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// How fresh an export is: its latest event — a record made, or an answer, delivery or decision
// on one (every "YYYY-MM-DDTHH:mm" in the rows). An export made later has later events, even
// when it covers fewer months.
export function exportTime(rows: ParsedRow[]): string | null {
  let max: string | null = null;
  for (const { record } of rows)
    for (const value of Object.values(record))
      if (typeof value === "string" && STAMP.test(value) && (max === null || value > max))
        max = value;
  return max;
}

async function saveRows(kind: ConnectKind, rows: ParsedRow[], importId: string) {
  // The last row wins when an export repeats an ID.
  const byId = new Map(rows.map((r) => [r.record.id, r.record]));
  const asOf = exportTime(rows);
  const stored = new Map(
    (
      await db.connectRecord.findMany({
        where: { kind, externalId: { in: [...byId.keys()] } },
        select: { externalId: true, asOf: true },
      })
    ).map((r) => [r.externalId, r.asOf]),
  );
  // A row written from a newer export keeps its (newer) status.
  const isNewer = (id: string) => {
    const was = stored.get(id);
    return Boolean(was && asOf && was > asOf);
  };
  const newestLoaded = await db.connectRecord.aggregate({ where: { kind }, _max: { asOf: true } });
  const newer =
    asOf && newestLoaded._max.asOf && newestLoaded._max.asOf > asOf ? newestLoaded._max.asOf : null;
  const fields = (record: ParsedRow["record"]) => ({
    storeCode: record.storeCode,
    storeName: record.storeName,
    city: record.city,
    channel: record.channel,
    day: record.day,
    month: record.month,
    person: record.person,
    data: record as unknown as Prisma.InputJsonValue,
    importId,
    asOf,
  });
  const fresh = [...byId.values()].filter((r) => !stored.has(r.id));
  const known = [...byId.values()].filter((r) => stored.has(r.id) && !isNewer(r.id));
  const kept = [...byId.values()].filter((r) => isNewer(r.id)).length;
  await db.connectRecord.createMany({
    data: fresh.map((r) => ({ kind, externalId: r.id, ...fields(r) })),
  });
  for (let i = 0; i < known.length; i += 200)
    await db.$transaction(
      known.slice(i, i + 200).map((r) =>
        db.connectRecord.update({
          where: { kind_externalId: { kind, externalId: r.id } },
          data: fields(r),
        }),
      ),
    );
  return { created: fresh.length, updated: known.length, kept, newer };
}

// Removes everything uploaded (to start over with fresh exports).
export async function clearConnectData(actor: Actor) {
  if (actor.role !== "OWNER") throw new ConnectError("forbidden");
  const { count } = await db.connectRecord.deleteMany();
  await logActivity({
    actorId: actor.id,
    action: "connect.cleared",
    entityType: "ConnectRecord",
    entityId: "all",
    details: { count },
  });
  return count;
}
