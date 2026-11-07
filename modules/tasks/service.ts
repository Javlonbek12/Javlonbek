import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma, Task, TaskStatus } from "@/lib/generated/prisma/client";
import { TaskPriority } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import {
  canEditTask,
  canViewTask,
  canControl,
  CLOSED_STATUSES,
  doerWhere,
  isClosed,
  reviewerOf,
  oversight,
  visibleTasksWhere,
} from "./access";
import { TaskError } from "./errors";
import { filtersWhere, scopeWhere, type Scope, type TaskFilters, type TaskSort } from "./filters";
import { notifyTaskEvent, type TaskEvent } from "./notifications";
import { loadRouting, resolveRoute } from "./routing";
import { quickCounts, smartSort } from "./sort";
import { visiblePlansWhere } from "./plan-service";
import { taskButtons } from "./buttons";
import { availableTransitions, checkTransition, needsReason } from "./status";
import { canViewMeeting } from "@/modules/meetings/access";
import { classifyByDueDate } from "./today";
import type { RepeatInput } from "./repeat";
import { occurrencesBetween, copyDay } from "./repeat";
import { copyMode, createDueCopies, ruleOf, setRepeat, startSeries } from "./repeat-service";
import { copySteps, stepProgress } from "./step-rules";
import { dropCoAssigneeRequests, listCoAssigneeDecisions } from "./co-assignees";
import { stopTimersOnTask } from "./time-rules";
import { withAccess } from "@/modules/core/access/actor";
import { notify } from "@/modules/core/notifications/service";
import { t } from "@/lib/i18n";

const dateField = z
  .string()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || isDateString(value), "invalid date");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: optionalText(5000),
    isPersonal: z.boolean(),
    assigneeId: z.string().max(64).nullable(),
    startDate: dateField,
    dueDate: dateField,
    priority: z.enum(TaskPriority),
    project: optionalText(60),
    planId: z
      .string()
      .max(64)
      .nullable()
      .transform((value) => value || null),
    estimateHours: z.number().min(0).max(10_000).nullable(),
    // Only set when creating tasks from meeting minutes.
    meetingId: z.string().max(64).nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, "start after due");

export type TaskInput = z.input<typeof taskInputSchema>;

// "create" sends a team task along its route (it starts right away or waits for a decision);
// "start" starts a personal one; "draft" keeps either as a draft.
export const CREATE_MODES = {
  draft: null,
  create: "PENDING_APPROVAL",
  start: "IN_PROGRESS",
} as const satisfies Record<string, TaskStatus | null>;

export type CreateMode = keyof typeof CREATE_MODES;

function parseInput(input: TaskInput) {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  return parsed.data;
}

async function assertPlanAllowed(actor: Actor, planId: string | null, isPersonal: boolean) {
  if (!planId) return;
  const plan = await db.plan.findFirst({ where: { id: planId, ...visiblePlansWhere(actor) } });
  if (!plan || plan.isPersonal !== isPersonal) throw new TaskError("plan");
}

const taskData = (data: z.output<typeof taskInputSchema>) => ({
  title: data.title,
  description: data.description,
  priority: data.priority,
  project: data.project,
  planId: data.planId,
  startDate: data.startDate ? fromDateString(data.startDate) : null,
  dueDate: data.dueDate ? fromDateString(data.dueDate) : null,
  estimateMinutes: data.estimateHours === null ? null : Math.round(data.estimateHours * 60),
});

