import type { Prisma, Role, TaskStatus } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";

export type TaskAccessInfo = {
  isPersonal: boolean;
  creatorId: string;
  assigneeId: string;
  status: TaskStatus;
  approvedAt: Date | null;
  // Routing v2 (modules/tasks/routing.ts): who decides while it waits, who accepts the result.
  deciderIds?: string[];
  reviewerId?: string | null;
  // Co-assignees (team tasks): they do the work with the assignee but don't accept it.
  coAssigneeIds?: string[];
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
export function oversight(actor: Actor): "all" | "none" | string[] {
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

// Does the work: the assignee or a co-assignee.
export function isDoer(
  actor: Pick<Actor, "id">,
  task: Pick<TaskAccessInfo, "assigneeId" | "coAssigneeIds">,
): boolean {
  return task.assigneeId === actor.id || (task.coAssigneeIds ?? []).includes(actor.id);
}

// Who accepts the result: the author; for one's own task, the nearest manager (stored by the route);
// nobody for the owner's own task (handing it in closes it).
export function reviewerOf(task: Pick<TaskAccessInfo, "creatorId" | "assigneeId" | "reviewerId">) {
  return task.reviewerId ?? (task.creatorId !== task.assigneeId ? task.creatorId : null);
}

// Who sees a task:
// - personal: only its author (even OWNER does not see others' personal tasks);
// - team: the creator, whoever oversees it (OWNER, MANAGER per settings), whoever decides on it or
//   accepts its result, and the assignee and co-assignees once approved.
export function canViewTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (task.isPersonal) return task.creatorId === actor.id;
  if (task.creatorId === actor.id || oversees(actor, task)) return true;
  if (task.deciderIds?.includes(actor.id) || task.reviewerId === actor.id) return true;
  return isDoer(actor, task) && task.approvedAt !== null;
}

// Controls a team task (returns, cancels, accepts instead of the author, deletes): the owner, and
// a manager in whose zone it is — but never the one who does the work.
export function canControl(actor: Actor, task: TaskAccessInfo): boolean {
  if (task.isPersonal) return false;
  if (actor.role === "OWNER") return true;
  return oversees(actor, task) && !isDoer(actor, task);
}

// Decides on a task waiting for approval: whoever the route named, and the owner.
export function canDecide(actor: Actor, task: TaskAccessInfo): boolean {
  return (
    !task.isPersonal &&
    task.status === "PENDING_APPROVAL" &&
    (actor.role === "OWNER" || (task.deciderIds ?? []).includes(actor.id))
  );
}

// Accepts the handed-in result: the reviewer; instead of them the owner, or a manager in the zone
// when author and assignee differ. Never the assignee or a co-assignee.
export function canAccept(actor: Actor, task: TaskAccessInfo): boolean {
  if (task.isPersonal || task.status !== "IN_REVIEW" || isDoer(actor, task)) return false;
  if (reviewerOf(task) === actor.id || actor.role === "OWNER") return true;
  return task.creatorId !== task.assigneeId && canControl(actor, task);
}

// Tasks the person does: as the assignee, or as a co-assignee once approved (before that they
// can't see it).
export function doerWhere(userId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { assigneeId: userId },
      { isPersonal: false, coAssigneeIds: { has: userId }, approvedAt: { not: null } },
    ],
  };
}

// The same rule as canViewTask, as a database filter.
export function visibleTasksWhere(actor: Actor): Prisma.TaskWhereInput {
  const rules: Prisma.TaskWhereInput[] = [
    { creatorId: actor.id },
    { isPersonal: false, assigneeId: actor.id, approvedAt: { not: null } },
    { isPersonal: false, coAssigneeIds: { has: actor.id }, approvedAt: { not: null } },
    { isPersonal: false, deciderIds: { has: actor.id } },
    { isPersonal: false, reviewerId: actor.id },
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

// Fields (title, dates, assignee...) are edited by the creator or whoever controls the task
// (personal: only the author), and only while the task is not closed.
export function canEditTask(actor: Actor, task: TaskAccessInfo): boolean {
  if (isClosed(task.status)) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  return task.creatorId === actor.id || canControl(actor, task);
}
