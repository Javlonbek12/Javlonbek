import type { TaskStatus } from "@/lib/generated/prisma/client";

import { isClosed } from "./access";

type DatedTask = { status: TaskStatus; dueDate: string | null };

// For the "Today" screen: open tasks due today, and open tasks past their due date.
export function classifyByDueDate<T extends DatedTask>(tasks: T[], today: string) {
  const open = tasks.filter((task) => !isClosed(task.status) && task.dueDate !== null);
  return {
    dueToday: open.filter((task) => task.dueDate === today),
    overdue: open.filter((task) => task.dueDate! < today),
  };
}

export function isOverdue(task: DatedTask, today: string): boolean {
  return !isClosed(task.status) && task.dueDate !== null && task.dueDate < today;
}

// Task lists: work handed in waits for acceptance — it shows as «ждёт приёмки», not as overdue.
export function isLateWork(task: DatedTask, today: string): boolean {
  return task.status !== "IN_REVIEW" && isOverdue(task, today);
}

// One dictionary for the words people see next to task numbers, so «в работе», «просрочено» and
// «не начато» mean the same on «Сегодня», in the calendar, the timeline, projects and the team.
// Each task is in exactly one state, so the numbers add up:
// - late («просрочено»): open, past its due date and not handed in;
// - inReview («на проверке»): handed in, waits for acceptance — never late;
// - inWork («в работе»): taken into work, on time;
// - notStarted («не начато»): waits to be taken into work (or decided on), on time;
// - done, cancelled.
export type TaskState = "done" | "cancelled" | "late" | "inReview" | "inWork" | "notStarted";

export function taskState(task: DatedTask, today: string): TaskState {
  if (task.status === "DONE") return "done";
  if (task.status === "CANCELLED") return "cancelled";
  if (task.status === "IN_REVIEW") return "inReview";
  if (isLateWork(task, today)) return "late";
  return task.status === "IN_PROGRESS" ? "inWork" : "notStarted";
}

// The numbers for a group of tasks, by `taskState`; cancelled tasks are not counted at all.
// `dueToday`: open tasks (not handed in) due today — a part of inWork and notStarted.
export function countTaskStates(tasks: DatedTask[], today: string) {
  const counts = { total: 0, done: 0, late: 0, inReview: 0, inWork: 0, notStarted: 0, dueToday: 0 };
  for (const task of tasks) {
    const state = taskState(task, today);
    if (state === "cancelled") continue;
    counts.total += 1;
    counts[state] += 1;
    if ((state === "inWork" || state === "notStarted") && task.dueDate === today)
      counts.dueToday += 1;
  }
  return counts;
}

export type TaskStateCounts = ReturnType<typeof countTaskStates>;
