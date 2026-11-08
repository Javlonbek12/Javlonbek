import { addDays, daysBetween, startOfWeek } from "@/lib/dates";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { isLateWork } from "@/modules/tasks/today";

// What the statistics need from a task (dates as "YYYY-MM-DD" in the viewer's timezone).
export type StatTask = {
  status: TaskStatus;
  dueDate: string | null;
  // When work was handed over: approval date for team tasks (else creation date).
  assignedAt: string;
  completedAt: string | null;
  estimateMinutes: number | null;
};

const CLOSED: TaskStatus[] = ["DONE", "CANCELLED"];

export function countActive(tasks: StatTask[]) {
  return tasks.filter((t) => !CLOSED.includes(t.status)).length;
}

// The same «просрочено» as in Tasks: work handed in waits for acceptance, it isn't late.
export function countOverdue(tasks: StatTask[], today: string) {
  return tasks.filter((t) => isLateWork(t, today)).length;
}

// Below this many tasks a percentage misleads («0%» from one late task): «1 из 2» is shown instead.
export const PERCENT_FROM_TASKS = 5;

// Share of tasks done by their due date, among tasks completed in the last `days` days that had a due date.
export function onTimeRate(tasks: StatTask[], today: string, days: number) {
  const from = addDays(today, -days);
  const counted = tasks.filter(
    (t) =>
      t.status === "DONE" &&
      t.completedAt !== null &&
      t.dueDate !== null &&
      t.completedAt > from &&
      t.completedAt <= today,
  );
  const onTime = counted.filter((t) => t.completedAt! <= t.dueDate!).length;
  return {
    onTime,
    total: counted.length,
    percent: counted.length === 0 ? null : Math.round((onTime / counted.length) * 100),
  };
}

// Average days from hand-over to completion, for tasks completed in the last `days` days.
export function averageDurationDays(tasks: StatTask[], today: string, days = 90): number | null {
  const from = addDays(today, -days);
  const durations = tasks
    .filter(
      (t) =>
        t.status === "DONE" &&
        t.completedAt !== null &&
        t.completedAt > from &&
        t.completedAt <= today,
    )
    .map((t) => Math.max(0, daysBetween(t.assignedAt, t.completedAt!)));
  if (durations.length === 0) return null;
  return Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
}

export type WeekLoad = { weekStart: string; tasks: number; hours: number; current: boolean };

// Tasks due per week (not cancelled): `before` weeks back and `after` weeks ahead of the current one.
export function weeklyLoad(tasks: StatTask[], today: string, before = 4, after = 3): WeekLoad[] {
  const current = startOfWeek(today);
  return Array.from({ length: before + after + 1 }, (_, i) => {
    const weekStart = addDays(current, (i - before) * 7);
    const weekEnd = addDays(weekStart, 7);
    const due = tasks.filter(
      (t) =>
        t.status !== "CANCELLED" &&
        t.dueDate !== null &&
        t.dueDate >= weekStart &&
        t.dueDate < weekEnd,
    );
    const minutes = due.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
    return {
      weekStart,
      tasks: due.length,
      hours: Math.round((minutes / 60) * 10) / 10,
      current: weekStart === current,
    };
  });
}

export function employeeStats(tasks: StatTask[], today: string) {
  return {
    active: countActive(tasks),
    overdue: countOverdue(tasks, today),
    onTime30: onTimeRate(tasks, today, 30),
    onTime90: onTimeRate(tasks, today, 90),
    averageDays: averageDurationDays(tasks, today),
    load: weeklyLoad(tasks, today),
  };
}

export type EmployeeStats = ReturnType<typeof employeeStats>;
