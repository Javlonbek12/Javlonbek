"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { safeBack, withParams } from "@/modules/tasks/back";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  assignPlanTasks,
  deletePhase,
  savePhase,
  savePlanSections,
  saveProjectTask,
  shiftProject,
} from "@/modules/projects/plan";
import {
  createProject,
  ProjectError,
  setProjectFinished,
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
    // «Кто делает»: role:<role name> = the person for that role of the template.
    const roles: Record<string, string> = {};
    for (const [key, value] of form.entries())
      if (key.startsWith("role:") && typeof value === "string" && value)
        roles[key.slice(5)] = value;
    const project = await createProject(actor, {
      ...fields(form),
      template: str(form, "template"),
      anchorDate: str(form, "anchorDate"),
      roles,
    });
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

export async function finishProjectAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "projectId");
  let target = `/projects/${id}`;
  try {
    await setProjectFinished(actor, id, str(form, "finished") === "1");
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    target += `?error=${error.code}`;
  }
  // «Сегодня» lists projects in work too.
  revalidatePath("/", "layout");
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
  revalidatePath("/tasks", "layout");
  // Back to the task page or to the list with the task panel open.
  redirect(withParams(safeBack(str(form, "back"), `/tasks/${encodeURIComponent(taskId)}`), {}));
}

async function planAction(
  form: FormData,
  tab: string,
  action: (projectId: string) => Promise<unknown>,
) {
  const projectId = str(form, "projectId");
  let target = `/projects/${projectId}?tab=${tab}`;
  try {
    const result = await action(projectId);
    if (typeof result === "number") target += `&shifted=${result}`;
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    target += `&error=${error.code}`;
  }
  revalidatePath("/projects", "layout");
  revalidatePath("/tasks", "layout");
  redirect(target);
}

export async function savePhaseAction(form: FormData) {
  const actor = await requireUser();
  await planAction(form, "setup", (projectId) =>
    savePhase(actor, projectId, str(form, "phaseId") || null, {
      title: str(form, "title"),
      dueDate: str(form, "dueDate"),
      sortOrder: str(form, "sortOrder") || "0",
    }),
  );
}

export async function deletePhaseAction(form: FormData) {
  const actor = await requireUser();
  await planAction(form, "setup", (projectId) =>
    deletePhase(actor, projectId, str(form, "phaseId")),
  );
}

export async function saveProjectTaskAction(form: FormData) {
  const actor = await requireUser();
  await planAction(form, "setup", (projectId) =>
    saveProjectTask(actor, projectId, str(form, "taskId") || null, {
      title: str(form, "title"),
      phaseId: str(form, "phaseId"),
      code: str(form, "code"),
      responsible: str(form, "responsible"),
      assigneeId: str(form, "assigneeId"),
      startDate: str(form, "startDate"),
      dueDate: str(form, "dueDate"),
      isMilestone: form.get("isMilestone") === "on",
    }),
  );
}

// «Назначить выбранные…»: the ticked tasks of the plan go to one person.
export async function assignPlanTasksAction(form: FormData) {
  const actor = await requireUser();
  const taskIds = form.getAll("taskIds").filter((v): v is string => typeof v === "string");
  await planAction(form, "setup", (projectId) =>
    assignPlanTasks(actor, projectId, taskIds, str(form, "assigneeId")).then(() => undefined),
  );
}

export async function shiftProjectAction(form: FormData) {
  const actor = await requireUser();
  await planAction(form, "setup", (projectId) =>
    shiftProject(actor, projectId, str(form, "anchorDate")),
  );
}

// The launch plan saves itself while typing (no page reload): says whether it was saved.
export async function savePlanDraftAction(
  projectId: unknown,
  sections: unknown,
): Promise<{ ok: boolean }> {
  const actor = await requireUser();
  if (typeof projectId !== "string" || !sections || typeof sections !== "object")
    return { ok: false };
  const texts = Object.fromEntries(
    Object.entries(sections).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  try {
    await savePlanSections(actor, projectId, texts);
  } catch (error) {
    if (error instanceof ProjectError) return { ok: false };
    throw error;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
