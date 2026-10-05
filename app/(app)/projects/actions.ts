"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import {
  createProject,
  ProjectError,
  setTaskRisk,
  updateProject,
} from "@/modules/projects/service";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

const fields = (form: FormData) => ({
  name: str(form, "name"),
  team: str(form, "team"),
  description: str(form, "description"),
  leadId: str(form, "leadId"),
});

export async function createProjectAction(form: FormData) {
  const actor = await requireUser();
  let target: string;
  try {
    const project = await createProject(actor, fields(form));
    target = `/projects/${project.id}`;
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    target = `/projects?error=${error.code}`;
  }
  revalidatePath("/projects");
  redirect(target);
}

export async function updateProjectAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "projectId");
  let target = `/projects/${id}`;
  try {
    await updateProject(actor, id, fields(form), { moveTasks: form.get("moveTasks") === "on" });
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    target += `?error=${error.code}`;
  }
  revalidatePath("/projects", "layout");
  revalidatePath("/tasks", "layout");
  redirect(target);
}

export async function setTaskRiskAction(form: FormData) {
  const actor = await requireUser();
  const taskId = str(form, "taskId");
  try {
    await setTaskRisk(actor, taskId, str(form, "atRisk") === "1");
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
  }
  revalidatePath("/projects", "layout");
  revalidatePath(`/tasks/${taskId}`);
  redirect(`/tasks/${taskId}`);
}
