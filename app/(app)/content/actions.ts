"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ContentBrand, ContentChannel, ContentTopic } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  addContentComment,
  approvePost,
  cancelPost,
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
import { deliverToTelegram } from "@/modules/content/telegram";
import { getUserToday } from "@/modules/core/settings/service";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

async function run(target: string, action: () => Promise<unknown>) {
  let url = target;
  try {
    await action();
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    url += `${url.includes("?") ? "&" : "?"}error=${error.code}`;
  }
  revalidatePath("/content", "layout");
  redirect(url);
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

export async function createPlanItemAction(form: FormData) {
  const actor = await requireUser();
  let target = "/content/new";
  try {
    const post = await savePlanItem(actor, null, planFields(form));
    target = `/content/${post.id}`;
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    target += `?error=${error.code}&date=${encodeURIComponent(str(form, "publishDate"))}`;
  }
  revalidatePath("/content", "layout");
  redirect(target);
}

export async function updatePlanItemAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  await run(`/content/${id}`, () => savePlanItem(actor, id, planFields(form)));
}

export async function saveContentAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "postId");
  const image = form.get("image");
  await run(`/content/${id}`, () =>
    saveContent(
      actor,
      id,
      { textRu: str(form, "textRu"), textUz: str(form, "textUz") },
      image instanceof File ? image : null,
    ),
  );
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
      imported: `${result.created}-${result.updated}`,
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
      topic: str(form, "topic") as ContentTopic,
      brand: str(form, "brand") as ContentBrand,
    }),
  );
}
