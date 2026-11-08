import { db } from "@/lib/db";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { CLOSED_STATUSES, reviewerOf } from "./access";
import { removeCoAssignee } from "./co-assignees";
import { TaskError } from "./errors";
import { notifyTaskEvent } from "./notifications";
import { updateTaskField } from "./quick-actions";
import { loadRouting, resolveRoute } from "./routing";
import { finishTimer } from "./time-rules";

// What deactivating a person (modules/team/deactivation.ts) means for tasks: their open work can go
// to someone else, they leave the tasks they help with, and nothing waits only on them any more.
// Everything they did stays as it was.

// Work that can go to someone else. Work already handed in (IN_REVIEW) stays theirs: it waits for
// acceptance, not for them (sent back, it can be given to someone else then).
const HANDED_OVER: TaskStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "IN_PROGRESS"];

// Their open team tasks (as the assignee) go to `toId` one by one through the usual change of
// assignee: the route is worked out again and the right people hear it. Their own unsent drafts
// stay theirs. Returns how many moved and the ones that couldn't.
export async function handOverTasks(actor: Actor, fromId: string, toId: string) {
  const tasks = await db.task.findMany({
    where: {
      assigneeId: fromId,
      isPersonal: false,
      status: { in: HANDED_OVER },
      NOT: { status: "DRAFT", creatorId: fromId },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  let moved = 0;
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      await updateTaskField(actor, task.id, "assigneeId", toId);
      moved += 1;
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      failed.push(task.id);
    }
  }
  return { moved, failed };
}

// Off every open task they help with (their timer and steps there stop being theirs), and their
// requests to join a task are dropped.
export async function leaveCoAssignedTasks(actor: Actor, userId: string) {
  const tasks = await db.task.findMany({
    where: { coAssigneeIds: { has: userId }, status: { notIn: CLOSED_STATUSES } },
    select: { id: true },
  });
  for (const task of tasks) await removeCoAssignee(actor, task.id, userId);
  await db.taskCoAssigneeRequest.deleteMany({ where: { userId } });
  return tasks.length;
}

// Their running timers stop (the time so far is kept).
export async function stopTimersOf(userId: string, now = new Date()) {
  const running = await db.taskTimeEntry.findMany({ where: { userId, endedAt: null } });
  for (const entry of running) await finishTimer(entry, now);
}

// Nothing open waits only on them: a task (or a request to add a co-assignee) waiting for their
// decision goes to the others who decide, else to whoever the route names now (the next manager
// up), else to the owner; whoever accepts the result instead of them is worked out by the route
// again (the next manager up from them, or the owner). Those who now decide hear it. Call after
// they are marked deactivated, so the route passes them over.
export async function releaseDecisions(actor: Actor, userId: string) {
  const { people, settings } = await loadRouting();
  const owners = people.filter((p) => p.role === "OWNER" && !p.deactivated).map((p) => p.id);
  const routeOf = (task: { creatorId: string; assigneeId: string; needsApproval: boolean }) =>
    resolveRoute(people, settings, task.creatorId, task.assigneeId, task.needsApproval);
  const actorName = displayName(await db.user.findUniqueOrThrow({ where: { id: actor.id } }));
  let moved = 0;

  const waiting = await db.task.findMany({
    where: { isPersonal: false, status: "PENDING_APPROVAL", deciderIds: { has: userId } },
  });
  for (const task of waiting) {
    const others = task.deciderIds.filter((id) => id !== userId);
    const route = routeOf(task);
    const deciderIds = others.length
      ? others
      : route.status === "PENDING_APPROVAL" && route.deciderIds.length
        ? route.deciderIds
        : owners;
    const updated = await db.task.update({ where: { id: task.id }, data: { deciderIds } });
    if (!others.length) await notifyTaskEvent(updated, { kind: "pending" }, actor.id, actorName);
    moved += 1;
  }

  const accepting = await db.task.findMany({
    where: {
      isPersonal: false,
      status: { notIn: [...CLOSED_STATUSES, "DRAFT"] },
      OR: [
        { reviewerId: userId },
        // Tasks from before the route stored a reviewer: their author accepts.
        { reviewerId: null, creatorId: userId, NOT: { assigneeId: userId } },
      ],
    },
  });
  for (const task of accepting) {
    const updated = await db.task.update({
      where: { id: task.id },
      data: { reviewerId: routeOf(task).reviewerId },
    });
    const reviewer = reviewerOf(updated);
    if (updated.status === "IN_REVIEW" && reviewer)
      await notifyTaskEvent(
        updated,
        { kind: "review", reviewerIds: [reviewer] },
        actor.id,
        actorName,
      );
    moved += 1;
  }

  const requests = await db.taskCoAssigneeRequest.findMany({
    where: { deciderIds: { has: userId } },
    include: { task: true, user: true },
  });
  for (const request of requests) {
    const others = request.deciderIds.filter((id) => id !== userId);
    const route = resolveRoute(people, settings, request.requestedById, request.userId);
    const deciderIds = others.length
      ? others
      : route.status === "PENDING_APPROVAL" && route.deciderIds.length
        ? route.deciderIds
        : owners;
    await db.taskCoAssigneeRequest.update({ where: { id: request.id }, data: { deciderIds } });
    if (!others.length)
      await notifyTaskEvent(
        request.task,
        {
          kind: "coRequested",
          requestId: request.id,
          deciderIds,
          name: displayName(request.user),
        },
        actor.id,
        actorName,
      );
    moved += 1;
  }
  return moved;
}
