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
  restoreTask,
} from "@/modules/tasks/delete-service";
import { TaskError } from "@/modules/tasks/errors";
import { safeBack, withParams } from "@/modules/tasks/back";
import { createPlan } from "@/modules/tasks/plan-service";
import {
  completeTask,
  PANEL_FIELDS,
  updateTaskField,
  type PanelField,
} from "@/modules/tasks/quick-actions";
import type { RepeatInput } from "@/modules/tasks/repeat";
import { setTaskLabels } from "@/modules/tasks/labels";
import { addTime, removeTimeEntry, startTimer, stopTimer } from "@/modules/tasks/time";
import { getUserToday } from "@/modules/core/settings/service";
import {
  addCoAssignee,
  decideCoAssignee,
  removeCoAssignee,
  withdrawCoAssigneeRequest,
} from "@/modules/tasks/co-assignees";
import { MAX_NOTE_LENGTH, saveNote, type SaveNoteResult } from "@/modules/tasks/notes";
import {
  addStep,
  moveStep,
  removeStep,
  tickStep,
  updateStep,
  type StepInput,
} from "@/modules/tasks/steps";
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

// The repeat part of the task form; an empty choice means no repeat.
function repeatFromForm(formData: FormData): RepeatInput | null {
  const frequency = str(formData, "repeat");
  if (!frequency) return null;
  const monthDay = str(formData, "repeatMonthDay");
  return {
    frequency: frequency as RepeatInput["frequency"],
    interval: Number(str(formData, "repeatInterval") || 1),
    weekdays: formData.getAll("repeatDay").map(Number),
    monthDay: monthDay ? Number(monthDay) : null,
    until: str(formData, "repeatUntil") || null,
  };
}

export type TaskFormState = { error: string | null; values: Record<string, string> };

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string" || key.startsWith("$")) continue;
    // Checkboxes with one name (the repeat's weekdays) keep every value.
    values[key] = key in values ? `${values[key]},${value}` : value;
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
      { repeat: repeatFromForm(formData), needsApproval: formData.get("needsApproval") === "on" },
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
    await updateTask(user, taskId, taskInputFromForm(formData), repeatFromForm(formData));
  } catch (error) {
    if (error instanceof TaskError) return { error: error.code, values: formValues(formData) };
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(`/tasks/${taskId}`);
}

// Runs a task action from the task card (its page, or the panel next to the list) and goes back
// to where the form was sent from, with ?error=<code> on failure.
async function onTaskPage(
  formData: FormData,
  taskId: string,
  run: () => Promise<unknown>,
  then = "",
) {
  const back = safeBack(str(formData, "back"), `/tasks/${encodeURIComponent(taskId)}`);
  let error: string | null = null;
  try {
    await run();
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParams(back, { error }));
  redirect(then ? `/tasks/${encodeURIComponent(taskId)}${then}` : withParams(back, {}));
}

export async function changeStatusAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const to = statusSchema.parse(str(formData, "to"));
  // "Withdraw and edit": back to draft, then straight to the edit form.
  const then = str(formData, "then") === "edit" ? "/edit" : "";
  const reason = str(formData, "reason").trim().slice(0, 1000) || null;
  const despiteCancelled = formData.get("despiteCancelled") === "on";
  await onTaskPage(
    formData,
    taskId,
    () => changeStatus(user, taskId, to, { reason, despiteCancelled }),
    then,
  );
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
  await onTaskPage(formData, taskId, async () => {
    if (!blockerId) throw new TaskError("invalid");
    await addDependency(user, taskId, blockerId);
  });
}

export async function removeDependencyAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const blockerId = idSchema.parse(str(formData, "blockerId"));
  await onTaskPage(formData, taskId, () => removeDependency(user, taskId, blockerId));
}

export async function addCommentAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () => addComment(user, taskId, str(formData, "body")));
}

export async function addLinkAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () =>
    addLinkAttachment(user, taskId, str(formData, "title"), str(formData, "url")),
  );
}

export async function removeAttachmentAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () =>
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
// A deleted task leaves the view it was deleted from: the panel closes, the page goes to the list.
async function runDelete(
  formData: FormData,
  taskId: string,
  change: () => Promise<unknown>,
  done: string,
  gone: boolean,
) {
  const back = safeBack(str(formData, "back"), `/tasks/${encodeURIComponent(taskId)}`);
  const list = /^\/tasks(\/decide)?(\?|$)/.test(back)
    ? withParams(back, { task: null, tab: null })
    : "/tasks";
  let target = gone ? withParams(list, { deleted: "1" }) : withParams(back, { notice: done });
  try {
    await change();
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = withParams(back, { error: error.code });
  }
  revalidatePath("/tasks", "layout");
  revalidatePath("/");
  redirect(target);
}

export async function deleteTaskAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await runDelete(
    formData,
    taskId,
    () => deleteTask(user, taskId, str(formData, "reason")),
    "",
    true,
  );
}

export async function requestDeleteTaskAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await runDelete(
    formData,
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
    formData,
    taskId,
    () => resolveTaskDeletion(user, taskId, decision === "approve"),
    decision === "withdraw" ? "withdrawn" : "rejected",
    decision === "approve",
  );
}

// The owner brings a deleted team task back from the bin.
export async function restoreTaskAction(formData: FormData) {
  const user = await actor();
  const id = idSchema.parse(str(formData, "id"));
  let target = `/tasks/${id}`;
  try {
    await restoreTask(user, id);
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = `/tasks/trash?error=${error.code}`;
  }
  revalidatePath("/tasks", "layout");
  redirect(target);
}

