import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canViewTask, type TaskAccessInfo } from "./access";
import type { DraftStep } from "./draft-steps";
import { TaskError } from "./errors";
import { changeStatus } from "./service";
import { availableTransitions } from "./status";
import {
  canPlanSteps,
  canTickSteps,
  MAX_STEP_TITLE,
  MAX_STEPS,
  stepPeopleIds,
  stepProgress,
} from "./step-rules";

// Steps of the work on a task (the «Работа» tab, BACKLOG item 24): what to do, who does it and by
// when. Ticking the first step takes an approved task into work; when every step is ticked the
// tab offers to hand the task in (never on its own).

const people = { select: { id: true, firstName: true, lastName: true } };

export async function listSteps(taskId: string) {
  return db.taskStep.findMany({
    where: { taskId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { responsible: people, doneBy: people },
  });
}

export type StepInput = { title: string; responsibleId: string | null; dueDate: string | null };

function clean(task: TaskAccessInfo, input: StepInput) {
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, MAX_STEP_TITLE);
  if (!title) throw new TaskError("invalid");
  const responsibleId = input.responsibleId || null;
  if (responsibleId && !stepPeopleIds(task).includes(responsibleId)) throw new TaskError("invalid");
  const dueDate = input.dueDate || null;
  if (dueDate && !isDateString(dueDate)) throw new TaskError("invalid");
  return { title, responsibleId, dueDate: dueDate ? fromDateString(dueDate) : null };
}

async function loadTask(actor: Actor, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  return task;
}

async function loadStep(actor: Actor, stepId: string) {
  const step = await db.taskStep.findUnique({ where: { id: stepId } });
  if (!step) throw new TaskError("invalid");
  return { step, task: await loadTask(actor, step.taskId) };
}

async function log(actor: Actor, taskId: string, action: string, title: string) {
  await logActivity({
    actorId: actor.id,
    action: `task.step_${action}`,
    entityType: "Task",
    entityId: taskId,
    details: { title },
  });
}

export async function addStep(actor: Actor, taskId: string, input: StepInput) {
  const task = await loadTask(actor, taskId);
  if (!canPlanSteps(actor, task)) throw new TaskError("forbidden");
  const data = clean(task, input);
  const last = await db.taskStep.findFirst({
    where: { taskId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  if ((await db.taskStep.count({ where: { taskId } })) >= MAX_STEPS)
    throw new TaskError("tooManySteps");
  const step = await db.taskStep.create({
    data: { ...data, taskId, position: (last?.position ?? -1) + 1, createdById: actor.id },
  });
  await log(actor, taskId, "added", step.title);
  return step;
}

// Steps written together with a new task (the form's «Оформить с ИИ», the bot's card), added by its
// author once the task exists; a step that does not fit (too many, a wrong date) is left out.
export async function addInitialSteps(actor: Actor, taskId: string, steps: DraftStep[]) {
  for (const step of steps) {
    try {
      await addStep(actor, taskId, {
        title: step.title,
        responsibleId: null,
        dueDate: step.dueDate,
      });
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
    }
  }
}

export async function updateStep(actor: Actor, stepId: string, input: StepInput) {
  const { step, task } = await loadStep(actor, stepId);
  if (!canPlanSteps(actor, task)) throw new TaskError("forbidden");
  const data = clean(task, input);
  const updated = await db.taskStep.update({ where: { id: step.id }, data });
  await log(actor, task.id, "changed", updated.title);
  return updated;
}

export async function removeStep(actor: Actor, stepId: string) {
  const { step, task } = await loadStep(actor, stepId);
  if (!canPlanSteps(actor, task)) throw new TaskError("forbidden");
  await db.taskStep.delete({ where: { id: step.id } });
  await log(actor, task.id, "removed", step.title);
}

// One place up or down; positions are renumbered so they stay 0, 1, 2…
export async function moveStep(actor: Actor, stepId: string, direction: "up" | "down") {
  const { step, task } = await loadStep(actor, stepId);
  if (!canPlanSteps(actor, task)) throw new TaskError("forbidden");
  const steps = await listSteps(task.id);
  const from = steps.findIndex((s) => s.id === step.id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= steps.length) return;
  const order = steps.map((s) => s.id);
  [order[from], order[to]] = [order[to]!, order[from]!];
  await db.$transaction(
    order.map((id, position) => db.taskStep.update({ where: { id }, data: { position } })),
  );
}

// Ticks a step (or unticks it). The first tick on a task that waits to be taken into work takes
// it into work when the one ticking may do that (the assignee; a personal task's author).
// Returns whether the task was taken into work and whether every step is done now.
export async function tickStep(actor: Actor, stepId: string, done: boolean, now = new Date()) {
  const { step, task } = await loadStep(actor, stepId);
  if (!canTickSteps(actor, task)) throw new TaskError("forbidden");
  if ((step.doneAt !== null) === done) return { started: false, allDone: false };
  await db.taskStep.update({
    where: { id: step.id },
    data: done ? { doneAt: now, doneById: actor.id } : { doneAt: null, doneById: null },
  });
  await log(actor, task.id, done ? "done" : "undone", step.title);
  let started = false;
  const waiting = task.isPersonal ? task.status === "DRAFT" : task.status === "APPROVED";
  if (done && waiting && availableTransitions(actor, task).includes("IN_PROGRESS")) {
    await changeStatus(actor, task.id, "IN_PROGRESS", { now });
    started = true;
  }
  const { done: count, total } = stepProgress(
    await db.taskStep.findMany({ where: { taskId: task.id }, select: { doneAt: true } }),
  );
  return { started, allDone: count === total };
}
