import type { Prisma, Role, TaskStatus } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";

export type TaskAccessInfo = {
  isPersonal: boolean;
  creatorId: string;
  assigneeId: string;
  status: TaskStatus;
  approvedAt: Date | null;
};

export const CLOSED_STATUSES: TaskStatus[] = ["DONE", "CANCELLED"];

export function isApprover(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function isClosed(status: TaskStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

// Who sees a task:
// - personal: only its author (even OWNER does not see others' personal tasks);
// - team: the creator, OWNER/MANAGER, and the assignee once the task was approved.
export function canViewTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (task.isPersonal) return task.creatorId === actor.id;
  if (task.creatorId === actor.id || isApprover(actor.role)) return true;
  return task.assigneeId === actor.id && task.approvedAt !== null;
}

// The same rule as canViewTask, as a database filter.
export function visibleTasksWhere(actor: Actor): Prisma.TaskWhereInput {
  const rules: Prisma.TaskWhereInput[] = [
    { creatorId: actor.id },
    { isPersonal: false, assigneeId: actor.id, approvedAt: { not: null } },
  ];
  if (isApprover(actor.role)) rules.push({ isPersonal: false });
  return { OR: rules };
}

// Fields (title, dates, assignee...) are edited by the creator or OWNER/MANAGER
// (personal: only the author), and only while the task is not closed.
export function canEditTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (isClosed(task.status)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || isApprover(actor.role);
}
