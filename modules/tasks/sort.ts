import { addDays } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";

import { isClosed } from "./access";

// "Smart" order of a task list: what needs attention first.
// Groups: overdue → due today → the next 7 days → later → no due date → handed in → closed;
// inside a group: more important first, then the nearer due date, then the newer task.
// «Today» and «the next 7 days» together are the same 7 days (today..+6) as the «На 7 дней» chip
// and the bot's /week.

export const BUCKETS = ["overdue", "today", "week", "later", "noDue", "review", "closed"] as const;
export type Bucket = (typeof BUCKETS)[number];

// The days «На 7 дней» covers: today and the 6 after it.
export const WEEK_DAYS = 7;

type Sortable = {
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: Date;
};

const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function bucketOf(task: Sortable, today: string): Bucket {
  if (isClosed(task.status)) return "closed";
  // Handed in: the doer's part is done, it waits for acceptance (never «overdue»).
  if (task.status === "IN_REVIEW") return "review";
  if (!task.dueDate) return "noDue";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return task.dueDate < addDays(today, WEEK_DAYS) ? "week" : "later";
}

export function smartSort<T extends Sortable>(tasks: T[], today: string): T[] {
  const rank = (task: T) => BUCKETS.indexOf(bucketOf(task, today));
  return [...tasks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// Counts for the quick filters above the list (the same rules as the filters themselves).
export function quickCounts(tasks: Sortable[], today: string) {
  const weekEnd = addDays(today, WEEK_DAYS);
  return {
    all: tasks.length,
    overdue: tasks.filter((task) => bucketOf(task, today) === "overdue").length,
    today: tasks.filter((task) => task.dueDate === today).length,
    week: tasks.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate < weekEnd)
      .length,
    important: tasks.filter((task) => task.priority === "HIGH" || task.priority === "URGENT")
      .length,
    noDue: tasks.filter((task) => !task.dueDate).length,
  };
}
