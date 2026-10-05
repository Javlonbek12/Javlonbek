import { addDays, daysBetween, startOfWeek } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";
import { isOverdue } from "@/modules/tasks/today";

// How a project is going, computed from its tasks. Pure functions: dates are "YYYY-MM-DD".

export type ProjectTask = {
  id: string;
  title: string;
  code: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  // The day the task was closed as done.
  completedOn: string | null;
  phaseId: string | null;
  responsible: string | null;
  assigneeName: string;
  isMilestone: boolean;
  atRisk: boolean;
  openBlockers: number;
};

export type PhaseInfo = { id: string; title: string; dueDate: string | null };

export type Health = "done" | "late" | "risk" | "onTrack" | "empty";

const isDone = (task: Pick<ProjectTask, "status">) => task.status === "DONE";
const counted = (tasks: ProjectTask[]) => tasks.filter((task) => task.status !== "CANCELLED");
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export function projectStats(all: ProjectTask[], today: string) {
  const tasks = counted(all);
  const done = tasks.filter(isDone).length;
  const overdue = tasks.filter((task) => isOverdue(task, today)).length;
  const atRisk = tasks.filter((task) => task.atRisk && !isDone(task)).length;
  const inProgress = tasks.filter(
    (t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW",
  ).length;
  // What should already be finished by the plan: everything due before today.
  const plannedDone = tasks.filter((task) => task.dueDate !== null && task.dueDate < today).length;
  const health: Health =
    tasks.length === 0
      ? "empty"
      : done === tasks.length
        ? "done"
        : overdue > 0
          ? "late"
          : atRisk > 0
            ? "risk"
            : "onTrack";
  return {
    total: tasks.length,
    done,
    inProgress,
    notStarted: tasks.length - done - inProgress,
    overdue,
    atRisk,
    percent: percent(done, tasks.length),
    plannedDone,
    plannedPercent: percent(plannedDone, tasks.length),
    health,
  };
}

// The project's span: the earliest start (or due date) and the latest due date.
export function projectRange(tasks: ProjectTask[]): { from: string; to: string } | null {
  const starts = tasks.map((t) => t.startDate ?? t.dueDate).filter((d): d is string => d !== null);
  const ends = tasks.map((t) => t.dueDate).filter((d): d is string => d !== null);
  if (!starts.length || !ends.length) return null;
  return { from: starts.sort()[0]!, to: ends.sort().at(-1)! };
}

export type PhaseState = "done" | "late" | "active" | "upcoming" | "empty";

export function phaseProgress(phases: PhaseInfo[], all: ProjectTask[], today: string) {
  const tasks = counted(all);
  const groups = [
    ...phases,
    // Tasks of the project without a phase.
    ...(tasks.some((task) => task.phaseId === null)
      ? [{ id: null, title: null, dueDate: null }]
      : []),
  ];
  return groups.map((phase) => {
    const own = tasks.filter((task) => task.phaseId === phase.id);
    const range = projectRange(own);
    const done = own.filter(isDone).length;
    const overdue = own.filter((task) => isOverdue(task, today)).length;
    const state: PhaseState =
      own.length === 0
        ? "empty"
        : done === own.length
          ? "done"
          : overdue > 0
            ? "late"
            : range && range.from <= today
              ? "active"
              : "upcoming";
    return {
      id: phase.id,
      title: phase.title,
      dueDate: phase.dueDate ?? range?.to ?? null,
      from: range?.from ?? null,
      to: range?.to ?? null,
      total: own.length,
      done,
      overdue,
      atRisk: own.filter((task) => task.atRisk && !isDone(task)).length,
      percent: percent(done, own.length),
      state,
    };
  });
}

// "Plan vs fact" by week: how many tasks should be done by the end of each week (by due date)
// and how many were actually done (only up to the current week).
export function burnUp(all: ProjectTask[], today: string) {
  const tasks = counted(all);
  const range = projectRange(tasks);
  if (!range) return { total: tasks.length, weeks: [] };
  const weeks: { start: string; planned: number; actual: number | null }[] = [];
  for (let week = startOfWeek(range.from); week <= range.to; week = addDays(week, 7)) {
    const end = addDays(week, 6);
    weeks.push({
      start: week,
      planned: tasks.filter((task) => task.dueDate !== null && task.dueDate <= end).length,
      actual:
        week <= today
          ? tasks.filter((task) => isDone(task) && (task.completedOn ?? today) <= end).length
          : null,
    });
  }
  return { total: tasks.length, weeks };
}

export function milestones(tasks: ProjectTask[], today: string) {
  const list = tasks
    .filter((task) => task.isMilestone && task.dueDate && task.status !== "CANCELLED")
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map((task) => ({
      id: task.id,
      title: task.title,
      date: task.dueDate!,
      done: isDone(task),
      overdue: isOverdue(task, today),
    }));
  const next = list.find((m) => !m.done);
  return {
    list,
    next: next ? { ...next, daysLeft: daysBetween(today, next.date) } : null,
  };
}

// What needs a look now. Each task shows up once, in the first group that fits:
// overdue, at risk, should have started but waits for other tasks, due within a week.
export function attention(all: ProjectTask[], today: string) {
  const open = counted(all).filter((task) => !isDone(task));
  const soon = addDays(today, 7);
  const byDue = (a: ProjectTask, b: ProjectTask) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  const seen = new Set<string>();
  const take = (match: (task: ProjectTask) => boolean) => {
    const list = open.filter((task) => !seen.has(task.id) && match(task)).sort(byDue);
    for (const task of list) seen.add(task.id);
    return list;
  };
  return {
    overdue: take((task) => isOverdue(task, today)),
    atRisk: take((task) => task.atRisk),
    blocked: take(
      (task) =>
        task.openBlockers > 0 &&
        task.status !== "IN_PROGRESS" &&
        (task.startDate ?? task.dueDate ?? "9999") <= today,
    ),
    dueSoon: take((task) => task.dueDate !== null && task.dueDate <= soon),
  };
}

// Who carries the plan: by the responsible from the plan (or the assignee).
export function byResponsible(all: ProjectTask[], today: string) {
  const groups = new Map<string, { name: string; total: number; done: number; overdue: number }>();
  for (const task of counted(all)) {
    const name = task.responsible ?? task.assigneeName;
    const group = groups.get(name) ?? { name, total: 0, done: 0, overdue: 0 };
    group.total += 1;
    if (isDone(task)) group.done += 1;
    if (isOverdue(task, today)) group.overdue += 1;
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// Gantt: where a bar starts and how long it is, in days from the chart's first day.
export function ganttBar(
  item: { from: string | null; to: string | null },
  chartFrom: string,
): { offset: number; length: number } | null {
  if (!item.to) return null;
  const start = item.from ?? item.to;
  return { offset: daysBetween(chartFrom, start), length: daysBetween(start, item.to) + 1 };
}

export const PRIORITY_ORDER: TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

// Problems (open tasks that are overdue or at risk) by priority, most important first.
export function problemsByPriority(all: ProjectTask[], today: string) {
  const problems = counted(all).filter(
    (task) => !isDone(task) && (isOverdue(task, today) || task.atRisk),
  );
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    count: problems.filter((task) => task.priority === priority).length,
  }));
}
