import { db } from "@/lib/db";
import { addDays, daysBetween, todayInTimezone, toDateString } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";
import { displayName } from "@/modules/core/users/display-name";

import { chartWeeks, previousPeriod, type Period } from "./period";

// Everything the management report shows, for one period. Only team tasks count:
// personal tasks are private, drafts and unapproved proposals are not work yet.

const OPEN: TaskStatus[] = ["APPROVED", "IN_PROGRESS", "IN_REVIEW"];

type ReportTask = {
  id: string;
  title: string;
  project: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  assignee: string;
  // Local calendar dates.
  created: string;
  approved: string | null;
  due: string | null;
  completed: string | null;
};

export type Kpis = {
  created: number;
  completed: number;
  // Share of completed tasks (with a due date) finished by the due date; null if none.
  onTimePercent: number | null;
  // Average days from approval to completion.
  averageDays: number | null;
};

export type Report = {
  period: Period;
  previous: Period;
  today: string;
  generatedAt: Date;
  kpis: Kpis;
  previousKpis: Kpis;
  // State right now (not tied to the period).
  now: {
    active: number;
    overdue: number;
    overdueHigh: number;
    waitingApproval: number;
    inReview: number;
  };
  weeks: { weekStart: string; created: number; completed: number }[];
  people: {
    id: string;
    name: string;
    position: string | null;
    active: number;
    completed: number;
    overdue: number;
    onTimePercent: number | null;
  }[];
  projects: { name: string | null; completed: number; active: number; overdue: number }[];
  overdueTasks: (ReportTask & { daysOverdue: number })[];
  upcoming: ReportTask[];
  meetings: { held: number; tasksFromMeetings: number };
  planograms: { approved: number; pending: number };
  // Tasks completed or created in the period (for the Excel file).
  periodTasks: ReportTask[];
};

const inPeriod = (date: string | null, p: Period) =>
  date !== null && date >= p.from && date <= p.to;

function kpis(tasks: ReportTask[], p: Period): Kpis {
  const created = tasks.filter((t) => inPeriod(t.created, p)).length;
  const done = tasks.filter((t) => t.status === "DONE" && inPeriod(t.completed, p));
  const withDue = done.filter((t) => t.due !== null);
  const onTime = withDue.filter((t) => t.completed! <= t.due!).length;
  const durations = done
    .filter((t) => t.approved)
    .map((t) => Math.max(0, daysBetween(t.approved!, t.completed!)));
  return {
    created,
    completed: done.length,
    onTimePercent: withDue.length ? Math.round((onTime / withDue.length) * 100) : null,
    averageDays: durations.length
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : null,
  };
}

