"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PlanFormState } from "@/components/content/plan-form";
import type { ContentBrand, ContentChannel } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  addContentComment,
  approvePost,
  cancelPost,
  legalApprove,
  restorePost,
  movePost,
  withdrawPost,
  CHANNELS,
  ContentError,
  deleteContentPost,
  markSent,
  returnWithFeedback,
  saveContent,
  savePlanItem,
  setContentTags,
  submitForReview,
} from "@/modules/content/service";
import { importPlanXlsx } from "@/modules/content/excel";
import { copyPostFiles, LANGS, movePostFile, removePostFile } from "@/modules/content/files";
import { deliverToTelegram } from "@/modules/content/telegram";
import { getUserToday } from "@/modules/core/settings/service";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

async function run(target: string, action: () => Promise<unknown>) {
  const [path, hash] = target.split("#");
  let url = path!;
  try {
    await action();
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    url += `${url.includes("?") ? "&" : "?"}error=${error.code}`;
  }
  revalidatePath("/content", "layout");
  redirect(hash ? `${url}#${hash}` : url);
}

const planFields = (form: FormData) => ({
  title: str(form, "title"),
  brief: str(form, "brief"),
  channels: form
    .getAll("channels")
    .filter((c): c is ContentChannel => CHANNELS.includes(c as ContentChannel)),
  publishDate: str(form, "publishDate"),
  publishTime: str(form, "publishTime"),
  authorId: str(form, "authorId"),
});

// A refused plan item comes back to the form with what was typed.
const planState = (code: string, form: FormData): PlanFormState => {
  const fields = planFields(form);
  return {
    error: code,
    values: { ...fields, brief: fields.brief, publishTime: fields.publishTime || null },
  };
};

export async function createPlanItemAction(_: PlanFormState, form: FormData) {
  const actor = await requireUser();
  let id: string;
  try {
    id = (await savePlanItem(actor, null, planFields(form))).id;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return planState(error.code, form);
  }
  revalidatePath("/content", "layout");
  redirect(`/content/${id}`);
}

export async function updatePlanItemAction(_: PlanFormState, form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  try {
    await savePlanItem(actor, id, planFields(form));
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return planState(error.code, form);
  }
  revalidatePath("/content", "layout");
  redirect(`/content/${id}`);
}

export async function saveContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () =>
    saveContent(actor, id, { textRu: str(form, "textRu"), textUz: str(form, "textUz") }),
  );
}

export async function withdrawContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => withdrawPost(actor, id));
}

export async function legalApproveAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => legalApprove(actor, id));
}

export async function removeFileAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}#files`, () => removePostFile(actor, str(form, "fileId")));
}

export async function moveFileAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  const direction = str(form, "direction") === "up" ? "up" : "down";
  await run(`/content/${id}#files`, () => movePostFile(actor, str(form, "fileId"), direction));
}

export async function copyFilesAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  const to = LANGS.find((l) => l === str(form, "to"));
  const from = LANGS.find((l) => l !== to);
  await run(`/content/${id}#files`, async () => {
    if (!to || !from) throw new ContentError("invalid");
    await copyPostFiles(actor, id, from, to);
  });
}

// Dragging a post to another day in the calendar: returns the result instead of redirecting.
export async function movePostAction(id: string, date: string): Promise<{ ok: boolean }> {
  const actor = await requireUser();
  try {
    await movePost(actor, id, date);
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return { ok: false };
  }
  revalidatePath("/content", "layout");
  return { ok: true };
}

export async function submitContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => submitForReview(actor, id));
}

export async function approveContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => approvePost(actor, id));
}

export async function feedbackContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => returnWithFeedback(actor, id, str(form, "feedback")));
}

export async function markSentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  const channel = str(form, "channel") as ContentChannel;
  await run(`/content/${id}`, () => markSent(actor, id, channel));
}

export async function cancelContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => cancelPost(actor, id));
}

export async function restoreContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => restorePost(actor, id));
}

export async function commentContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => addContentComment(actor, id, str(form, "body")));
}

export async function importPlanAction(form: FormData) {
  const actor = await requireUser();
  const file = form.get("file");
  const back = str(form, "back") || "/content";
  let target: string;
  try {
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024)
      throw new ContentError("invalid");
    const result = await importPlanXlsx(actor, Buffer.from(await file.arrayBuffer()));
    const query = new URLSearchParams({
      imported: `${result.created}-${result.updated}-${result.returned}`,
      ...(result.errors.length ? { importErrors: result.errors.slice(0, 10).join("\n") } : {}),
    });
    target = `${back}${back.includes("?") ? "&" : "?"}${query}`;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = `${back}${back.includes("?") ? "&" : "?"}error=import`;
  }
  revalidatePath("/content", "layout");
  redirect(target);
}

export async function deliverTodayAction(form: FormData) {
  const actor = await requireUser();
  const back = str(form, "back") || "/content";
  const sep = back.includes("?") ? "&" : "?";
  let target: string;
  try {
    const count = await deliverToTelegram(actor, { date: await getUserToday(actor.id) });
    target = `${back}${sep}delivered=${count}`;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = `${back}${sep}error=${error.code}`;
  }
  redirect(target);
}

export async function deliverPostAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  let target: string;
  try {
    const count = await deliverToTelegram(actor, { postId: id });
    target = `/content/${id}?delivered=${count}`;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = `/content/${id}?error=${error.code}`;
  }
  redirect(target);
}

export async function deleteContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  const back = str(form, "back") || "/content";
  const sep = back.includes("?") ? "&" : "?";
  let target = `${back}${sep}deleted=1`;
  try {
    await deleteContentPost(actor, id);
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target = `/content/${id}?error=${error.code}`;
  }
  revalidatePath("/content", "layout");
  redirect(target);
}

export async function setTagsAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () =>
    setContentTags(actor, id, {
      topic: str(form, "topic"),
      brand: str(form, "brand") as ContentBrand,
    }),
  );
}
