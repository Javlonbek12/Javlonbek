"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CONFIGURABLE_MODULES,
  RoleConfigError,
  saveRoleConfig,
} from "@/modules/core/access/config";
import { requireUser } from "@/modules/core/auth/current-user";
import { TaskError } from "@/modules/tasks/errors";
import { saveTaskSettings } from "@/modules/tasks/settings";

export async function saveRolesAction(form: FormData) {
  const user = await requireUser();
  const role = (name: "MANAGER" | "MEMBER" | "LAWYER") => ({
    modules: CONFIGURABLE_MODULES.filter((m) => form.get(`${name}.${m}`) === "on"),
    taskScope: String(form.get(`${name}.taskScope`) ?? "own"),
  });
  let target = "/settings/roles?saved=1";
  try {
    await saveRoleConfig(user, {
      MANAGER: role("MANAGER"),
      MEMBER: role("MEMBER"),
      LAWYER: role("LAWYER"),
    });
  } catch (error) {
    if (!(error instanceof RoleConfigError)) throw error;
    target = "/settings/roles?error=1";
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// Tasks (routing v2): teams that approve tasks inside the team too, and the bin's days.
export async function saveTaskSettingsAction(form: FormData) {
  const user = await requireUser();
  let target = "/settings/roles?saved=1";
  try {
    await saveTaskSettings(user, {
      teamApproval: form.getAll("teamApproval").map(String),
      trashDays: Number(form.get("trashDays") ?? 30),
    });
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = "/settings/roles?error=1";
  }
  revalidatePath("/", "layout");
  redirect(target);
}
