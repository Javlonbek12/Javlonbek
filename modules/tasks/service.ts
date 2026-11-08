import { z } from "zod";

import { db } from "@/lib/db";
import { addDays, fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma, Task, TaskStatus } from "@/lib/generated/prisma/client";
import { TaskPriority } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { activeOr, ACTIVE_USER } from "@/modules/core/users/active";
import { displayName, personName } from "@/modules/core/users/display-name";

import {
  canEditTask,
  canViewTask,
  canControl,
  CLOSED_STATUSES,
  doerWhere,
  isClosed,
  isDoer,
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
import { getUserToday } from "@/modules/core/settings/service";
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
  // startOwn: one's own task that starts right away goes straight into work (see changeStatus);
  // extra: project plan fields.
  options: {
    repeat?: RepeatInput | null;
    seriesId?: string;
    needsApproval?: boolean;
    startOwn?: boolean;
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
    if (!assignee || assignee.deactivatedAt) throw new TaskError("invalid");
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

  return target ? changeStatus(actor, task.id, target, { startOwn: options.startOwn }) : task;
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
    // Only before work starts (the route is worked out again for the new assignee) — or at any
    // time while open when the assignee was deactivated: their work goes to someone else.
    if (!assigneeOpen(task.status) && !(await isDeactivated(task.assigneeId)))
      throw new TaskError("assigneeLocked");
    const assignee = await db.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee || assignee.deactivatedAt) throw new TaskError("invalid");
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
  if (!assignee || assignee.deactivatedAt) throw new TaskError("invalid");
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

// Statuses in which the assignee can be changed: before work starts.
const ASSIGNEE_OPEN: TaskStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED"];
const assigneeOpen = (status: TaskStatus) => ASSIGNEE_OPEN.includes(status);

async function isDeactivated(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { deactivatedAt: true } });
  return Boolean(user?.deactivatedAt);
}

// The assignee can be changed now: before work starts, or while open if they were deactivated.
export function canChangeAssignee(task: {
  isPersonal: boolean;
  status: TaskStatus;
  assignee: { deactivatedAt: Date | null };
}) {
  if (task.isPersonal || isClosed(task.status)) return false;
  return assigneeOpen(task.status) || task.assignee.deactivatedAt !== null;
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
  // Sending one's own task that the route starts right away: straight into work («Создать» in
  // the form, the bot, repeats, a project plan). An imported plan keeps the statuses of its file.
  startOwn?: boolean;
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
  // One's own task that the route starts right away goes straight into work: nobody else has to
  // take it, so «Взять в работу» would be an extra click. One with a start date ahead waits.
  const startsOwn =
    options.startOwn === true &&
    route?.status === "APPROVED" &&
    task.assigneeId === task.creatorId &&
    (!task.startDate || toDateString(task.startDate) <= (await getUserToday(task.creatorId, now)));
  const to: TaskStatus = route ? (startsOwn ? "IN_PROGRESS" : route.status) : requested;
  const approves = !task.approvedAt && (to === "APPROVED" || route?.status === "APPROVED");

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      status: to,
      statusChangedAt: now,
      ...(route ? { deciderIds: route.deciderIds, reviewerId: route.reviewerId } : {}),
      ...(approves ? { approvedAt: now, approvedById: route ? null : actor.id } : {}),
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
  // Handed in or closed: nobody works on it any more, its timers stop.
  if (isClosed(to) || to === "IN_REVIEW") await stopTimersOnTask(taskId, now);

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
  // Started by the route (one's own task goes straight into work).
  if (from === "DRAFT" && (to === "APPROVED" || (to === "IN_PROGRESS" && !before.isPersonal)))
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

// A closed or cancelled task goes back to work within this time (owner's decision): an undo for a
// click too many, not a way to revive old tasks.
export const REOPEN_HOURS = 24;

// «Вернуть в работу»: the author or whoever controls the task (and the one who accepted it, whose
// click it undoes), within 24 hours of closing. A team task that never started (cancelled while it
// waited) can't: it was never in work.
export function canReopen(
  actor: Actor,
  task: Pick<Task, "isPersonal" | "creatorId" | "assigneeId" | "status" | "approvedAt"> &
    Pick<Task, "statusChangedAt" | "acceptedById" | "coAssigneeIds">,
  now = new Date(),
) {
  if (!isClosed(task.status)) return false;
  if (now.getTime() - task.statusChangedAt.getTime() > REOPEN_HOURS * 3_600_000) return false;
  if (task.isPersonal) return task.creatorId === actor.id;
  if (task.approvedAt === null) return false;
  return task.creatorId === actor.id || canControl(actor, task) || task.acceptedById === actor.id;
}

export async function reopenTask(actor: Actor, taskId: string, now = new Date()) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task) || !canReopen(actor, task, now))
    throw new TaskError("forbidden");
  const updated = await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS", statusChangedAt: now, completedAt: null, acceptedById: null },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.reopened",
    entityType: "Task",
    entityId: taskId,
    details: { from: task.status, to: "IN_PROGRESS" },
  });
  await notifyTaskEvent(updated, { kind: "reopened" }, actor.id, await actorName(actor.id));
  return updated;
}

