import { cache } from "react";

import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";

import type { ChecklistState } from "./calendar";
import { SopCycleError } from "./calc";
import { buildSopReport, type SopReport } from "./report";
import {
  baselineOf,
  listSopMarks,
  listSopUploads,
  loadSopChecklist,
  loadSopModel,
  loadSopSettings,
  shownSopUpload,
  type SopMarkRow,
  type SopUploadRow,
} from "./service";
import type { SopSettings } from "./settings";

// What a page of «S&OP» needs for the upload on screen, loaded once per request (the layout and
// the page share it).

export type SopData = {
  uploads: SopUploadRow[];
  settings: SopSettings;
  today: string;
  // The upload on screen; null when nothing is uploaded yet.
  upload: SopUploadRow | null;
  baseline: SopUploadRow | null;
  // Null when there is no upload, or the upload cannot be counted (`broken`).
  report: SopReport | null;
  broken: boolean;
  marks: Map<string, SopMarkRow>;
  checklist: ChecklistState;
};

// The data of one upload (the one given, or the current one), counted for `today`.
export async function loadSopDataFor(
  today: string,
  pick?: (uploads: SopUploadRow[]) => Promise<SopUploadRow | null> | SopUploadRow | null,
): Promise<SopData> {
  const [uploads, settings] = await Promise.all([listSopUploads(), loadSopSettings()]);
  const upload = pick ? await pick(uploads) : (uploads[0] ?? null);
  const empty = { uploads, settings, today, baseline: null, report: null, broken: false };
  if (!upload)
    return { ...empty, upload: null, marks: new Map(), checklist: {} satisfies ChecklistState };
  const baseline = baselineOf(uploads, upload);
  const [model, baseModel, marks, checklist] = await Promise.all([
    loadSopModel(upload.id),
    baseline ? loadSopModel(baseline.id) : null,
    listSopMarks(upload.cycle),
    loadSopChecklist(upload.cycle),
  ]);
  let report: SopReport | null = null;
  if (model) {
    try {
      report = buildSopReport({
        model,
        cycle: upload.cycle,
        kind: upload.kind,
        settings,
        baseline: baseline && baseModel ? { model: baseModel, cycle: baseline.cycle } : null,
        today,
      });
    } catch (error) {
      if (!(error instanceof SopCycleError)) throw error;
    }
  }
  return {
    ...empty,
    upload,
    baseline: baseline && baseModel ? baseline : null,
    report,
    broken: report === null,
    marks,
    checklist,
  };
}

export const loadSopData = cache(async (): Promise<SopData> => {
  const user = await requireUser();
  return loadSopDataFor(await getUserToday(user.id), shownSopUpload);
});
