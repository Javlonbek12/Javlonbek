import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import type { TaskStatus } from "@/lib/generated/prisma/client";
import { normalizeName } from "@/modules/bot/match";
import type { Actor } from "@/modules/core/permissions";

import { CLOSED_STATUSES, visibleTasksWhere } from "./access";
import { TaskError } from "./errors";
import { changeStatus, updateTask } from "./service";
import { availableTransitions } from "./status";

// Moves the due date, keeping every other field as it is.
export async function setDueDate(actor: Actor, taskId: string, dueDate: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new TaskError("forbidden");
  const start = task.startDate ? toDateString(task.startDate) : null;
  return updateTask(actor, taskId, {
    title: task.title,
    description: task.description,
    isPersonal: task.isPersonal,
    assigneeId: task.assigneeId,
    startDate: start && start <= dueDate ? start : null,
    dueDate,
    priority: task.priority,
    project: task.project,
    planId: task.planId,
    estimateHours: task.estimateMinutes === null ? null : task.estimateMinutes / 60,
  });
}

// "Close the task": the furthest step the actor may take — accept it (DONE) if allowed,
// otherwise hand it in for review (starting work first if needed).
export async function completeTask(actor: Actor, taskId: string): Promise<TaskStatus> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new TaskError("forbidden");
  let status = task.status;
  for (let step = 0; step < 3; step++) {
    const options = availableTransitions(actor, { ...task, status });
    const next: TaskStatus | undefined = options.includes("DONE")
      ? "DONE"
      : options.includes("IN_REVIEW")
        ? "IN_REVIEW"
        : options.includes("IN_PROGRESS") && status !== "IN_REVIEW"
          ? "IN_PROGRESS"
          : undefined;
    if (!next) break;
    status = (await changeStatus(actor, taskId, next)).status;
    if (status === "DONE" || status === "IN_REVIEW") return status;
  }
  if (status === task.status) throw new TaskError("forbidden");
  return status;
}

function words(text: string) {
  return normalizeName(text)
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.max(3, w.length - 2)));
}

// Open tasks of the actor (assigned or created) whose title contains the query words.
export async function findTasksByQuery(actor: Actor, query: string, limit = 5) {
  const queryWords = words(query);
  if (queryWords.length === 0) return [];
  const tasks = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        { status: { notIn: CLOSED_STATUSES } },
        { OR: [{ assigneeId: actor.id }, { creatorId: actor.id }] },
      ],
    },
    select: { id: true, title: true, dueDate: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return tasks
    .map((task) => {
      const title = normalizeName(task.title);
      const hits = queryWords.filter((w) => title.includes(w)).length;
      return { task, score: hits / queryWords.length };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.task);
}
