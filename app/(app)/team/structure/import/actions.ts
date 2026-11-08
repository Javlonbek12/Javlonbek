"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { parseOrgXlsx, previewOrgImport, type PreviewLine } from "@/modules/org/excel";
import { importOrgChart } from "@/modules/org/import";
import { canEditOrg } from "@/modules/org/service";

export type OrgImportState = {
  errors: string[];
  preview: {
    lines: PreviewLine[];
    stats: { units: number; places: number; vacancies: number; linked: number };
    // The checked chart, sent back with «Загрузить» (checked again there).
    chart: string;
  } | null;
};

const MAX_BYTES = 5 * 1024 * 1024;

// Step 1: the file is read and checked; nothing is saved yet.
export async function previewOrgImportAction(
  _state: OrgImportState,
  form: FormData,
): Promise<OrgImportState> {
  const user = await requireUser();
  if (!canEditOrg(user)) return { errors: [t("team.org.errors.forbidden")], preview: null };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES)
    return { errors: [t("team.org.import.errors.file")], preview: null };
  const { roots, errors } = await parseOrgXlsx(Buffer.from(await file.arrayBuffer()));
  if (errors.length) return { errors: errors.slice(0, 20), preview: null };
  const { lines, stats } = await previewOrgImport(roots);
  return { errors: [], preview: { lines, stats, chart: JSON.stringify(roots) } };
}

// Step 2: «Загрузить» replaces the chart with the one shown.
export async function applyOrgImportAction(
  state: OrgImportState,
  form: FormData,
): Promise<OrgImportState> {
  const user = await requireUser();
  if (!canEditOrg(user)) return { errors: [t("team.org.errors.forbidden")], preview: null };
  try {
    await importOrgChart(JSON.parse(String(form.get("chart") ?? "")), { replace: true });
  } catch {
    return { ...state, errors: [t("team.org.import.errors.file")] };
  }
  revalidatePath("/team", "layout");
  redirect("/team/structure?imported=1");
}