export async function createTask(
  actor: Actor,
  input: TaskInput,
  mode: CreateMode = "draft",
  // repeat: the task starts a repeating series; seriesId: the task is a copy made for one;
  // needsApproval: the author asks for approval even where the route starts it right away;
  // extra: project plan fields.
  options: {
    repeat?: RepeatInput | null;
    seriesId?: string;
    needsApproval?: boolean;
    extra?: Pick<
      Prisma.TaskUncheckedCreateInput,
      | "phaseId"
      | "code"
      | "responsible"
      | "isMilestone"
      | "atRisk"
      | "labels"
      | "historical"
      | "coAssigneeIds"
    >;
  } = {},
) {
  const data = parseInput(input);
  let assigneeId = actor.id;
  if (!data.isPersonal) {
    if (!data.assigneeId) throw new TaskError("invalid");
    const assignee = await db.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee) throw new TaskError("invalid");
    assigneeId = assignee.id;
  }
  await assertPlanAllowed(actor, data.planId, data.isPersonal);
  if (data.meetingId) {
    const meeting = await db.meeting.findUnique({
      where: { id: data.meetingId },
      include: { participants: { select: { userId: true } } },
    });
    const info = meeting && {
      createdById: meeting.createdById,
      participantIds: meeting.participants.map((p) => p.userId),
    };
    if (!info || !canViewMeeting(actor, info)) throw new TaskError("forbidden");
  }

  // Check the requested first step before saving anything.
  const target = CREATE_MODES[mode];
  const draft = {
    isPersonal: data.isPersonal,
    creatorId: actor.id,
    assigneeId,
    status: "DRAFT" as const,
    approvedAt: null,
  };
  if (target && !availableTransitions(actor, draft).includes(target))
    throw new TaskError("forbidden");

  const task = await db.task.create({
    data: {
      ...taskData(data),
      ...options.extra,
      isPersonal: data.isPersonal,
      creatorId: actor.id,
      assigneeId,
      meetingId: data.meetingId ?? null,
      seriesId: options.seriesId ?? null,
      needsApproval: !data.isPersonal && (options.needsApproval ?? false),
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.created",
    entityType: "Task",
    entityId: task.id,
  });
  if (options.repeat) {
    try {
      await startSeries(actor.id, task.id, data.dueDate, options.repeat);
    } catch (error) {
      // A repeat that can't start (no due date) leaves no half-made task behind.
      await db.task.delete({ where: { id: task.id } });
      throw error;
    }
  }

  return target ? changeStatus(actor, task.id, target) : task;
}

const TRACKED_FIELDS = [
  "title",
  "description",
  "assigneeId",
  "startDate",
  "dueDate",
  "priority",
  "project",
  "planId",
  "estimateMinutes",
] as const;

function comparable(value: unknown) {
  return value instanceof Date ? toDateString(value) : (value ?? null);
}

export async function updateTask(
  actor: Actor,
  taskId: string,
  input: TaskInput,
  // undefined: the repeat stays as it is; null: it stops.
  repeat?: RepeatInput | null,
) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canEditTask(actor, task)) throw new TaskError("forbidden");
  const data = parseInput({ ...input, isPersonal: task.isPersonal });
  await assertPlanAllowed(actor, data.planId, task.isPersonal);

  let assigneeId = task.assigneeId;
  if (!task.isPersonal && data.assigneeId && data.assigneeId !== task.assigneeId) {
    // Only before work starts: the route is worked out again for the new assignee.
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(task.status))
      throw new TaskError("assigneeLocked");
    const assignee = await db.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee) throw new TaskError("invalid");
    assigneeId = assignee.id;
  }

  const next = {
    ...taskData(data),
    assigneeId,
    // The new assignee is no co-assignee any more.
    ...(assigneeId !== task.assigneeId && task.coAssigneeIds.includes(assigneeId)
      ? { coAssigneeIds: task.coAssigneeIds.filter((id) => id !== assigneeId) }
      : {}),
  };
  if (repeat !== undefined) {
    if (repeat && !next.dueDate) throw new TaskError("repeatDate");
    await setRepeat(
      actor.id,
      { id: task.id, seriesId: task.seriesId, dueDate: next.dueDate },
      repeat,
    );
  }
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of TRACKED_FIELDS) {
    const before = comparable(task[field]);
    const after = comparable(next[field]);
    if (before !== after) changes[field] = [before, after];
  }
  if (Object.keys(changes).length === 0) return task;

  const reroute =
    changes.assigneeId && task.status !== "DRAFT"
      ? await routeFor(task.creatorId, assigneeId, task.needsApproval)
      : null;
  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      ...next,
      ...(changes.assigneeId && task.status === "DRAFT"
        ? {
            reviewerId: (await routeFor(task.creatorId, assigneeId, task.needsApproval)).reviewerId,
          }
        : {}),
      ...(reroute
        ? {
            status: reroute.status,
            deciderIds: reroute.deciderIds,
            reviewerId: reroute.reviewerId,
            approvedAt: reroute.status === "APPROVED" ? (task.approvedAt ?? new Date()) : null,
            approvedById: reroute.status === "APPROVED" ? task.approvedById : null,
            statusChangedAt: reroute.status === task.status ? task.statusChangedAt : new Date(),
          }
        : {}),
    },
  });
  // A request to add the new assignee as a co-assignee has nothing left to decide.
  if (changes.assigneeId)
    await db.taskCoAssigneeRequest.deleteMany({ where: { taskId, userId: assigneeId } });
  await logActivity({
    actorId: actor.id,
    action: "task.updated",
    entityType: "Task",
    entityId: taskId,
    details: changes as Prisma.InputJsonValue,
  });

  // The new assignee (or, if the task now waits, whoever decides) and the one taken off hear it.
  if (reroute) {
    const previousSaw =
      task.approvedAt !== null ||
      task.creatorId === task.assigneeId ||
      task.deciderIds.includes(task.assigneeId);
    await notifyTaskEvent(
      updated,
      { kind: "reassigned", previousAssigneeId: task.assigneeId, previousSaw },
      actor.id,
      await actorName(actor.id),
    );
  }
  return updated;
}

