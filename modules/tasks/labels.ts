import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canEditTask, canViewTask, isClosed, isDoer, visibleTasksWhere } from "./access";
import { TaskError } from "./errors";

// Labels of a task (BACKLOG item 24): short free words to group tasks across projects
// («срочно для HO», «выставка»), shown as chips and filtered by. The app puts its own there too
// («предыдущая не закрыта», «отложено» from a project plan).

export const MAX_LABELS = 10;
export const MAX_LABEL_LENGTH = 30;

// "a, b ,a" → ["a", "b"]: trimmed, spaces collapsed, no repeats (letter case aside), limited.
export function parseLabels(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const label = raw.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
    if (label && !out.some((l) => l.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out.slice(0, MAX_LABELS);
}

// Labelled by whoever changes the task's fields, and by the people who do it, while it is open.
export function canLabelTask(actor: Actor, task: Parameters<typeof canEditTask>[1]) {
  if (!canViewTask(actor, task) || isClosed(task.status)) return false;
  return canEditTask(actor, task) || isDoer(actor, task);
}

export async function setTaskLabels(actor: Actor, taskId: string, value: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canLabelTask(actor, task)) throw new TaskError("forbidden");
  const labels = parseLabels(value);
  if (labels.join("\n") === task.labels.join("\n")) return task;
  const updated = await db.task.update({ where: { id: taskId }, data: { labels } });
  await logActivity({
    actorId: actor.id,
    action: "task.labels_changed",
    entityType: "Task",
    entityId: taskId,
    details: { labels },
  });
  return updated;
}

// Labels already in use on tasks the actor sees: suggestions and the list's filter.
export async function knownLabels(actor: Actor): Promise<string[]> {
  const rows = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { labels: { isEmpty: false } }] },
    select: { labels: true },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });
  const seen = new Map<string, string>();
  for (const label of rows.flatMap((r) => r.labels))
    if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"));
}
