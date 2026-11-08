import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { Task } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName, personName } from "@/modules/core/users/display-name";

import {
  canEditTask,
  canViewTask,
  isClosed,
  isDoer,
  reviewerOf,
  type TaskAccessInfo,
} from "./access";
import { TaskError } from "./errors";
import { notifyTaskEvent, type TaskEvent } from "./notifications";
import { loadRouting, resolveRoute } from "./routing";
import { stepPeopleIds } from "./step-rules";
import { stopTimersOnTask } from "./time-rules";

// Co-assignees of a team task (BACKLOG item 24): they do what the assignee does — take the task
// into work, tick steps, hand it in — but don't accept the result. Adding someone follows the
// route v2: one's own team or below joins straight away; another team's person or a manager is a
// request that whoever the route names decides on (the owner may as well).

export const MAX_CO_ASSIGNEES = 10;

// Adds and takes off co-assignees: the author, whoever controls the task, and the assignee — while
// the team task is open.
export function canManageCoAssignees(actor: Actor, task: TaskAccessInfo) {
  if (task.isPersonal || isClosed(task.status) || !canViewTask(actor, task)) return false;
  return canEditTask(actor, task) || task.assigneeId === actor.id;
}

// Who can't be one: whoever already does it, and whoever accepts the result (a co-assignee never
// accepts, so the task would have nobody to accept it).
export function canJoin(
  userId: string,
  task: Pick<TaskAccessInfo, "creatorId" | "assigneeId" | "reviewerId" | "coAssigneeIds">,
) {
  return !isDoer({ id: userId }, task) && reviewerOf(task) !== userId;
}

export function canDecideCoAssignee(actor: Actor, request: { deciderIds: string[] }) {
  return actor.role === "OWNER" || request.deciderIds.includes(actor.id);
}

async function nameOf(userId: string) {
  return displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));
}

async function tell(task: Task, event: TaskEvent, actor: Actor) {
  await notifyTaskEvent(task, event, actor.id, await nameOf(actor.id));
}

async function join(task: Task, userId: string) {
  if (isDoer({ id: userId }, task)) return task;
  return db.task.update({
    where: { id: task.id },
    data: { coAssigneeIds: [...task.coAssigneeIds, userId] },
  });
}

export type AddCoAssigneeResult = "added" | "requested";

export async function addCoAssignee(
  actor: Actor,
  taskId: string,
  userId: string,
): Promise<AddCoAssigneeResult> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canManageCoAssignees(actor, task)) throw new TaskError("forbidden");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.deactivatedAt) throw new TaskError("invalid");
  if (isDoer(user, task)) throw new TaskError("coAssigneeExists");
  if (reviewerOf(task) === user.id) throw new TaskError("coAssigneeReviewer");
  if (task.coAssigneeIds.length >= MAX_CO_ASSIGNEES) throw new TaskError("tooManyCoAssignees");
  const waiting = await db.taskCoAssigneeRequest.findUnique({
    where: { taskId_userId: { taskId, userId } },
  });
  if (waiting) throw new TaskError("coAssigneeRequested");

  const { people, settings } = await loadRouting();
  const route = resolveRoute(people, settings, actor.id, userId);
  if (route.status === "APPROVED" || route.deciderIds.includes(actor.id)) {
    const updated = await join(task, userId);
    await logActivity({
      actorId: actor.id,
      action: "task.coassignee_added",
      entityType: "Task",
      entityId: taskId,
      details: { userId, name: displayName(user) },
    });
    await tell(updated, { kind: "coAdded", userId }, actor);
    return "added";
  }

  const request = await db.taskCoAssigneeRequest.create({
    data: { taskId, userId, requestedById: actor.id, deciderIds: route.deciderIds },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.coassignee_requested",
    entityType: "Task",
    entityId: taskId,
    details: { userId, name: displayName(user) },
  });
  await tell(
    task,
    {
      kind: "coRequested",
      requestId: request.id,
      deciderIds: route.deciderIds,
      name: displayName(user),
    },
    actor,
  );
  return "requested";
}

// Taken off by whoever adds them; a co-assignee may leave on their own. Says whether the actor
// still sees the task (one who left may not).
export async function removeCoAssignee(
  actor: Actor,
  taskId: string,
  userId: string,
): Promise<{ sees: boolean }> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  if (!task.coAssigneeIds.includes(userId)) throw new TaskError("invalid");
  const self = actor.id === userId;
  if (self ? isClosed(task.status) : !canManageCoAssignees(actor, task))
    throw new TaskError("forbidden");
  const updated = await db.task.update({
    where: { id: taskId },
    data: { coAssigneeIds: task.coAssigneeIds.filter((id) => id !== userId) },
  });
  // Their open steps are nobody's now (unless they are the author too).
  if (!stepPeopleIds(updated).includes(userId))
    await db.taskStep.updateMany({
      where: { taskId, responsibleId: userId, doneAt: null },
      data: { responsibleId: null },
    });
  // Off the task, off the clock: their timer on it stops (the time so far is kept).
  await stopTimersOnTask(taskId, new Date(), userId);
  await logActivity({
    actorId: actor.id,
    action: self ? "task.coassignee_left" : "task.coassignee_removed",
    entityType: "Task",
    entityId: taskId,
    details: { userId, name: await nameOf(userId) },
  });
  if (!self) await tell(task, { kind: "coRemoved", userId }, actor);
  return { sees: canViewTask(actor, updated) };
}

