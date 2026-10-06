"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  addContentComment,
  approvePost,
  cancelPost,
  CHANNELS,
  ContentError,
  markSent,
  returnWithFeedback,
  saveContent,
  savePlanItem,
  submitForReview,
} from "@/modules/content/service";

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
