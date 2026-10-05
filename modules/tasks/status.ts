import type { TaskStatus } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";

import { isApprover, oversees, type TaskAccessInfo } from "./access";

// Team workflow: DRAFT → PENDING_APPROVAL → APPROVED → IN_PROGRESS → IN_REVIEW → DONE, plus CANCELLED.
// Personal workflow skips approval: DRAFT → IN_PROGRESS → DONE.
export const TEAM_FLOW: TaskStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
];
export const PERSONAL_FLOW: TaskStatus[] = ["DRAFT", "IN_PROGRESS", "DONE"];

function personalTransitions(actor: Actor, task: TaskAccessInfo): TaskStatus[] {
  if (task.creatorId !== actor.id) return [];
  switch (task.status) {
    case "DRAFT":
      return ["IN_PROGRESS", "CANCELLED"];
    case "IN_PROGRESS":
      return ["DONE", "DRAFT", "CANCELLED"];
    default:
      return [];
  }
}

function teamTransitions(actor: Actor, task: TaskAccessInfo): TaskStatus[] {
  // Approving and accepting: for tasks the actor oversees (role settings may narrow a manager to their team).
  const approver = isApprover(actor.role) && oversees(actor, task);
  const creator = task.creatorId === actor.id;
  const assignee = task.assigneeId === actor.id;
  const manages = creator || approver;
  // Who accepts the result: the creator, unless they did the work themselves.
  const reviewer = approver || (creator && !assignee);
  const result: TaskStatus[] = [];

  switch (task.status) {
    case "DRAFT":
      if (creator) result.push("PENDING_APPROVAL");
      if (creator && approver) result.push("APPROVED");
      break;
    case "PENDING_APPROVAL":
      if (approver) result.push("APPROVED");
      if (manages) result.push("DRAFT");
      break;
    case "APPROVED":
      if (assignee) result.push("IN_PROGRESS");
      break;
    case "IN_PROGRESS":
      if (assignee) result.push("IN_REVIEW");
      break;
    case "IN_REVIEW":
      if (reviewer) result.push("DONE");
      if (reviewer || assignee) result.push("IN_PROGRESS");
      break;
    default:
      return [];
  }
  if (manages) result.push("CANCELLED");
  return result;
}

// Statuses the actor may move the task to right now (ignoring dependencies).
export function availableTransitions(actor: Actor, task: TaskAccessInfo): TaskStatus[] {
  return task.isPersonal ? personalTransitions(actor, task) : teamTransitions(actor, task);
}

export type TransitionCheck = { ok: true } | { ok: false; reason: "forbidden" | "blocked" };

// A task can't be DONE while any task blocking it is still open.
export function checkTransition(
  actor: Actor,
  task: TaskAccessInfo,
  to: TaskStatus,
  openBlockers: number,
): TransitionCheck {
  if (!availableTransitions(actor, task).includes(to)) return { ok: false, reason: "forbidden" };
  if (to === "DONE" && openBlockers > 0) return { ok: false, reason: "blocked" };
  return { ok: true };
}