// A personal task becomes a team task (BACKLOG item 15): its author picks the assignee (themselves
// by default) and the route v2 decides, as for a new task — it starts right away or waits for a
// decision, and the same people hear about it. Work already going on one's own task goes on; given
// to someone else, it waits for them to take it. A personal plan can't hold a team task: it leaves
// the plan.
export async function makeTeamTask(
  actor: Actor,
  taskId: string,
  input: { assigneeId: string; needsApproval?: boolean },
  now = new Date(),
) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !task.isPersonal || task.creatorId !== actor.id || isClosed(task.status))
    throw new TaskError("forbidden");
  const assignee = await db.user.findUnique({ where: { id: input.assigneeId } });
  if (!assignee) throw new TaskError("invalid");
  const needsApproval = input.needsApproval ?? false;
  const route = await routeFor(actor.id, assignee.id, needsApproval);
  const goesOn =
    route.status === "APPROVED" && assignee.id === actor.id && task.status === "IN_PROGRESS";
  const status: TaskStatus = goesOn ? "IN_PROGRESS" : route.status;
  const plan = task.planId ? await db.plan.findUnique({ where: { id: task.planId } }) : null;
  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      isPersonal: false,
      assigneeId: assignee.id,
      needsApproval,
      status,
      statusChangedAt: status === task.status ? task.statusChangedAt : now,
      deciderIds: route.deciderIds,
      reviewerId: route.reviewerId,
      approvedAt: route.status === "APPROVED" ? now : null,
      approvedById: null,
      planId: plan?.isPersonal ? null : task.planId,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.made_team",
    entityType: "Task",
    entityId: taskId,
    details: { assignee: displayName(assignee), status },
  });
  await notifyTaskEvent(
    updated,
    route.status === "APPROVED"
      ? { kind: "started", teamNoticeId: route.teamNoticeId }
      : { kind: "pending" },
    actor.id,
    await actorName(actor.id),
  );
  return updated;
}

// The route of a team task from its author to an assignee, by today's reporting lines.
async function routeFor(authorId: string, assigneeId: string, needsApproval: boolean) {
  const { people, settings } = await loadRouting();
  return resolveRoute(people, settings, authorId, assigneeId, needsApproval);
}

async function actorName(userId: string) {
  return displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));
}

export async function countOpenBlockers(taskId: string) {
  return db.taskDependency.count({
    where: { blockedId: taskId, blocker: { status: { notIn: CLOSED_STATUSES } } },
  });
}

// Blocking tasks that were cancelled: accepting needs a conscious «despite» (not silently, as if
// the precondition were done).
export async function countCancelledBlockers(taskId: string) {
  return db.taskDependency.count({
    where: { blockedId: taskId, blocker: { status: "CANCELLED" } },
  });
}

