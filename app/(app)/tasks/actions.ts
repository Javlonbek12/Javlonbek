"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/modules/core/auth/current-user";
import { addLinkAttachment, removeAttachment } from "@/modules/tasks/attachment-service";
import { addComment } from "@/modules/tasks/comment-service";
import { addDependency, removeDependency } from "@/modules/tasks/dependency-service";
import {
  deleteTask,
  requestTaskDeletion,
  resolveTaskDeletion,
} from "@/modules/tasks/delete-service";
import { TaskError } from "@/modules/tasks/errors";
import { createPlan } from "@/modules/tasks/plan-service";
import {
  CREATE_MODES,
  changeStatus,
  createTask,
  updateTask,
  type CreateMode,
  type TaskInput,
} from "@/modules/tasks/service";

// Every action checks the user; services check permissions.
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
const statusSchema = z.enum(TaskStatus);

function taskInputFromForm(formData: FormData): TaskInput {
  const estimate = str(formData, "estimateHours").replace(",", ".");
  return {
    title: str(formData, "title"),
    description: str(formData, "description"),
    isPersonal: formData.get("isPersonal") === "on",
    assigneeId: str(formData, "assigneeId") || null,
    startDate: str(formData, "startDate") || null,
    dueDate: str(formData, "dueDate") || null,
    priority: (str(formData, "priority") || "MEDIUM") as TaskInput["priority"],
    project: str(formData, "project"),
    planId: str(formData, "planId") || null,
    estimateHours: estimate ? Number(estimate) : null,
  };
}

export type TaskFormState = { error: string | null; values: Record<string, string> };

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

export async function createTaskAction(
  _: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const user = await actor();
  const mode = str(formData, "mode");
  let taskId: string;
  try {
    const task = await createTask(
      user,
      taskInputFromForm(formData),
      mode in CREATE_MODES ? (mode as CreateMode) : "draft",
    );
    taskId = task.id;
  } catch (error) {
    if (error instanceof TaskError) return { error: error.code, values: formValues(formData) };
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(`/tasks/${taskId}`);
}

export async function updateTaskAction(
  _: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  try {
    await updateTask(user, taskId, taskInputFromForm(formData));
  } catch (error) {
    if (error instanceof TaskError) return { error: error.code, values: formValues(formData) };
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(`/tasks/${taskId}`);
}

// Runs a task action from the task card and comes back with ?error=<code> on failure.
async function onTaskPage(taskId: string, run: () => Promise<unknown>, then = "") {
  let error: string | null = null;
  try {
    await run();
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  revalidatePath("/", "layout");
  redirect(`/tasks/${encodeURIComponent(taskId)}${error ? `?error=${error}` : then}`);
}

export async function changeStatusAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const to = statusSchema.parse(str(formData, "to"));
  // "Withdraw and edit": back to draft, then straight to the edit form.
  const then = str(formData, "then") === "edit" ? "/edit" : "";
  await onTaskPage(taskId, () => changeStatus(user, taskId, to), then);
}

// For the kanban board: returns the result instead of redirecting.
export async function moveTaskAction(
  taskId: string,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await actor();
  try {
    await changeStatus(user, idSchema.parse(taskId), statusSchema.parse(to));
  } catch (error) {
    if (error instanceof TaskError) return { ok: false, error: error.code };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addDependencyAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const blockerId = str(formData, "blockerId");
  await onTaskPage(taskId, async () => {
    if (!blockerId) throw new TaskError("invalid");
    await addDependency(user, taskId, blockerId);
  });
}

export async function removeDependencyAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const blockerId = idSchema.parse(str(formData, "blockerId"));
  await onTaskPage(taskId, () => removeDependency(user, taskId, blockerId));
}

export async function addCommentAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(taskId, () => addComment(user, taskId, str(formData, "body")));
}

export async function addLinkAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(taskId, () =>
    addLinkAttachment(user, taskId, str(formData, "title"), str(formData, "url")),
  );
}

export async function removeAttachmentAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(taskId, () =>
    removeAttachment(user, idSchema.parse(str(formData, "attachmentId"))),
  );
}

export async function createPlanAction(formData: FormData) {
  const user = await actor();
  let planId: string | null = null;
  let error: string | null = null;
  try {
    const plan = await createPlan(user, {
      title: str(formData, "title"),
      level: str(formData, "level") as "YEAR" | "MONTH" | "WEEK",
      date: str(formData, "date"),
      parentId: str(formData, "parentId") || null,
      isPersonal: formData.get("isPersonal") === "on",
    });
    planId = plan.id;
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  revalidatePath("/tasks/plans");
  redirect(planId ? `/tasks/plans/${planId}` : `/tasks/plans?error=${error}`);
}

// Deletion: right away (own untouched task, or as the overseer), or as a request up the hierarchy.
async function runDelete(
  taskId: string,
  change: () => Promise<unknown>,
  done: string,
  gone: boolean,
) {
  let target = gone ? `/tasks?deleted=1` : `/tasks/${taskId}?notice=${done}`;
  try {
    await change();
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = `/tasks/${taskId}?error=${error.code}`;
  }
  revalidatePath("/tasks", "layout");
  revalidatePath("/");
  redirect(target);
}

export async function deleteTaskAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await runDelete(taskId, () => deleteTask(user, taskId), "", true);
}

export async function requestDeleteTaskAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await runDelete(
    taskId,
    () => requestTaskDeletion(user, taskId, str(formData, "reason")),
    "sent",
    false,
  );
}

export async function resolveDeleteTaskAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const decision = str(formData, "decision");
  await runDelete(
    taskId,
    () => resolveTaskDeletion(user, taskId, decision === "approve"),
    decision === "withdraw" ? "withdrawn" : "rejected",
    decision === "approve",
  );
}
