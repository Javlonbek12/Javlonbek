import { cookies } from "next/headers";

import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canUseModule } from "@/modules/core/access/paths";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { isChecklistItem, parseChecklist, type ChecklistState } from "./calendar";
import { fileDateOf, parseSopWorkbook, SopFileError } from "./parse";
import {
  DEFAULT_SOP_SETTINGS,
  parseSopSettings,
  SOP_SETTINGS_KEY,
  type SopSettings,
} from "./settings";
import { addMonths, isMonth, SOP_KINDS, type SopKind, type SopModel } from "./types";

// Storing and reading S&OP: the uploads (the parsed sheet, never the file), the marks on
// findings, the ticks of the monthly checklist, the norms. Everyone who has the section can do
// everything in it.

type Viewer = Parameters<typeof canUseModule>[0];
export const canUseSop = (user: Viewer) => canUseModule(user, "sop");

export class SopError extends Error {
  constructor(
    public readonly code:
      "forbidden" | "empty" | "notFound" | "cycle" | "kind" | SopFileError["code"],
  ) {
    super(code);
    this.name = "SopError";
  }
}

const allow = (actor: Actor) => {
  if (!canUseSop(actor)) throw new SopError("forbidden");
};

// --- The norms ------------------------------------------------------------------------------------

export async function loadSopSettings(): Promise<SopSettings> {
  const row = await db.systemState.findUnique({ where: { key: SOP_SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SOP_SETTINGS };
  try {
    return parseSopSettings(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_SOP_SETTINGS };
  }
}

// Saves the norms (`null`: back to the standard ones).
export async function saveSopSettings(actor: Actor, settings: SopSettings | null) {
  allow(actor);
  if (settings) {
    const value = JSON.stringify(parseSopSettings(settings));
    await db.systemState.upsert({
      where: { key: SOP_SETTINGS_KEY },
      create: { key: SOP_SETTINGS_KEY, value },
      update: { value },
    });
  } else {
    await db.systemState.deleteMany({ where: { key: SOP_SETTINGS_KEY } });
  }
  await logActivity({
    actorId: actor.id,
    action: "sop.settings_saved",
    entityType: "SystemState",
    entityId: SOP_SETTINGS_KEY,
    details: settings ? { ...settings } : { reset: true },
  });
}

// --- Uploads --------------------------------------------------------------------------------------

export type SopUploadRow = {
  id: string;
  createdAt: Date;
  uploadedBy: string | null;
  uploaderName: string | null;
  fileName: string;
  fileDate: string | null;
  cycle: string;
  kind: SopKind;
  note: string;
  market: string;
  fileSize: number;
  dataSize: number;
  skuCount: number;
};

// Every upload without its data, the latest cycle first and the latest upload first inside it:
// the first one is the «current» upload.
export async function listSopUploads(): Promise<SopUploadRow[]> {
  const rows = await db.sopUpload.findMany({
    omit: { data: true },
    orderBy: [{ cycle: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.uploadedBy).filter((id) => id !== null))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(people.map((p) => [p.id, displayName(p)]));
  return rows.map((row) => ({
    ...row,
    uploaderName: row.uploadedBy ? (names.get(row.uploadedBy) ?? null) : null,
  }));
}

export const SOP_UPLOAD_COOKIE = "sop-upload";

// The upload the pages show: the one picked on the page (a cookie), else the current one.
export async function shownSopUpload(list: SopUploadRow[]): Promise<SopUploadRow | null> {
  // Outside a request (scripts, tests) there are no cookies.
  let picked: string | undefined;
  try {
    picked = (await cookies()).get(SOP_UPLOAD_COOKIE)?.value;
  } catch {
    picked = undefined;
  }
  return list.find((upload) => upload.id === picked) ?? list[0] ?? null;
}

// What an upload is compared with: the latest upload of the cycle before (HQ's final first), or,
// without one, the upload of the same cycle made before it.
export function baselineOf(list: SopUploadRow[], upload: SopUploadRow): SopUploadRow | null {
  const previous = list.filter((u) => u.cycle === addMonths(upload.cycle, -1));
  const final = previous.find((u) => u.kind === "HQ_FINAL") ?? previous[0];
  if (final) return final;
  return (
    list.find(
      (u) => u.cycle === upload.cycle && u.id !== upload.id && u.createdAt <= upload.createdAt,
    ) ?? null
  );
}

export async function loadSopModel(id: string): Promise<SopModel | null> {
  const row = await db.sopUpload.findUnique({ where: { id }, select: { data: true } });
  const data = row?.data as { version?: unknown } | null | undefined;
  return data && typeof data === "object" && data.version === 1 ? (data as SopModel) : null;
}

export type SopInspection = {
  sheet: string;
  skus: number;
  materials: number | null;
  months: string[];
  lastActual: string | null;
  // The cycle the file shows by its formulas, the month in the file's name, and the one offered.
  detected: string | null;
  fileDate: string | null;
  cycle: string | null;
};

const read = async (file: { name: string; buffer: Buffer }, market: string) => {
  if (file.buffer.length === 0) throw new SopError("empty");
  try {
    return await parseSopWorkbook(file.buffer, market);
  } catch (error) {
    if (error instanceof SopFileError) throw new SopError(error.code);
    throw error;
  }
};

// The cycle to offer: what the formulas show; without them — the month of the date in the name.
function offeredCycle(model: SopModel, fileDate: string | null): string | null {
  if (model.detectedCycle) return model.detectedCycle;
  const named = fileDate?.slice(0, 7);
  return named && model.months.includes(named) ? named : null;
}

// A look at a chosen file before it is saved: what was found in it and which cycle it is.
export async function inspectSopFile(
  actor: Actor,
  file: { name: string; buffer: Buffer },
): Promise<SopInspection> {
  allow(actor);
  const settings = await loadSopSettings();
  const model = await read(file, settings.market);
  const fileDate = fileDateOf(file.name);
  return {
    sheet: model.sheet,
    skus: model.skus.length,
    materials: model.materials ? model.materials.rows.length : null,
    months: model.months,
    lastActual: model.lastActual,
    detected: model.detectedCycle,
    fileDate,
    cycle: offeredCycle(model, fileDate),
  };
}

export async function uploadSop(
  actor: Actor,
  input: { name: string; buffer: Buffer; kind: string; note?: string; cycle?: string | null },
): Promise<SopUploadRow> {
  allow(actor);
  const kind = SOP_KINDS.find((k) => k === input.kind);
  if (!kind) throw new SopError("kind");
  const settings = await loadSopSettings();
  const model = await read(input, settings.market);
  const fileDate = fileDateOf(input.name);
  const cycle = input.cycle ? input.cycle : offeredCycle(model, fileDate);
  // The cycle must be a month of the sheet with a closed month before it.
  if (!isMonth(cycle) || model.months.indexOf(cycle) < 1) throw new SopError("cycle");
  const data = JSON.stringify(model);
  const row = await db.sopUpload.create({
    data: {
      uploadedBy: actor.id,
      fileName: input.name.replace(/[\u0000-\u001f]/g, " ").slice(0, 200),
      fileDate,
      cycle,
      kind,
      note: (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      market: model.market,
      data: JSON.parse(data) as Prisma.InputJsonValue,
      fileSize: input.buffer.length,
      dataSize: Buffer.byteLength(data),
      skuCount: model.skus.length,
    },
    omit: { data: true },
  });
  await db.sopCycle.upsert({ where: { cycle }, create: { cycle }, update: {} });
  await logActivity({
    actorId: actor.id,
    action: "sop.uploaded",
    entityType: "SopUpload",
    entityId: row.id,
    details: { cycle, kind, skus: model.skus.length },
  });
  return { ...row, uploaderName: null };
}

export async function deleteSopUpload(actor: Actor, id: string) {
  allow(actor);
  const row = await db.sopUpload.findUnique({
    where: { id },
    select: { id: true, cycle: true, kind: true, fileName: true },
  });
  if (!row) throw new SopError("notFound");
  await db.sopUpload.delete({ where: { id } });
  await logActivity({
    actorId: actor.id,
    action: "sop.upload_deleted",
    entityType: "SopUpload",
    entityId: id,
    details: { cycle: row.cycle, kind: row.kind },
  });
}

export async function checkSopUpload(id: string) {
  if (!(await db.sopUpload.findUnique({ where: { id }, select: { id: true } })))
    throw new SopError("notFound");
}

// --- Marks on findings ----------------------------------------------------------------------------

export const SOP_MARKS = ["CHECKED", "ACCEPTED"] as const;
export type SopMarkStatus = (typeof SOP_MARKS)[number];
export type SopMarkRow = {
  key: string;
  status: SopMarkStatus;
  note: string;
  userName: string | null;
  updatedAt: Date;
};

export async function listSopMarks(cycle: string): Promise<Map<string, SopMarkRow>> {
  const rows = await db.sopMark.findMany({ where: { cycle } });
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((id) => id !== null))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(people.map((p) => [p.id, displayName(p)]));
  return new Map(
    rows.map((row) => [
      row.key,
      {
        key: row.key,
        status: row.status,
        note: row.note,
        userName: row.userId ? (names.get(row.userId) ?? null) : null,
        updatedAt: row.updatedAt,
      },
    ]),
  );
}

// Puts a mark on a finding of a cycle, changes it, or (`status` null) takes it off.
export async function setSopMark(
  actor: Actor,
  input: { cycle: string; key: string; status: string | null; note?: string },
) {
  allow(actor);
  const key = input.key.slice(0, 500);
  if (!isMonth(input.cycle) || !key) throw new SopError("notFound");
  const status = SOP_MARKS.find((s) => s === input.status);
  if (!status) {
    await db.sopMark.deleteMany({ where: { cycle: input.cycle, key } });
    return;
  }
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  await db.sopMark.upsert({
    where: { cycle_key: { cycle: input.cycle, key } },
    create: { cycle: input.cycle, key, status, note, userId: actor.id },
    update: { status, note, userId: actor.id },
  });
}

// --- The monthly checklist ------------------------------------------------------------------------

// The names of those who ticked the checklist: user id → name.
export async function sopUserNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(people.map((p) => [p.id, displayName(p)]));
}

export async function loadSopChecklist(cycle: string): Promise<ChecklistState> {
  const row = await db.sopCycle.findUnique({ where: { cycle } });
  return parseChecklist(row?.checklist);
}

export async function tickSopChecklist(
  actor: Actor,
  input: { cycle: string; item: number; done: boolean },
) {
  allow(actor);
  if (!isMonth(input.cycle) || !isChecklistItem(input.item)) throw new SopError("notFound");
  const state = await loadSopChecklist(input.cycle);
  if (input.done) state[`${input.item}`] = { by: actor.id, at: new Date().toISOString() };
  else delete state[`${input.item}`];
  await db.sopCycle.upsert({
    where: { cycle: input.cycle },
    create: { cycle: input.cycle, checklist: state },
    update: { checklist: state },
  });
}
