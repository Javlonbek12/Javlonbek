import { addDays, daysBetween, startOfWeek } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";
import { countTaskStates, isLateWork, taskState } from "@/modules/tasks/today";

// How a project is going, computed from its tasks. Pure functions: dates are "YYYY-MM-DD".
// «Просрочено», «в работе», «не начато» are the shared words of modules/tasks/today.ts: work
// handed in and waiting for acceptance is never overdue.

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
  assigneeId: string;
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
  const counts = countTaskStates(tasks, today);
  const atRisk = tasks.filter((task) => task.atRisk && !isDone(task)).length;
  // What should already be finished by the plan: everything due before today.
  const plannedDone = tasks.filter((task) => task.dueDate !== null && task.dueDate < today).length;
  const health: Health =
    tasks.length === 0
      ? "empty"
      : counts.done === tasks.length
        ? "done"
        : counts.late > 0
          ? "late"
          : atRisk > 0
            ? "risk"
            : "onTrack";
  return {
    total: counts.total,
    done: counts.done,
    inProgress: counts.inWork,
    inReview: counts.inReview,
    notStarted: counts.notStarted,
    overdue: counts.late,
    atRisk,
    percent: percent(counts.done, counts.total),
    plannedDone,
    plannedPercent: percent(plannedDone, counts.total),
    // Done tasks short of the plan («отстаёт на 2 задачи»); 0 when on or ahead of it.
    behind: Math.max(0, plannedDone - counts.done),
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
    const overdue = own.filter((task) => isLateWork(task, today)).length;
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
      overdue: isLateWork(task, today),
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
    overdue: take((task) => isLateWork(task, today)),
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

// «Кто что делает»: the people doing the project's tasks (the assignees, not the roles written in
// the template), with how many tasks are done, in work and overdue, and the nearest due date still
// ahead.
// Those with overdue work come first.
export function byPerson(all: ProjectTask[], today: string) {
  type Row = {
    id: string;
    name: string;
    total: number;
    done: number;
    inWork: number;
    overdue: number;
    nextDue: string | null;
  };
  const groups = new Map<string, Row>();
  for (const task of counted(all)) {
    const row = groups.get(task.assigneeId) ?? {
      id: task.assigneeId,
      name: task.assigneeName,
      total: 0,
      done: 0,
      inWork: 0,
      overdue: 0,
      nextDue: null,
    };
    const state = taskState(task, today);
    row.total += 1;
    if (state === "done") row.done += 1;
    if (state === "inWork") row.inWork += 1;
    if (state === "late") row.overdue += 1;
    const ahead = state === "inWork" || state === "notStarted";
    if (ahead && task.dueDate && (!row.nextDue || task.dueDate < row.nextDue))
      row.nextDue = task.dueDate;
    groups.set(task.assigneeId, row);
  }
  return [...groups.values()].sort(
    (a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name),
  );
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
    (task) => !isDone(task) && (isLateWork(task, today) || task.atRisk),
  );
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    count: problems.filter((task) => task.priority === priority).length,
  }));
}