export type StatusOptions = {
  // Why: required to decline a request for approval or to return handed-in work.
  reason?: string | null;
  // Accept although a blocking task was cancelled.
  despiteCancelled?: boolean;
  now?: Date;
};

export async function changeStatus(
  actor: Actor,
  taskId: string,
  requested: TaskStatus,
  options: StatusOptions = {},
) {
  const now = options.now ?? new Date();
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  const check = checkTransition(actor, task, requested, await countOpenBlockers(taskId));
  if (!check.ok) throw new TaskError(check.reason);
  const reason = options.reason?.trim().slice(0, 2000) || null;
  if (needsReason(actor, task, requested) && !reason) throw new TaskError("reason");
  if (
    requested === "DONE" &&
    !task.isPersonal &&
    !options.despiteCancelled &&
    (await countCancelledBlockers(taskId)) > 0
  )
    throw new TaskError("cancelledDependency");

  // Sending a team draft: the route decides whether it starts right away or waits.
  const route =
    !task.isPersonal && task.status === "DRAFT" && requested === "PENDING_APPROVAL"
      ? await routeFor(task.creatorId, task.assigneeId, task.needsApproval)
      : null;
  const to: TaskStatus = route ? route.status : requested;

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      status: to,
      statusChangedAt: now,
      ...(route ? { deciderIds: route.deciderIds, reviewerId: route.reviewerId } : {}),
      ...(to === "APPROVED" && !task.approvedAt
        ? { approvedAt: now, approvedById: route ? null : actor.id }
        : {}),
      // Back to draft: nobody decides on it any more.
      ...(to === "DRAFT" ? { deciderIds: [] } : {}),
      completedAt: to === "DONE" ? now : null,
      acceptedById: to === "DONE" && !task.isPersonal ? actor.id : null,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.status_changed",
    entityType: "Task",
    entityId: taskId,
    details: { from: task.status, to, ...(reason ? { reason } : {}) },
  });
  if (reason && !task.isPersonal)
    await db.comment.create({ data: { taskId, authorId: actor.id, body: reason } });
  if (isClosed(to) && !task.isPersonal) await dropCoAssigneeRequests(taskId);
  // A closed task: nobody works on it any more, its timers stop.
  if (isClosed(to)) await stopTimersOnTask(taskId, now);

  const event = statusEvent(task, updated, actor, route?.teamNoticeId ?? null, reason);
  if (event) await notifyTaskEvent(event.task, event.event, actor.id, await actorName(actor.id));
  return updated;
}

// The notification a status change makes (routing v2, «Уведомления»).
function statusEvent(
  before: Task,
  after: Task,
  actor: Actor,
  teamNoticeId: string | null,
  reason: string | null,
): { task: Task; event: TaskEvent } | null {
  const from = before.status;
  const to = after.status;
  if (from === "DRAFT" && to === "APPROVED")
    return { task: after, event: { kind: "started", teamNoticeId } };
  if (to === "PENDING_APPROVAL") return { task: after, event: { kind: "pending" } };
  if (from === "PENDING_APPROVAL" && to === "APPROVED")
    return { task: after, event: { kind: "approved" } };
  if (from === "PENDING_APPROVAL" && to === "DRAFT")
    // Deciders are cleared on the way back: the withdrawal goes to the ones it had.
    return before.creatorId === actor.id
      ? { task: before, event: { kind: "withdrawn" } }
      : { task: after, event: { kind: "rejected", reason: reason ?? "" } };
  if (from === "APPROVED" && to === "IN_PROGRESS") return { task: after, event: { kind: "taken" } };
  if (to === "IN_REVIEW") {
    const reviewer = reviewerOf(after);
    return { task: after, event: { kind: "review", reviewerIds: reviewer ? [reviewer] : [] } };
  }
  if (to === "DONE") return { task: after, event: { kind: "done" } };
  if (from === "IN_REVIEW" && to === "IN_PROGRESS")
    return { task: after, event: { kind: "rework", reason } };
  if (to === "CANCELLED")
    return {
      task: before,
      event: { kind: "cancelled", wasPending: from === "PENDING_APPROVAL", reason },
    };
  return null;
}

