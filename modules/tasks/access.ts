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

// Which team tasks the actor oversees (sees all of, approves, accepts). OWNER: all.
// MANAGER: per the role settings — all, their people's (creator or assignee below them), or none.
// Without loaded settings (`access`) the role's full rights apply.
function oversight(actor: Actor): "all" | "none" | string[] {
  if (actor.role === "OWNER") return "all";
  if (actor.role !== "MANAGER") return "none";
  const scope = actor.access?.taskScope ?? "all";
  if (scope === "all") return "all";
  return scope === "team" ? (actor.access?.teamIds ?? []) : "none";
}

export function oversees(
  actor: Actor,
  task: Pick<TaskAccessInfo, "creatorId" | "assigneeId">,
): boolean {
  const scope = oversight(actor);
  if (scope === "all") return true;
  if (scope === "none") return false;
  return scope.includes(task.creatorId) || scope.includes(task.assigneeId);
}

// Who sees a task:
// - personal: only its author (even OWNER does not see others' personal tasks);
// - team: the creator, whoever oversees it (OWNER, MANAGER per settings), and the assignee once approved.
export function canViewTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (task.isPersonal) return task.creatorId === actor.id;
  if (task.creatorId === actor.id || oversees(actor, task)) return true;
  return task.assigneeId === actor.id && task.approvedAt !== null;
}

// The same rule as canViewTask, as a database filter.
export function visibleTasksWhere(actor: Actor): Prisma.TaskWhereInput {
  const rules: Prisma.TaskWhereInput[] = [
    { creatorId: actor.id },
    { isPersonal: false, assigneeId: actor.id, approvedAt: { not: null } },
  ];
  const scope = oversight(actor);
  if (scope === "all") rules.push({ isPersonal: false });
  else if (scope !== "none" && scope.length) {
    rules.push({
      isPersonal: false,
      OR: [{ creatorId: { in: scope } }, { assigneeId: { in: scope } }],
    });
  }
  return { OR: rules };
}

// Fields (title, dates, assignee...) are edited by the creator or whoever oversees the task
// (personal: only the author), and only while the task is not closed.
export function canEditTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (isClosed(task.status)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || oversees(actor, task);
}
