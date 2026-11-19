"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { requireUser } from "@/modules/core/auth/current-user";
import { confirmDuty, deleteDuty, DutyError, saveDuty } from "@/modules/team/responsibilities";

import { formBack } from "./form-data";

const allowAction = createRateLimiter({ limit: 60, windowMs: 60_000 });

async function actor() {
  const user = await requireUser();
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};
const idSchema = z.string().min(1).max(64);

// Where the form or the button came from: a page of «Команда» only.
const backOf = (formData: FormData) => formBack(str(formData, "back"));

// The page again with what happened (`duty=saved`, `dutyError=forbidden`), its #anchor kept.
function withNotice(back: string, key: "duty" | "dutyError", value: string) {
  const [path = "/team", hash] = back.split("#");
  const url = new URL(path, "http://app.local");
  url.searchParams.delete("duty");
  url.searchParams.delete("dutyError");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

export type DutyFormValues = {
  title: string;
  description: string;
  responsible: string;
  deputyId: string;
  module: string;
};
export type DutyFormState = { error: DutyError["code"] | null; values: DutyFormValues };

// Add or change a responsibility; a refused save comes back with what was typed.
export async function saveDutyAction(_: DutyFormState, formData: FormData): Promise<DutyFormState> {
  const user = await actor();
  const id = str(formData, "dutyId") || null;
  const values: DutyFormValues = {
    title: str(formData, "title"),
    description: str(formData, "description"),
    responsible: str(formData, "responsible"),
    deputyId: str(formData, "deputyId"),
    module: str(formData, "module"),
  };
  try {
    await saveDuty(user, id ? idSchema.parse(id) : null, values);
  } catch (error) {
    if (!(error instanceof DutyError)) throw error;
    return { error: error.code, values };
  }
  revalidatePath("/team", "layout");
  redirect(withNotice(backOf(formData), "duty", "saved"));
}

// «Подтвердить» and «Удалить»: back to the list or the card with what happened.
async function onDuty(formData: FormData, run: (id: string) => Promise<unknown>, done: string) {
  const back = backOf(formData);
  let target = withNotice(back, "duty", done);
  try {
    await run(idSchema.parse(str(formData, "dutyId")));
  } catch (error) {
    if (!(error instanceof DutyError)) throw error;
    target = withNotice(back, "dutyError", error.code);
  }
  revalidatePath("/team", "layout");
  redirect(target);
}

export async function confirmDutyAction(formData: FormData) {
  const user = await actor();
  await onDuty(formData, (id) => confirmDuty(user, id), "confirmed");
}

export async function deleteDutyAction(formData: FormData) {
  const user = await actor();
  await onDuty(formData, (id) => deleteDuty(user, id), "deleted");
}
