import { db } from "@/lib/db";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import { canControl, canViewTask, isClosed, isDoer, type TaskAccessInfo } from "./access";

// Rules of task steps (the «Работа» tab): who works with them and when, the progress, and copying
// them into a repeat. The changes themselves are in steps.ts.

export const MAX_STEPS = 50;
export const MAX_STEP_TITLE = 200;

type StepLike = { position: number; doneAt: Date | null };

export function stepProgress(steps: { doneAt: Date | null }[]) {
  return { done: steps.filter((s) => s.doneAt !== null).length, total: steps.length };
}

// Where the work stopped: the first step not done yet (none when every step is done).
export function currentStep<T extends StepLike>(steps: T[]): T | null {
  return [...steps].sort((a, b) => a.position - b.position).find((s) => s.doneAt === null) ?? null;
}

// Statuses in which steps are ticked: the work may be going on. A team task once approved, a
// personal one from the start; handed-in work is changed only after taking it back.
const WORK_STATUSES: Record<"team" | "personal", TaskStatus[]> = {
  team: ["APPROVED", "IN_PROGRESS"],
  personal: ["DRAFT", "IN_PROGRESS"],
};

// Who works with the steps: the author, the assignee, co-assignees and whoever controls the task
// (a personal task: its author only).
function involved(actor: Actor, task: TaskAccessInfo) {
  if (!canViewTask(actor, task)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || isDoer(actor, task) || canControl(actor, task);
}

// Adds, changes, moves and removes steps: while the task is open and not handed in.
export function canPlanSteps(actor: Actor, task: TaskAccessInfo) {
  return !isClosed(task.status) && task.status !== "IN_REVIEW" && involved(actor, task);
}

// Ticks steps (and unticks them): while the work may be going on.
export function canTickSteps(actor: Actor, task: TaskAccessInfo) {
  return (
    WORK_STATUSES[task.isPersonal ? "personal" : "team"].includes(task.status) &&
    involved(actor, task)
  );
}

// Who a step can be given to: the people of the task.
export function stepPeopleIds(
  task: Pick<TaskAccessInfo, "creatorId" | "assigneeId" | "coAssigneeIds">,
) {
  return [...new Set([task.assigneeId, ...(task.coAssigneeIds ?? []), task.creatorId])];
}

// The steps of a task for a copy of it (a repeat): not done, due dates moved by `shiftDays`.
export async function copySteps(fromTaskId: string, toTaskId: string, shiftDays: number | null) {
  const steps = await db.taskStep.findMany({
    where: { taskId: fromTaskId },
    orderBy: { position: "asc" },
  });
  if (steps.length === 0) return;
  const target = await db.task.findUniqueOrThrow({ where: { id: toTaskId } });
  const allowed = stepPeopleIds(target);
  await db.taskStep.createMany({
    data: steps.map((s, position) => ({
      taskId: toTaskId,
      position,
      title: s.title,
      responsibleId: s.responsibleId && allowed.includes(s.responsibleId) ? s.responsibleId : null,
      dueDate:
        s.dueDate && shiftDays !== null
          ? new Date(s.dueDate.getTime() + shiftDays * 86_400_000)
          : null,
      createdById: target.creatorId,
    })),
  });
}