export async function buildReport(
  period: Period,
  timezone: string,
  now = new Date(),
): Promise<Report> {
  const today = todayInTimezone(timezone, now);
  const local = (date: Date) => todayInTimezone(timezone, date);
  const previous = previousPeriod(period);
  const rows = await db.task.findMany({
    where: { isPersonal: false, status: { notIn: ["DRAFT", "PENDING_APPROVAL"] } },
    include: {
      assignee: { select: { id: true, firstName: true, lastName: true, position: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const tasks: ReportTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    project: t.project,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    assignee: displayName(t.assignee),
    created: local(t.approvedAt ?? t.createdAt),
    approved: t.approvedAt ? local(t.approvedAt) : null,
    due: t.dueDate ? toDateString(t.dueDate) : null,
    completed: t.completedAt ? local(t.completedAt) : null,
  }));
  const open = tasks.filter((t) => OPEN.includes(t.status));
  const isOverdue = (t: ReportTask) => OPEN.includes(t.status) && t.due !== null && t.due < today;

  const weeks = chartWeeks(period).map((weekStart) => {
    const range = { from: weekStart, to: addDays(weekStart, 6) };
    return {
      weekStart,
      created: tasks.filter((t) => inPeriod(t.created, range)).length,
      completed: tasks.filter((t) => t.status === "DONE" && inPeriod(t.completed, range)).length,
    };
  });

  const assignees = new Map(rows.map((r) => [r.assigneeId, r.assignee]));
  const people = [...assignees.values()]
    .map((person) => {
      const mine = tasks.filter((t) => t.assigneeId === person.id);
      const k = kpis(mine, period);
      return {
        id: person.id,
        name: displayName(person),
        position: person.position,
        active: mine.filter((t) => OPEN.includes(t.status)).length,
        completed: k.completed,
        overdue: mine.filter(isOverdue).length,
        onTimePercent: k.onTimePercent,
      };
    })
    .filter((p) => p.active + p.completed > 0)
    .sort(
      (a, b) => b.overdue - a.overdue || b.completed - a.completed || a.name.localeCompare(b.name),
    );

  const projectNames = [...new Set(tasks.map((t) => t.project))];
  const projects = projectNames
    .map((name) => {
      const mine = tasks.filter((t) => t.project === name);
      return {
        name,
        completed: mine.filter((t) => t.status === "DONE" && inPeriod(t.completed, period)).length,
        active: mine.filter((t) => OPEN.includes(t.status)).length,
        overdue: mine.filter(isOverdue).length,
      };
    })
    .filter((p) => p.completed + p.active > 0)
    .sort((a, b) => b.active + b.completed - (a.active + a.completed));

  const priorityRank: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const overdueTasks = open
    .filter(isOverdue)
    .map((t) => ({ ...t, daysOverdue: daysBetween(t.due!, today) }))
    .sort(
      (a, b) =>
        priorityRank[a.priority] - priorityRank[b.priority] || b.daysOverdue - a.daysOverdue,
    );
  const upcoming = open
    .filter((t) => t.due !== null && t.due >= today && t.due <= addDays(today, 7))
    .sort(
      (a, b) => a.due!.localeCompare(b.due!) || priorityRank[a.priority] - priorityRank[b.priority],
    );

  const periodStart = new Date(`${period.from}T00:00:00Z`);
  const periodEnd = new Date(`${addDays(period.to, 1)}T00:00:00Z`);
  // A day of margin either side covers the timezone offset; then filter by local date.
  const around = {
    gte: new Date(periodStart.getTime() - 86_400_000),
    lt: new Date(periodEnd.getTime() + 86_400_000),
  };
  const [meetingRows, meetingTasks, approvedPlanograms, pendingPlanograms] = await Promise.all([
    db.meeting.findMany({ where: { startsAt: around }, select: { startsAt: true } }),
    db.task.findMany({
      where: { meetingId: { not: null }, isPersonal: false, createdAt: around },
      select: { createdAt: true },
    }),
    db.planogram.findMany({
      where: { approvedAt: around, isTemplate: false },
      select: { approvedAt: true },
    }),
    db.planogram.count({ where: { status: "PENDING_APPROVAL", isTemplate: false } }),
  ]);

  return {
    period,
    previous,
    today,
    generatedAt: now,
    kpis: kpis(tasks, period),
    previousKpis: kpis(tasks, previous),
    now: {
      active: open.length,
      overdue: overdueTasks.length,
      overdueHigh: overdueTasks.filter((t) => t.priority === "HIGH" || t.priority === "URGENT")
        .length,
      waitingApproval: await db.task.count({
        where: { isPersonal: false, status: "PENDING_APPROVAL" },
      }),
      inReview: open.filter((t) => t.status === "IN_REVIEW").length,
    },
    weeks,
    people,
    projects,
    overdueTasks,
    upcoming,
    meetings: {
      held: meetingRows.filter((m) => inPeriod(local(m.startsAt), period)).length,
      tasksFromMeetings: meetingTasks.filter((m) => inPeriod(local(m.createdAt), period)).length,
    },
    planograms: {
      approved: approvedPlanograms.filter((p) => inPeriod(local(p.approvedAt!), period)).length,
      pending: pendingPlanograms,
    },
    periodTasks: tasks.filter((t) => inPeriod(t.created, period) || inPeriod(t.completed, period)),
  };
}
