import { addDays } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/client";

import { isClosed } from "./access";

// "Smart" order of a task list: what needs attention first.
// Groups: overdue → due today → due within a week → later → no due date → closed;
// inside a group: more important first, then the nearer due date, then the newer task.

export const BUCKETS = ["overdue", "today", "week", "later", "noDue", "closed"] as const;
export type Bucket = (typeof BUCKETS)[number];

type Sortable = {
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: Date;
};

const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function bucketOf(task: Sortable, today: string): Bucket {
  if (isClosed(task.status)) return "closed";
  if (!task.dueDate) return "noDue";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return task.dueDate <= addDays(today, 7) ? "week" : "later";
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
  const weekEnd = addDays(today, 7);
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
