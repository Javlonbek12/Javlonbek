"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  addEmployeeNote,
  deleteEmployeeNote,
  TeamError,
  updateProfile,
} from "@/modules/team/service";

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

async function onCard(employeeId: string, run: () => Promise<unknown>, success: string) {
  let query = success;
  try {
    await run();
  } catch (error) {
    if (!(error instanceof TeamError)) throw error;
    query = `error=${error.code}`;
  }
  revalidatePath("/team", "layout");
  redirect(`/team/${encodeURIComponent(employeeId)}?${query}`);
}

export async function updateProfileAction(formData: FormData) {
  const user = await actor();
  const employeeId = idSchema.parse(str(formData, "employeeId"));
  await onCard(
    employeeId,
    () =>
      updateProfile(user, employeeId, {
        position: str(formData, "position"),
        responsibility: str(formData, "responsibility"),
        phone: str(formData, "phone"),
        email: str(formData, "email").trim(),
        startedAt: str(formData, "startedAt") || null,
        managerId: str(formData, "managerId") || null,
      }),
    "saved=1",
  );
}

export async function addNoteAction(formData: FormData) {
  const user = await actor();
  const employeeId = idSchema.parse(str(formData, "employeeId"));
  await onCard(
    employeeId,
    () => addEmployeeNote(user, employeeId, str(formData, "kind"), str(formData, "text")),
    "note=1",
  );
}

export async function deleteNoteAction(formData: FormData) {
  const user = await actor();
  const employeeId = idSchema.parse(str(formData, "employeeId"));
  await onCard(
    employeeId,
    () => deleteEmployeeNote(user, idSchema.parse(str(formData, "noteId"))),
    "note=1",
  );
}