const listInclude = {
  assignee: { select: { id: true, firstName: true, lastName: true } },
  creator: { select: { id: true, firstName: true, lastName: true } },
  blockedBy: { select: { blocker: { select: { status: true } } } },
  steps: { select: { doneAt: true } },
} satisfies Prisma.TaskInclude;

type TaskWithPeople = Prisma.TaskGetPayload<{ include: typeof listInclude }>;

// Plain object for the UI: dates as "YYYY-MM-DD", blocked flag and step progress precomputed.
export function toTaskView(task: TaskWithPeople) {
  const { blockedBy, steps, ...rest } = task;
  return {
    ...rest,
    startDate: task.startDate ? toDateString(task.startDate) : null,
    dueDate: task.dueDate ? toDateString(task.dueDate) : null,
    openBlockers: blockedBy.filter((d) => !CLOSED_STATUSES.includes(d.blocker.status)).length,
    steps: stepProgress(steps),
  };
}

export type TaskView = ReturnType<typeof toTaskView>;

const ORDER_BY: Record<TaskSort, Prisma.TaskOrderByWithRelationInput[]> = {
  smart: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  due: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
  priority: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
  created: [{ createdAt: "desc" }],
  updated: [{ updatedAt: "desc" }],
};

export async function listTasks(actor: Actor, filters: TaskFilters, today: string) {
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), filtersWhere(filters, actor, today)] },
    include: listInclude,
    orderBy: ORDER_BY[filters.sort],
    take: 500,
  });
  const views = tasks.map(toTaskView);
  return filters.sort === "smart" ? smartSort(views, today) : views;
}

// How many tasks each quick filter (overdue, today, important...) would show.
export async function countQuickFilters(actor: Actor, filters: TaskFilters, today: string) {
  const rows = await db.task.findMany({
    where: {
      AND: [visibleTasksWhere(actor), filtersWhere(filters, actor, today, { quick: false })],
    },
    select: { status: true, priority: true, dueDate: true, createdAt: true },
    take: 2000,
  });
  return quickCounts(
    rows.map((r) => ({ ...r, dueDate: r.dueDate ? toDateString(r.dueDate) : null })),
    today,
  );
}

// Tasks shown in the calendar and timeline: personal ones, and team ones once approved.
const scheduledWhere: Prisma.TaskWhereInput = {
  status: { not: "CANCELLED" },
  OR: [{ isPersonal: true }, { approvedAt: { not: null } }],
};

// Copies of repeating tasks that don't exist yet (they are made on their start day), for the
// calendar: each series whose latest task the actor sees (and that fits the «Мои / Вся команда»
// choice) shows its next due dates in [from, to), like the latest task, with the day it appears.
export async function listPlannedRepeats(actor: Actor, scope: Scope, from: string, to: string) {
  const series = await db.taskSeries.findMany({
    where: { nextDate: { not: null, lt: fromDateString(to) } },
  });
  const planned: { key: string; dueDate: string; appearsOn: string; task: TaskView }[] = [];
  for (const s of series) {
    const latest = await db.task.findFirst({
      where: { seriesId: s.id },
      orderBy: [{ dueDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest) continue;
    const task = await db.task.findFirst({
      where: { AND: [{ id: latest.id }, visibleTasksWhere(actor), scopeWhere(scope, actor)] },
      include: listInclude,
    });
    if (!task) continue;
    const span =
      task.startDate && task.dueDate
        ? Math.max(0, Math.round((task.dueDate.getTime() - task.startDate.getTime()) / 86_400_000))
        : 0;
    for (const due of occurrencesBetween(ruleOf(s), toDateString(s.nextDate!), from, to))
      planned.push({
        key: `${s.id}:${due}`,
        dueDate: due,
        appearsOn: copyDay(due, span),
        task: toTaskView(task),
      });
  }
  return planned.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type PlannedRepeat = Awaited<ReturnType<typeof listPlannedRepeats>>[number];

export async function listTasksDueBetween(actor: Actor, scope: Scope, from: string, to: string) {
  const tasks = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        scopeWhere(scope, actor),
        scheduledWhere,
        { dueDate: { gte: fromDateString(from), lt: fromDateString(to) } },
      ],
    },
    include: listInclude,
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
  });
  return tasks.map(toTaskView);
}

