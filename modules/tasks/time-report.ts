import type { TaskStatus } from "@/lib/generated/prisma/client";
import { addDays, fromDateString, toDateString, todayInTimezone } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import type { Period } from "@/modules/reports/period";

import { visibleTasksWhere } from "./access";

// «Who spent how much time» (BACKLOG item 24): finished time entries of a period, by person and
// task. Everyone sees the time on the tasks they see: a member — their own work and that of the
// people they share tasks with; a manager — their zone; the owner — all team tasks.

export type TimeReportEntry = {
  userId: string;
  userName: string;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  estimateMinutes: number | null;
  minutes: number;
  startedAt: Date;
  manual: boolean;
};

export type TimeReportTask = {
  id: string;
  title: string;
  status: TaskStatus;
  estimateMinutes: number | null;
  minutes: number;
};

export type TimeReportPerson = {
  id: string;
  name: string;
  minutes: number;
  tasks: TimeReportTask[];
};

// The day an entry counts for: a timer by when it started in the viewer's time zone, an entry
// added by hand by the day it was added for (stored as that date).
export function entryDay(entry: Pick<TimeReportEntry, "startedAt" | "manual">, timezone: string) {
  return entry.manual ? toDateString(entry.startedAt) : todayInTimezone(timezone, entry.startedAt);
}

export function groupTimeReport(entries: TimeReportEntry[], period: Period, timezone: string) {
  const people = new Map<string, TimeReportPerson & { byTask: Map<string, TimeReportTask> }>();
  let totalMinutes = 0;
  for (const e of entries) {
    const day = entryDay(e, timezone);
    if (day < period.from || day > period.to || e.minutes <= 0) continue;
    totalMinutes += e.minutes;
    const person = people.get(e.userId) ?? {
      id: e.userId,
      name: e.userName,
      minutes: 0,
      tasks: [],
      byTask: new Map<string, TimeReportTask>(),
    };
    person.minutes += e.minutes;
    const task = person.byTask.get(e.taskId) ?? {
      id: e.taskId,
      title: e.taskTitle,
      status: e.taskStatus,
      estimateMinutes: e.estimateMinutes,
      minutes: 0,
    };
    task.minutes += e.minutes;
    person.byTask.set(e.taskId, task);
    people.set(e.userId, person);
  }
  const byMinutes = (a: { minutes: number; name?: string; title?: string }, b: typeof a) =>
    b.minutes - a.minutes || (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "");
  const list = [...people.values()]
    .map(({ byTask, ...person }) => ({ ...person, tasks: [...byTask.values()].sort(byMinutes) }))
    .sort(byMinutes);
  return {
    totalMinutes,
    taskCount: new Set(list.flatMap((p) => p.tasks.map((t) => t.id))).size,
    people: list,
  };
}

export async function getTimeReport(actor: Actor, period: Period, timezone: string) {
  // A day margin on both sides: the time zone moves a timer's day by up to one.
  const entries = await db.taskTimeEntry.findMany({
    where: {
      endedAt: { not: null },
      minutes: { gt: 0 },
      startedAt: {
        gte: fromDateString(addDays(period.from, -1)),
        lt: fromDateString(addDays(period.to, 2)),
      },
      task: visibleTasksWhere(actor),
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      task: { select: { title: true, status: true, estimateMinutes: true } },
    },
  });
  return groupTimeReport(
    entries.map((e) => ({
      userId: e.userId,
      userName: displayName(e.user),
      taskId: e.taskId,
      taskTitle: e.task.title,
      taskStatus: e.task.status,
      estimateMinutes: e.task.estimateMinutes,
      minutes: e.minutes,
      startedAt: e.startedAt,
      manual: e.manual,
    })),
    period,
    timezone,
  );
}

export type TimeReport = Awaited<ReturnType<typeof getTimeReport>>;
