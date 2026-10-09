"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import { saveContentTargets } from "@/modules/content/analytics";
import { ContentError } from "@/modules/content/service";
import { TOPICS } from "@/modules/content/tagging";

export async function saveTargetsAction(form: FormData) {
  const actor = await requireUser();
  const back = String(form.get("back") ?? "/content-analytics");
  const sep = back.includes("?") ? "&" : "?";
  let target = `${back}${sep}targets=saved`;
  try {
    await saveContentTargets(
      actor,
      Object.fromEntries(TOPICS.map((topic) => [topic, form.get(topic) ?? ""])),
    );
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = `${back}${sep}targets=invalid`;
  }
  revalidatePath("/content-analytics");
  redirect(target);
}