// Tasks whose bar (startDate or dueDate .. dueDate) overlaps [from, to).
export async function listTimeline(actor: Actor, scope: Scope, from: string, to: string) {
  const tasks = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        scopeWhere(scope, actor),
        scheduledWhere,
        { dueDate: { gte: fromDateString(from) } },
        {
          OR: [
            { startDate: { lt: fromDateString(to) } },
            { startDate: null, dueDate: { lt: fromDateString(to) } },
          ],
        },
      ],
    },
    include: listInclude,
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { dueDate: "asc" }],
    take: 200,
  });
  const ids = tasks.map((t) => t.id);
  const edges = await db.taskDependency.findMany({
    where: { blockerId: { in: ids }, blockedId: { in: ids } },
    select: { blockerId: true, blockedId: true },
  });
  return { tasks: tasks.map(toTaskView), edges };
}

export async function getTaskDetail(actor: Actor, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      ...listInclude,
      plan: { select: { id: true, title: true } },
      meeting: { select: { id: true, title: true } },
      deleteRequestedBy: { select: { id: true, firstName: true, lastName: true } },
      series: true,
    },
  });
  if (!task || !canViewTask(actor, task)) return null;
  const transitions = availableTransitions(actor, task);
  // Who the route names (to decide, to accept the result) and who did, by name.
  const reviewerId = task.isPersonal ? null : reviewerOf(task);
  const ids = [...task.deciderIds, reviewerId, task.approvedById, task.acceptedById].filter(
    (id): id is string => id !== null,
  );
  const people = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const name = (id: string | null) => {
    const person = id ? people.find((p) => p.id === id) : null;
    return person ? displayName(person) : null;
  };
  return {
    task: {
      ...toTaskView(task),
      plan: task.plan,
      meeting: task.meeting,
      deleteRequestedBy: task.deleteRequestedBy,
      series: task.series,
    },
    transitions,
    buttons: taskButtons(actor, task, transitions),
    route: {
      deciders:
        task.status === "PENDING_APPROVAL"
          ? task.deciderIds.map(name).filter((n): n is string => n !== null)
          : [],
      reviewer: reviewerId && !isClosed(task.status) ? name(reviewerId) : null,
      approvedBy: task.approvedById !== task.creatorId ? name(task.approvedById) : null,
      acceptedBy: task.status === "DONE" ? name(task.acceptedById) : null,
    },
    cancelledBlockers:
      transitions.includes("DONE") && !task.isPersonal ? await countCancelledBlockers(task.id) : 0,
    canEdit: canEditTask(actor, task),
  };
}

export async function getTaskHistory(taskId: string) {
  return db.activityLog.findMany({
    where: { entityType: "Task", entityId: taskId },
    include: { actor: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listProjects(actor: Actor) {
  const rows = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { project: { not: null } }] },
    select: { project: true },
    distinct: ["project"],
    orderBy: { project: "asc" },
  });
  return rows.map((row) => row.project!).filter(Boolean);
}

// "Waiting for my decision": tasks the route gave me to decide on or to accept (owners and those
// who oversee can also act on others', but those are not theirs to wait on).
export async function listWaitingDecisions(actor: Actor) {
  const candidates = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        {
          isPersonal: false,
          OR: [
            { status: "PENDING_APPROVAL", deciderIds: { has: actor.id } },
            { status: "IN_REVIEW", NOT: { assigneeId: actor.id } },
          ],
        },
      ],
    },
    include: listInclude,
    orderBy: { statusChangedAt: "asc" },
  });
  return candidates
    .filter((task: Task) => {
      if (task.status === "IN_REVIEW" && reviewerOf(task) !== actor.id) return false;
      const transitions = availableTransitions(actor, task);
      return transitions.includes("APPROVED") || transitions.includes("DONE");
    })
    .map(toTaskView);
}