// «Изменить» in the task panel: one field at a time.
export async function updateTaskFieldAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const field = str(formData, "field");
  if (!(PANEL_FIELDS as readonly string[]).includes(field)) throw new Error("Unknown field");
  await onTaskPage(formData, taskId, () =>
    updateTaskField(user, taskId, field as PanelField, str(formData, "value")),
  );
}

// The round button in a task row: the next allowed step towards closing the task. When it can't
// be taken (a blocking task, a cancelled one to confirm), the task panel opens with the reason.
export async function quickCloseAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const back = safeBack(str(formData, "back"), "/tasks");
  let target = withParams(back, {});
  try {
    await completeTask(user, taskId);
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = withParams(back, { task: taskId, error: error.code });
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function setTaskLabelsAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () => setTaskLabels(user, taskId, str(formData, "value")));
}

// ---------- co-assignees ----------

export async function addCoAssigneeAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const userId = str(formData, "userId");
  await onTaskPage(formData, taskId, async () => {
    if (!idSchema.safeParse(userId).success) throw new TaskError("invalid");
    await addCoAssignee(user, taskId, userId);
  });
}

// Taking someone off, or leaving: one who left and no longer sees the task goes to the list.
export async function removeCoAssigneeAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const userId = idSchema.parse(str(formData, "userId"));
  const back = safeBack(str(formData, "back"), `/tasks/${encodeURIComponent(taskId)}`);
  let target = withParams(back, {});
  try {
    const { sees } = await removeCoAssignee(user, taskId, userId);
    if (!sees)
      target = /^\/tasks(\/decide)?(\?|$)/.test(back)
        ? withParams(back, { task: null, tab: null })
        : "/tasks";
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    target = withParams(back, { error: error.code });
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function withdrawCoAssigneeRequestAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const requestId = idSchema.parse(str(formData, "requestId"));
  await onTaskPage(formData, taskId, () => withdrawCoAssigneeRequest(user, requestId));
}

// From «Ждут решения» or the task card: back to where it was decided.
export async function decideCoAssigneeAction(formData: FormData) {
  const user = await actor();
  const requestId = idSchema.parse(str(formData, "requestId"));
  const back = safeBack(str(formData, "back"), "/tasks/decide");
  let error: string | null = null;
  try {
    await decideCoAssignee(user, requestId, str(formData, "decision") === "approve");
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    error = e.code;
  }
  revalidatePath("/", "layout");
  redirect(withParams(back, { error }));
}

// ---------- steps («Работа») ----------

function stepFromForm(formData: FormData): StepInput {
  return {
    title: str(formData, "title"),
    responsibleId: str(formData, "responsibleId") || null,
    dueDate: str(formData, "dueDate") || null,
  };
}

export async function addStepAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () => addStep(user, taskId, stepFromForm(formData)));
}

export async function updateStepAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const stepId = idSchema.parse(str(formData, "stepId"));
  await onTaskPage(formData, taskId, () => updateStep(user, stepId, stepFromForm(formData)));
}

export async function removeStepAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const stepId = idSchema.parse(str(formData, "stepId"));
  await onTaskPage(formData, taskId, () => removeStep(user, stepId));
}

export async function moveStepAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const stepId = idSchema.parse(str(formData, "stepId"));
  const direction = str(formData, "direction") === "up" ? "up" : "down";
  await onTaskPage(formData, taskId, () => moveStep(user, stepId, direction));
}

export async function tickStepAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const stepId = idSchema.parse(str(formData, "stepId"));
  await onTaskPage(formData, taskId, () => tickStep(user, stepId, str(formData, "done") === "1"));
}

// ---------- time («Время») ----------

export async function startTimerAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () => startTimer(user, taskId));
}

export async function stopTimerAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  await onTaskPage(formData, taskId, () => stopTimer(user, taskId));
}

// Time added by hand: hours and minutes on a day (today unless another is given).
export async function addTimeAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const hours = Number(str(formData, "hours") || 0);
  const minutes = Number(str(formData, "minutes") || 0);
  const today = await getUserToday(user.id);
  await onTaskPage(formData, taskId, () =>
    addTime(user, taskId, Math.round(hours * 60 + minutes), str(formData, "day") || today, today),
  );
}

export async function removeTimeEntryAction(formData: FormData) {
  const user = await actor();
  const taskId = idSchema.parse(str(formData, "taskId"));
  const entryId = idSchema.parse(str(formData, "entryId"));
  await onTaskPage(formData, taskId, () => removeTimeEntry(user, entryId));
}

// ---------- notes («Заметки») ----------

// Autosave calls this every pause in typing: its own, larger limit.
const allowNoteSave = createRateLimiter({ limit: 240, windowMs: 60_000 });

export async function saveTaskNoteAction(
  taskId: unknown,
  text: unknown,
  baseVersion: unknown,
): Promise<SaveNoteResult | { ok: false; error: string }> {
  const user = await requireUser();
  if (!allowNoteSave(user.id)) return { ok: false, error: "tooMany" };
  const id = idSchema.safeParse(taskId);
  if (
    !id.success ||
    typeof text !== "string" ||
    text.length > MAX_NOTE_LENGTH + 1000 ||
    typeof baseVersion !== "number" ||
    !Number.isInteger(baseVersion)
  )
    return { ok: false, error: "invalid" };
  try {
    return await saveNote(user, id.data, text, baseVersion);
  } catch (error) {
    if (error instanceof TaskError) return { ok: false, error: error.code };
    throw error;
  }
}
