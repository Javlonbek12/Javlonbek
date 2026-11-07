import type { TaskStatus } from "@/lib/generated/prisma/client";
import type { Actor } from "@/modules/core/permissions";

import {
  canAccept,
  canControl,
  canDecide,
  isDoer,
  reviewerOf,
  type TaskAccessInfo,
} from "./access";

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

// Routing v2: "PENDING_APPROVAL" from a draft means "send": the route decides whether the task
// starts right away (APPROVED) or waits (see changeStatus). Nobody approves or accepts a task they
// do themselves; the owner's own task closes when handed in. Co-assignees move it as the assignee.
function teamTransitions(actor: Actor, task: TaskAccessInfo): TaskStatus[] {
  const creator = task.creatorId === actor.id;
  const assignee = isDoer(actor, task);
  const cancels = creator || canControl(actor, task);
  const result: TaskStatus[] = [];

  switch (task.status) {
    case "DRAFT":
      if (creator) result.push("PENDING_APPROVAL");
      break;
    case "PENDING_APPROVAL":
      // Approve («Утвердить», or «Принять задачу» for an assignee who decides themselves),
      // decline back to the author with a reason, or (the author) take it back.
      if (canDecide(actor, task)) result.push("APPROVED");
      if (canDecide(actor, task) || creator) result.push("DRAFT");
      break;
    case "APPROVED":
      if (assignee) result.push("IN_PROGRESS");
      break;
    case "IN_PROGRESS":
      if (assignee) result.push(reviewerOf(task) === null ? "DONE" : "IN_REVIEW");
      break;
    case "IN_REVIEW":
      if (canAccept(actor, task)) result.push("DONE");
      // Back to work: the reviewer with a reason, or the assignee taking it back.
      if (canAccept(actor, task) || assignee) result.push("IN_PROGRESS");
      break;
    default:
      return [];
  }
  if (cancels) result.push("CANCELLED");
  return result;
}

// Moves that need a reason, sent to the other side: declining a request for approval, and
// returning handed-in work. The author taking a task back, or the assignee, gives none.
export function needsReason(actor: Actor, task: TaskAccessInfo, to: TaskStatus): boolean {
  if (task.isPersonal) return false;
  if (task.status === "PENDING_APPROVAL" && to === "DRAFT") return task.creatorId !== actor.id;
  if (task.status === "IN_REVIEW" && to === "IN_PROGRESS") return !isDoer(actor, task);
  return false;
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
