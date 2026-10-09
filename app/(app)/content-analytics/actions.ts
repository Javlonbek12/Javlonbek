"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import { saveContentTargets } from "@/modules/content/analytics";
import {
  deleteSection,
  listSections,
  retagContent,
  saveSection,
  setSectionArchived,
} from "@/modules/content/sections";
import { ContentError } from "@/modules/content/service";

const withParam = (back: string, param: string) =>
  `${back}${back.includes("?") ? "&" : "?"}${param}`;

const back = (form: FormData) => {
  const value = String(form.get("back") ?? "");
  return value.startsWith("/content-analytics") ? value : "/content-analytics";
};

export async function saveTargetsAction(form: FormData) {
  const actor = await requireUser();
  const sections = (await listSections()).filter((s) => !s.archived);
  let target = withParam(back(form), "targets=saved");
  try {
    await saveContentTargets(
      actor,
      Object.fromEntries(sections.map((s) => [s.id, form.get(s.id) ?? ""])),
      sections.map((s) => s.id),
    );
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = withParam(back(form), "targets=invalid");
  }
  revalidatePath("/content-analytics");
  redirect(target);
}

// Runs a section change and comes back with its result (?section=<done key> or ?sectionError=).
async function run(form: FormData, done: string, change: () => Promise<unknown>) {
  let target = withParam(back(form), `section=${done}`);
  try {
    const result = await change();
    if (typeof result === "number") target += `&count=${result}`;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = withParam(back(form), `sectionError=${error.code}`);
  }
  revalidatePath("/content-analytics");
  revalidatePath("/content", "layout");
  redirect(`${target}#sections`);
}

const fields = (form: FormData) => ({
  name: String(form.get("name") ?? ""),
  description: String(form.get("description") ?? ""),
  sortOrder: String(form.get("sortOrder") ?? "0"),
});

export async function saveSectionAction(form: FormData) {
  const actor = await requireUser();
  const id = String(form.get("id") ?? "") || null;
  await run(form, id ? "saved" : "created", () => saveSection(actor, id, fields(form)));
}

export async function archiveSectionAction(form: FormData) {
  const actor = await requireUser();
  const archived = form.get("archived") === "1";
  await run(form, archived ? "archived" : "restored", () =>
    setSectionArchived(actor, String(form.get("id")), archived),
  );
}

export async function deleteSectionAction(form: FormData) {
  const actor = await requireUser();
  await run(form, "deleted", () => deleteSection(actor, String(form.get("id"))));
}

export async function retagAction(form: FormData) {
  const actor = await requireUser();
  const from = String(form.get("from") ?? "") || undefined;
  const to = String(form.get("to") ?? "") || undefined;
  await run(form, "retagged", () => retagContent(actor, from, to));
}