// «Вернуть» right after the round button in a list: work handed in comes back from review (the
// doer takes it back); a task closed comes back to work.
export async function undoQuickClose(actor: Actor, taskId: string, now = new Date()) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  if (task.status === "IN_REVIEW") return changeStatus(actor, taskId, "IN_PROGRESS", { now });
  return reopenTask(actor, taskId, now);
}

const person = {
  select: { id: true, firstName: true, lastName: true, deactivatedAt: true },
} as const;

const listInclude = {
  assignee: person,
  creator: person,
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
    cancelledBlockers: blockedBy.filter((d) => d.blocker.status === "CANCELLED").length,
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

// A list shows at most this many tasks; a page that gets this many says it was cut.
export const LIST_LIMIT = 500;

export async function listTasks(actor: Actor, filters: TaskFilters, today: string) {
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), filtersWhere(filters, actor, today)] },
    include: listInclude,
    orderBy: ORDER_BY[filters.sort],
    take: LIST_LIMIT,
  });
  const views = tasks.map(toTaskView);
  return filters.sort === "smart" ? smartSort(views, today) : views;
}

// Days a done task stays on the board.
export const BOARD_DONE_DAYS = 30;

// The kanban board: every open task (cancelled ones hidden) and those done in the last 30 days.
// Open tasks are asked for on their own, so a long history never pushes them out; `cut` says
// that a part was left out.
export async function listBoardTasks(actor: Actor, filters: TaskFilters, today: string) {
  const where = (status: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({
    AND: [
      visibleTasksWhere(actor),
      filtersWhere({ ...filters, status: "all", due: "any" }, actor, today),
      status,
    ],
  });
  const [open, done] = await Promise.all([
    db.task.findMany({
      where: where({ status: { notIn: CLOSED_STATUSES } }),
      include: listInclude,
      orderBy: ORDER_BY.due,
      take: LIST_LIMIT,
    }),
    db.task.findMany({
      where: where({
        status: "DONE",
        completedAt: { gte: fromDateString(addDays(today, -BOARD_DONE_DAYS)) },
      }),
      include: listInclude,
      orderBy: { completedAt: "desc" },
      take: LIST_LIMIT,
    }),
  ]);
  return {
    tasks: [...open, ...done].map(toTaskView),
    cut: open.length >= LIST_LIMIT || done.length >= LIST_LIMIT,
  };
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

// At most this many bars on the timeline (the page says when it got this many).
export const TIMELINE_LIMIT = 200;

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
    take: TIMELINE_LIMIT,
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
    ? await db.user.findMany({ where: { id: { in: ids } }, ...person })
    : [];
  const name = (id: string | null) => {
    const found = id ? people.find((p) => p.id === id) : null;
    return found ? personName(found) : null;
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

// Everything that waits for the actor's decision: tasks to approve, work to accept, requests to
// delete tasks they control and to add co-assignees. The one source for «Ждут решения» wherever
// it shows: the tab and its badge, the home screen, the morning digest and the bot's /pending.
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

export type Decisions = Awaited<ReturnType<typeof listDecisions>>;

// How many decisions wait, counted the same way everywhere.
export function decisionCount({ approve, accept, remove, coAssignees }: Decisions) {
  return approve.length + accept.length + remove.length + coAssignees.length;
}

export async function countDecisions(actor: Actor) {
  return decisionCount(await listDecisions(actor));
}

// Statuses in which the one doing the task has nothing left to do: closed, or handed in (the
// due date is the reviewer's business then).
export const NOTHING_TO_DO: TaskStatus[] = [...CLOSED_STATUSES, "IN_REVIEW"];

export async function getTodayOverview(actor: Actor, today: string) {
  const mine = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        doerWhere(actor.id),
        { status: { notIn: NOTHING_TO_DO } },
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

// Overdue work of others that the actor answers for: team tasks they authored, decide on while
// they wait, or accept — but don't do themselves (their own are in «Просрочено»). Handed-in work
// is not here: it waits for acceptance. For «Просрочены у исполнителей» in the morning digest.
export async function listOverdueAtDoers(actor: Actor, today: string) {
  const tasks = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        {
          isPersonal: false,
          status: { notIn: NOTHING_TO_DO },
          dueDate: { lt: fromDateString(today) },
          NOT: { assigneeId: actor.id },
          OR: [
            { creatorId: actor.id },
            { reviewerId: actor.id },
            { status: "PENDING_APPROVAL", deciderIds: { has: actor.id } },
          ],
        },
      ],
    },
    include: listInclude,
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    take: 100,
  });
  // A co-assignee has it in their own «Просрочено» (checked here: the list column may be empty).
  return tasks.filter((task) => !isDoer(actor, task)).map(toTaskView);
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
          // Deactivated people stay in the filter only through the tasks they have.
          where: {
            ...ACTIVE_USER,
            ...(scope === "all" ? {} : { id: { in: [actor.id, ...scope] } }),
          },
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

// People new work can go to: active ones (plus `keep`, someone already chosen in the form).
export async function listAssignableUsers(keep: (string | null)[] = []) {
  return db.user.findMany({
    where: activeOr(keep),
    select: { id: true, firstName: true, lastName: true, deactivatedAt: true },
    orderBy: { firstName: "asc" },
  });
}

// The scheduler's part: copies of repeating tasks whose day has come, made by the series creator.
export async function createRepeatCopies(now = new Date()) {
  return createDueCopies(now, async (creatorId, copy, seriesId, previousOpenId) => {
    const creator = await withAccess(await db.user.findUniqueOrThrow({ where: { id: creatorId } }));
    // A deactivated assignee: the copy goes to whoever set up the repeat (they can pass it on);
    // deactivated co-assignees are left out.
    const gone = new Set(
      (
        await db.user.findMany({
          where: {
            id: { in: [copy.assigneeId, ...copy.coAssigneeIds] },
            deactivatedAt: { not: null },
          },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    const assigneeId = gone.has(copy.assigneeId) ? creatorId : copy.assigneeId;
    const task = await createTask(
      creator,
      {
        title: copy.title,
        description: copy.description,
        isPersonal: copy.isPersonal,
        assigneeId: copy.isPersonal ? null : assigneeId,
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
        startOwn: true,
        extra: {
          labels: [
            ...copy.labels.filter((label) => label !== PREVIOUS_OPEN_LABEL),
            ...(previousOpenId ? [PREVIOUS_OPEN_LABEL] : []),
          ],
          coAssigneeIds: copy.coAssigneeIds.filter((id) => id !== assigneeId && !gone.has(id)),
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
