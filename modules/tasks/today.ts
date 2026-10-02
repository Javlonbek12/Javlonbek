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
