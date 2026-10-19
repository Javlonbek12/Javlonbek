import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma, Task, TaskStatus } from "@/lib/generated/prisma/client";
import { TaskPriority } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { approverIdsFor } from "@/modules/core/access/approvers";

import {
  canEditTask,
  canViewTask,
  CLOSED_STATUSES,
  isApprover,
  oversight,
  visibleTasksWhere,
} from "./access";
import { TaskError } from "./errors";
import { filtersWhere, scopeWhere, type Scope, type TaskFilters, type TaskSort } from "./filters";
import { sendTaskNotices, statusChangeRecipients } from "./notifications";
import { quickCounts, smartSort } from "./sort";
import { visiblePlansWhere } from "./plan-service";
import { availableTransitions, checkTransition } from "./status";
import { canViewMeeting } from "@/modules/meetings/access";
import { classifyByDueDate } from "./today";

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

export const CREATE_MODES = {
  draft: null,
  submit: "PENDING_APPROVAL",
  approve: "APPROVED",
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

export async function createTask(actor: Actor, input: TaskInput, mode: CreateMode = "draft") {
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
      isPersonal: data.isPersonal,
      creatorId: actor.id,
      assigneeId,
      meetingId: data.meetingId ?? null,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.created",
    entityType: "Task",
    entityId: task.id,
  });

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

export async function updateTask(actor: Actor, taskId: string, input: TaskInput) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canEditTask(actor, task)) throw new TaskError("forbidden");
  const data = parseInput({ ...input, isPersonal: task.isPersonal });
  await assertPlanAllowed(actor, data.planId, task.isPersonal);

  let assigneeId = task.assigneeId;
  if (!task.isPersonal && data.assigneeId && data.assigneeId !== task.assigneeId) {
    const assignee = await db.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee) throw new TaskError("invalid");
    assigneeId = assignee.id;
  }

  const next = { ...taskData(data), assigneeId };
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of TRACKED_FIELDS) {
    const before = comparable(task[field]);
    const after = comparable(next[field]);
    if (before !== after) changes[field] = [before, after];
  }
  if (Object.keys(changes).length === 0) return task;

  const updated = await db.task.update({ where: { id: taskId }, data: next });
  await logActivity({
    actorId: actor.id,
    action: "task.updated",
    entityType: "Task",
    entityId: taskId,
    details: changes as Prisma.InputJsonValue,
  });

  // A new assignee of an already approved task must learn about it.
  if (changes.assigneeId && task.approvedAt && assigneeId !== actor.id) {
    const notices = statusChangeRecipients(updated, "PENDING_APPROVAL", "APPROVED", actor.id, []);
    await sendTaskNotices(
      notices.filter((n) => n.userId === assigneeId),
      updated,
      await actorName(actor.id),
    );
  }
  return updated;
}

async function actorName(userId: string) {
  return displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));
}

export async function countOpenBlockers(taskId: string) {
  return db.taskDependency.count({
    where: { blockedId: taskId, blocker: { status: { notIn: CLOSED_STATUSES } } },
  });
}

export async function changeStatus(actor: Actor, taskId: string, to: TaskStatus, now = new Date()) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  const check = checkTransition(actor, task, to, await countOpenBlockers(taskId));
  if (!check.ok) throw new TaskError(check.reason);

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      status: to,
      approvedAt: to === "APPROVED" && !task.approvedAt ? now : undefined,
      completedAt: to === "DONE" ? now : null,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.status_changed",
    entityType: "Task",
    entityId: taskId,
    details: { from: task.status, to },
  });

  const notices = statusChangeRecipients(
    updated,
    task.status,
    to,
    actor.id,
    await approverIdsFor(updated),
  );
  await sendTaskNotices(notices, updated, await actorName(actor.id));
  return updated;
}

const listInclude = {
  assignee: { select: { id: true, firstName: true, lastName: true } },
  creator: { select: { id: true, firstName: true, lastName: true } },
  blockedBy: { select: { blocker: { select: { status: true } } } },
} satisfies Prisma.TaskInclude;

type TaskWithPeople = Prisma.TaskGetPayload<{ include: typeof listInclude }>;

// Plain object for the UI: dates as "YYYY-MM-DD", blocked flag precomputed.
export function toTaskView(task: TaskWithPeople) {
  const { blockedBy, ...rest } = task;
  return {
    ...rest,
    startDate: task.startDate ? toDateString(task.startDate) : null,
    dueDate: task.dueDate ? toDateString(task.dueDate) : null,
    openBlockers: blockedBy.filter((d) => !CLOSED_STATUSES.includes(d.blocker.status)).length,
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
    },
  });
  if (!task || !canViewTask(actor, task)) return null;
  return {
    task: {
      ...toTaskView(task),
      plan: task.plan,
      meeting: task.meeting,
      deleteRequestedBy: task.deleteRequestedBy,
    },
    transitions: availableTransitions(actor, task),
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

export async function getTodayOverview(actor: Actor, today: string) {
  const mine = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        { assigneeId: actor.id, status: { notIn: CLOSED_STATUSES } },
        { dueDate: { lte: fromDateString(today) } },
      ],
    },
    include: listInclude,
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
  });
  const { dueToday, overdue } = classifyByDueDate(mine.map(toTaskView), today);

  // "Waiting for my decision": tasks I can approve or accept as done.
  const candidates = await db.task.findMany({
    where: {
      AND: [
        visibleTasksWhere(actor),
        { isPersonal: false, status: { in: ["PENDING_APPROVAL", "IN_REVIEW"] } },
        isApprover(actor.role) ? {} : { creatorId: actor.id },
      ],
    },
    include: listInclude,
    orderBy: { updatedAt: "asc" },
  });
  const waiting = candidates
    .filter((task: Task) => {
      const transitions = availableTransitions(actor, task);
      return transitions.includes("APPROVED") || transitions.includes("DONE");
    })
    .map(toTaskView);

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
