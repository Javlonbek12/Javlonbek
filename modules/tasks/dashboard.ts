import { db } from "@/lib/db";
import { addDays, fromDateString, startOfWeek, todayInTimezone } from "@/lib/dates";
import type { Actor } from "@/modules/core/permissions";

import { CLOSED_STATUSES } from "./access";

export const DASHBOARD_WEEKS = 10;

// Tasks done per week (Monday..Sunday) for the last `weeks` weeks, oldest first.
export function weeklyDone(doneOn: string[], today: string, weeks = DASHBOARD_WEEKS) {
  const current = startOfWeek(today);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(current, (i - weeks + 1) * 7);
    const end = addDays(start, 6);
    return { start, count: doneOn.filter((day) => day >= start && day <= end).length };
  });
}

// The personal dashboard on "Today": my open tasks, what is in progress and overdue,
// done this week against what is due this week, and done tasks by week.
export async function getMyDashboard(actor: Actor, today: string, timeZone: string) {
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const since = addDays(weekStart, -7 * (DASHBOARD_WEEKS - 1) - 1);
  const [open, done] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: actor.id, status: { notIn: [...CLOSED_STATUSES, "DRAFT"] } },
      select: { status: true, dueDate: true },
    }),
    db.task.findMany({
      where: {
        assigneeId: actor.id,
        status: "DONE",
        completedAt: { gte: fromDateString(since) },
      },
      select: { completedAt: true },
    }),
  ]);
  const doneOn = done.map((task) => todayInTimezone(timeZone, task.completedAt!));
  const due = (task: { dueDate: Date | null }) => task.dueDate?.toISOString().slice(0, 10);
  const doneThisWeek = doneOn.filter((day) => day >= weekStart).length;
  return {
    open: open.length,
    inProgress: open.filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW").length,
    overdue: open.filter((t) => (due(t) ?? "9999") < today).length,
    doneThisWeek,
    // Done this week plus what is still open and due by Sunday.
    weekPlan: doneThisWeek + open.filter((t) => (due(t) ?? "9999") <= weekEnd).length,
    weeks: weeklyDone(doneOn, today),
  };
}