// Everything that waits for the actor's decision (the «Ждут решения» view): tasks to approve,
// work to accept, and requests to delete tasks they control.
export async function listDecisions(actor: Actor) {
  const [waiting, removals] = await Promise.all([
    listWaitingDecisions(actor),
    db.task.findMany({
      where: {
        AND: [
          visibleTasksWhere(actor),
          {
            isPersonal: false,
            deleteRequestedAt: { not: null },
            NOT: { deleteRequestedById: actor.id },
          },
        ],
      },
      include: listInclude,
      orderBy: { deleteRequestedAt: "asc" },
    }),
  ]);
  return {
    approve: waiting.filter((task) => task.status === "PENDING_APPROVAL"),
    accept: waiting.filter((task) => task.status === "IN_REVIEW"),
    remove: removals.filter((task) => canControl(actor, task)).map(toTaskView),
    coAssignees: await listCoAssigneeDecisions(actor),
  };
}

export async function countDecisions(actor: Actor) {
  const { approve, accept, remove, coAssignees } = await listDecisions(actor);
  return approve.length + accept.length + remove.length + coAssignees.length;
}

export async function getTodayOverview(actor: Actor, today: string) {
  const mine = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        doerWhere(actor.id),
        { status: { notIn: CLOSED_STATUSES } },
        { dueDate: { lte: fromDateString(today) } },
      ],
    },
    include: listInclude,
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
  });
  const { dueToday, overdue } = classifyByDueDate(mine.map(toTaskView), today);

  const waiting = await listWaitingDecisions(actor);

  return { dueToday, overdue, waiting };
}

// People whose tasks the actor can see (as assignees), for the "employee" filter.
// People for the "employee" filter: everyone whose tasks the actor oversees (even with no tasks
// yet), plus anyone else whose tasks they can see.
export async function listTaskPeople(actor: Actor) {
  const scope = oversight(actor);
  const select = { id: true, firstName: true, lastName: true } as const;
  const [overseen, withTasks] = await Promise.all([
    scope === "none"
      ? []
      : db.user.findMany({
          where: scope === "all" ? {} : { id: { in: [actor.id, ...scope] } },
          select,
        }),
    db.task.findMany({
      where: visibleTasksWhere(actor),
      distinct: ["assigneeId"],
      select: { assignee: { select } },
    }),
  ]);
  const people = new Map([...overseen, ...withTasks.map((r) => r.assignee)].map((u) => [u.id, u]));
  return [...people.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export async function listAssignableUsers() {
  return db.user.findMany({
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}

// The scheduler's part: copies of repeating tasks whose day has come, made by the series creator.
export async function createRepeatCopies(now = new Date()) {
  return createDueCopies(now, async (creatorId, copy, seriesId, previousOpenId) => {
    const creator = await withAccess(await db.user.findUniqueOrThrow({ where: { id: creatorId } }));
    const task = await createTask(
      creator,
      {
        title: copy.title,
        description: copy.description,
        isPersonal: copy.isPersonal,
        assigneeId: copy.isPersonal ? null : copy.assigneeId,
        startDate: copy.startDate,
        dueDate: copy.dueDate,
        priority: copy.priority as TaskInput["priority"],
        project: copy.project,
        planId: null,
        estimateHours: copy.estimateMinutes === null ? null : copy.estimateMinutes / 60,
      },
      copyMode(copy),
      {
        seriesId,
        extra: {
          labels: [
            ...copy.labels.filter((label) => label !== PREVIOUS_OPEN_LABEL),
            ...(previousOpenId ? [PREVIOUS_OPEN_LABEL] : []),
          ],
          coAssigneeIds: copy.coAssigneeIds.filter((id) => id !== copy.assigneeId),
        },
      },
    );
    await copySteps(copy.sourceId, task.id, copy.shiftDays);
    if (previousOpenId)
      await notify(creatorId, () => ({
        type: "task_status",
        title: t("notifications.events.taskPreviousOpenTitle"),
        body: t("notifications.events.taskBody", { title: copy.title, name: displayName(creator) }),
        link: `/tasks/${previousOpenId}`,
      }));
    return task;
  });
}

// The label on a copy made while the previous task of its series was still open.
export const PREVIOUS_OPEN_LABEL = "предыдущая не закрыта";
