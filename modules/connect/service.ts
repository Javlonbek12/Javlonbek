import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { canUseModule } from "@/modules/core/access/actor";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { isTestStore, type Dataset } from "./analytics";
import { parseWorkbook, personCode, type ParsedRow, type RecordOf } from "./parse";
import type { VisitData } from "./visits";

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

// The bot's records of the period (months from..to, inclusive), split by kind (the reports page).
export async function loadDataset(filter: ConnectFilter = {}): Promise<Dataset> {
  const rows: Row[] = await db.connectRecord.findMany({
    where: {
      kind: { in: ["OOS", "ORDER", "PAYMENT", "VISIT"] },
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

// Smart Up visits and the bot's MVs, checks and orders of the days from..to (inclusive), and
// every TSM of Smart Up's totals.
export async function loadVisitData(period: { from: string; to: string }): Promise<VisitData> {
  const [rows, people] = await Promise.all([
    db.connectRecord.findMany({
      where: {
        kind: { in: ["SU_VISIT", "VISIT", "OOS", "ORDER"] },
        day: { gte: period.from, lte: period.to },
      },
      select: { kind: true, data: true, storeName: true, storeCode: true },
      orderBy: { day: "asc" },
    }),
    db.connectRecord.findMany({ where: { kind: "SU_PERSON" }, select: { data: true } }),
  ]);
  const real = rows.filter((r) => !isTestStore(r.storeName, r.storeCode));
  const of = <K extends ConnectKind>(kind: K) =>
    real.filter((r) => r.kind === kind).map((r) => r.data as RecordOf<K>);
  return {
    suVisits: of("SU_VISIT"),
    mv: of("VISIT"),
    oos: of("OOS"),
    orders: of("ORDER"),
    people: people.map((p) => p.data as RecordOf<"SU_PERSON">),
  };
}

// The ISM payment requests of the months from..to (the ISM block keeps its months).
export async function loadPayments(months: { from: string; to: string }) {
  return (await loadDataset(months)).payments;
}

export async function connectTotal() {
  return db.connectRecord.count();
}

// How fresh the data is: the latest day any record is about («Данные по 7 нояб.»), not when it
// was uploaded.
export async function connectDataDate(): Promise<string | null> {
  const { _max } = await db.connectRecord.aggregate({
    where: { kind: { not: "SU_PERSON" } },
    _max: { day: true },
  });
  return _max.day;
}

// Which TSM (by its code, «TSM_TST_1»; links saved before 10.11.2026 have the bot's full name
// «TSM_TST_1 - Имя», which means the same code) belongs to which person in the app, set by the
// owner or a manager: an employee then sees only their own list, a manager the TSMs of their team.
const PEOPLE_KEY = "connect.people";

export async function connectPeopleLinks(): Promise<Record<string, string>> {
  const row = await db.systemState.findUnique({ where: { key: PEOPLE_KEY } });
  if (!row) return {};
  try {
    const value: unknown = JSON.parse(row.value);
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// The people a bot name can be linked to: everyone active.
export async function connectAppUsers() {
  return db.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}

// Links a TSM code (or a bot name: its code is taken) to a person in the app, or unlinks it with
// `userId` null. Old links by full name for the same code are replaced.
export async function linkConnectPerson(actor: Actor, name: string, userId: string | null) {
  if (!canLeadConnect(actor)) throw new ConnectError("forbidden");
  const person = personCode(name.trim().slice(0, 200));
  if (!person) throw new ConnectError("empty");
  if (userId && !(await db.user.findFirst({ where: { id: userId, deactivatedAt: null } })))
    throw new ConnectError("unknown");
  const links = await connectPeopleLinks();
  for (const key of Object.keys(links))
    if (personCode(key)?.toUpperCase() === person.toUpperCase()) delete links[key];
  if (userId) links[person] = userId;
  const value = JSON.stringify(links);
  await db.systemState.upsert({
    where: { key: PEOPLE_KEY },
    create: { key: PEOPLE_KEY, value },
    update: { value },
  });
  await logActivity({
    actorId: actor.id,
    action: "connect.person_linked",
    entityType: "SystemState",
    entityId: PEOPLE_KEY,
    details: { name: person, userId },
  });
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
    // The days the file covers and its rows from test stores (left out of every number).
    from: string | null;
    to: string | null;
    test: number;
    // Smart Up visits: the rows of those days that were there before and were replaced.
    replaced: number | null;
  }[];
};

const MAX_FILE = 20 * 1024 * 1024;

// What an upload says about a sheet: «файл за 1 авг. – 7 нояб., 5 строк тестовых точек не учтено».
function coverage(rows: ParsedRow[]) {
  const days = rows
    .map((r) => r.record.day)
    .filter(Boolean)
    .sort();
  return {
    from: days[0] ?? null,
    to: days.at(-1) ?? null,
    test: rows.filter((r) => isTestStore(r.record.storeName, r.record.storeCode)).length,
  };
}

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
      sheets.push({ kind: sheet.kind, ...counts, skipped: sheet.skipped, ...coverage(sheet.rows) });
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

const recordFields = (record: ParsedRow["record"], importId: string, asOf: string | null) => ({
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

// A Smart Up detail replaces, never appends: the visits of the file's days (first to last) go,
// the file's rows come (a later export turns plans not visited yet into visits with an ID).
async function replaceSmartUpVisits(rows: ParsedRow[], importId: string) {
  const byId = new Map(rows.map((r) => [r.record.id, r.record]));
  const days = [...byId.values()].map((r) => r.day).sort();
  const from = days[0];
  const to = days.at(-1);
  if (!from || !to) return { created: 0, updated: 0, kept: 0, newer: null, replaced: 0 };
  const [removed] = await db.$transaction([
    db.connectRecord.deleteMany({ where: { kind: "SU_VISIT", day: { gte: from, lte: to } } }),
    // The same visit stored under another day (its plan day before it was made).
    db.connectRecord.deleteMany({
      where: { kind: "SU_VISIT", externalId: { in: [...byId.keys()] } },
    }),
    db.connectRecord.createMany({
      data: [...byId.values()].map((r) => ({
        kind: "SU_VISIT" as const,
        externalId: r.id,
        ...recordFields(r, importId, null),
      })),
    }),
  ]);
  return { created: byId.size, updated: 0, kept: 0, newer: null, replaced: removed.count };
}

async function saveRows(kind: ConnectKind, rows: ParsedRow[], importId: string) {
  if (kind === "SU_VISIT") return replaceSmartUpVisits(rows, importId);
  // The last row wins when an export repeats an ID.
  const byId = new Map(rows.map((r) => [r.record.id, r.record]));
  // Smart Up's people have no dates: a later file always writes them.
  const asOf = kind === "SU_PERSON" ? null : exportTime(rows);
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
  const fields = (record: ParsedRow["record"]) => recordFields(record, importId, asOf);
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
  return { created: fresh.length, updated: known.length, kept, newer, replaced: null };
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
