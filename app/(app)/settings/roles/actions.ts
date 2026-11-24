"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { syncAllBotCommands } from "@/modules/bot/commands";
import {
  CONFIGURABLE_MODULES,
  RoleConfigError,
  saveRoleConfig,
} from "@/modules/core/access/config";
import { requireUser } from "@/modules/core/auth/current-user";
import { TaskError } from "@/modules/tasks/errors";
import { saveTaskSettings } from "@/modules/tasks/settings";

// «Роли и доступ» is one form with one «Сохранить»: the sections and task scope of each role and
// the task settings (teams that approve inside the team, the bin's days) are saved together.
export async function saveAccessAction(form: FormData) {
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
      connectLeads: form.getAll("connectLeads").map(String),
    });
    await saveTaskSettings(user, {
      teamApproval: form.getAll("teamApproval").map(String),
      trashDays: Number(form.get("trashDays") ?? 30),
    });
    // The bot's command menu follows the sections each role has.
    await syncAllBotCommands();
  } catch (error) {
    if (!(error instanceof RoleConfigError) && !(error instanceof TaskError)) throw error;
    target = "/settings/roles?error=1";
  }
  revalidatePath("/", "layout");
  redirect(target);
}
