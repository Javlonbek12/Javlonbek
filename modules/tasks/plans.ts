import type { PlanLevel, TaskStatus } from "@/lib/generated/prisma/client";
import {
  addDays,
  addMonths,
  formatDay,
  formatMonth,
  isoWeekNumber,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "@/lib/dates";

export const PLAN_LEVELS: PlanLevel[] = ["YEAR", "MONTH", "WEEK"];

export function parentLevel(level: PlanLevel): PlanLevel | null {
  return level === "WEEK" ? "MONTH" : level === "MONTH" ? "YEAR" : null;
}

export function normalizePeriodStart(level: PlanLevel, date: string): string {
  if (level === "YEAR") return startOfYear(date);
  if (level === "MONTH") return startOfMonth(date);
  return startOfWeek(date);
}

// Exclusive end of the period.
export function periodEnd(level: PlanLevel, periodStart: string): string {
  if (level === "YEAR") return `${Number(periodStart.slice(0, 4)) + 1}-01-01`;
  if (level === "MONTH") return addMonths(periodStart, 1);
  return addDays(periodStart, 7);
}

// A week belongs to the month of its Monday; a month to its year.
export function canBeParent(
  parent: { level: PlanLevel; periodStart: string },
  child: { level: PlanLevel; periodStart: string },
): boolean {
  if (parentLevel(child.level) !== parent.level) return false;
  return (
    child.periodStart >= parent.periodStart &&
    child.periodStart < periodEnd(parent.level, parent.periodStart)
  );
}

export function periodLabel(level: PlanLevel, periodStart: string): string {
  if (level === "YEAR") return periodStart.slice(0, 4);
  if (level === "MONTH") return formatMonth(periodStart);
  const end = addDays(periodStart, 6);
  return `Неделя ${isoWeekNumber(periodStart)} · ${formatDay(periodStart)} – ${formatDay(end)}`;
}

// Progress = share of DONE among tasks that were not cancelled.
export function planProgress(statuses: TaskStatus[]) {
  const counted = statuses.filter((status) => status !== "CANCELLED");
  const done = counted.filter((status) => status === "DONE").length;
  const total = counted.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// The plan itself plus all nested plans (year → months → weeks).
export function planSubtreeIds(
  plans: { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const result = [rootId];
  for (let i = 0; i < result.length; i++) {
    for (const plan of plans) if (plan.parentId === result[i]) result.push(plan.id);
  }
  return result;
}