export async function decideCoAssignee(actor: Actor, requestId: string, approve: boolean) {
  const request = await db.taskCoAssigneeRequest.findUnique({
    where: { id: requestId },
    include: { task: true, user: true },
  });
  if (!request || !canDecideCoAssignee(actor, request)) throw new TaskError("forbidden");
  const { task, user } = request;
  await db.taskCoAssigneeRequest.delete({ where: { id: requestId } });
  // A task closed meanwhile, or the person deactivated: the request is simply gone.
  if (isClosed(task.status) || user.deactivatedAt) return;
  const full = approve && !isDoer(user, task) && task.coAssigneeIds.length >= MAX_CO_ASSIGNEES;
  if (full) throw new TaskError("tooManyCoAssignees");
  if (approve && reviewerOf(task) === user.id) throw new TaskError("coAssigneeReviewer");
  const updated = approve ? await join(task, user.id) : task;
  await logActivity({
    actorId: actor.id,
    action: approve ? "task.coassignee_approved" : "task.coassignee_declined",
    entityType: "Task",
    entityId: task.id,
    details: { userId: user.id, name: displayName(user) },
  });
  await tell(
    updated,
    {
      kind: "coDecided",
      requesterId: request.requestedById,
      name: displayName(user),
      approved: approve,
    },
    actor,
  );
  if (approve) await tell(updated, { kind: "coAdded", userId: user.id }, actor);
}

// The one who asked, or whoever adds co-assignees, takes a request back.
export async function withdrawCoAssigneeRequest(actor: Actor, requestId: string) {
  const request = await db.taskCoAssigneeRequest.findUnique({
    where: { id: requestId },
    include: { task: true },
  });
  if (!request) throw new TaskError("invalid");
  if (request.requestedById !== actor.id && !canManageCoAssignees(actor, request.task))
    throw new TaskError("forbidden");
  await db.taskCoAssigneeRequest.delete({ where: { id: requestId } });
  await logActivity({
    actorId: actor.id,
    action: "task.coassignee_withdrawn",
    entityType: "Task",
    entityId: request.taskId,
    details: { userId: request.userId, name: await nameOf(request.userId) },
  });
}

const person = {
  select: { id: true, firstName: true, lastName: true, deactivatedAt: true },
} as const;

// The co-assignees of a task and its requests waiting for a decision, by name, for the card.
export async function getCoAssignees(task: Pick<Task, "id" | "coAssigneeIds">) {
  const [people, requests] = await Promise.all([
    task.coAssigneeIds.length
      ? db.user.findMany({ where: { id: { in: task.coAssigneeIds } }, ...person })
      : [],
    db.taskCoAssigneeRequest.findMany({
      where: { taskId: task.id },
      include: { user: person, requestedBy: person },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const deciderIds = [...new Set(requests.flatMap((r) => r.deciderIds))];
  const deciders = deciderIds.length
    ? await db.user.findMany({ where: { id: { in: deciderIds } }, ...person })
    : [];
  const name = (id: string) => {
    const found = deciders.find((d) => d.id === id);
    return found ? personName(found) : null;
  };
  return {
    people: task.coAssigneeIds
      .map((id) => people.find((p) => p.id === id))
      .filter((p) => p !== undefined)
      .map((p) => ({ id: p.id, name: personName(p) })),
    requests: requests.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: personName(r.user),
      requestedById: r.requestedById,
      requestedBy: displayName(r.requestedBy),
      deciderIds: r.deciderIds,
      deciders: r.deciderIds.map(name).filter((n) => n !== null),
    })),
  };
}

export type CoAssigneesView = Awaited<ReturnType<typeof getCoAssignees>>;

// Requests waiting for the actor's decision («Ждут решения»), on open tasks.
export async function listCoAssigneeDecisions(actor: Actor) {
  const rows = await db.taskCoAssigneeRequest.findMany({
    where: {
      deciderIds: { has: actor.id },
      task: { status: { notIn: ["DONE", "CANCELLED"] } },
    },
    include: {
      user: person,
      requestedBy: person,
      task: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: displayName(r.user),
    requestedBy: displayName(r.requestedBy),
    task: { id: r.task.id, title: r.task.title, visible: canViewTask(actor, r.task) },
    createdAt: r.createdAt.toISOString(),
  }));
}

export type CoAssigneeDecision = Awaited<ReturnType<typeof listCoAssigneeDecisions>>[number];

// A closed task waits for nobody: its requests go.
export async function dropCoAssigneeRequests(taskId: string) {
  await db.taskCoAssigneeRequest.deleteMany({ where: { taskId } });
}

// What adding each person will do, in words, for the picker: joins right away or asks someone.
export async function coAssigneeHints(actorId: string): Promise<Record<string, string>> {
  const [{ people, settings }, users] = await Promise.all([
    loadRouting(),
    db.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
  ]);
  const names = new Map(users.map((u) => [u.id, displayName(u)]));
  const hints: Record<string, string> = {};
  for (const p of people) {
    const route = resolveRoute(people, settings, actorId, p.id);
    hints[p.id] =
      route.status === "APPROVED" || route.deciderIds.includes(actorId)
        ? t("tasks.coAssignees.direct")
        : route.deciderIds.length === 1 && route.deciderIds[0] === p.id
          ? t("tasks.coAssignees.self", { name: names.get(p.id) ?? "?" })
          : t("tasks.coAssignees.request", {
              names: route.deciderIds.map((id) => names.get(id) ?? "?").join(", "),
            });
  }
  return hints;
}
