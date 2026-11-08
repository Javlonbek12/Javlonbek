import { z } from "zod";

import { addDays } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import { CLOSED_STATUSES, doerWhere } from "./access";
import { WEEK_DAYS } from "./sort";

export const SCOPES = ["mine", "created", "team"] as const;
// "smart": overdue first, then today, then by importance and due date (see sort.ts).
export const TASK_SORTS = ["smart", "due", "priority", "created", "updated"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];
export type Scope = (typeof SCOPES)[number];

const statusValues = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];

// Bad values fall back to defaults instead of failing: filters come from the URL.
export const taskFiltersSchema = z.object({
  scope: z.enum(SCOPES).catch("mine"),
  status: z.enum(["active", "all", ...statusValues]).catch("active"),
  due: z.enum(["any", "overdue", "today", "week", "none"]).catch("any"),
  // "important" = high and urgent.
  priority: z.enum(["any", "important", "URGENT", "HIGH", "MEDIUM", "LOW"]).catch("any"),
  project: z.string().max(60).catch(""),
  q: z.string().trim().max(100).catch(""),
  sort: z.enum(TASK_SORTS).catch("smart"),
  // An employee (user id): their tasks as the assignee, instead of "whose".
  person: z.string().max(64).catch(""),
  // A label: only tasks that have it.
  label: z.string().trim().max(30).catch(""),
});

export type TaskFilters = z.infer<typeof taskFiltersSchema>;

export function parseTaskFilters(params: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return taskFiltersSchema.parse({
    scope: first(params.scope),
    status: first(params.status),
    due: first(params.due),
    priority: first(params.priority),
    project: first(params.project) ?? "",
    q: first(params.q) ?? "",
    sort: first(params.sort),
    person: first(params.person) ?? "",
    label: first(params.label) ?? "",
  });
}

export function scopeWhere(scope: Scope, actor: Actor): Prisma.TaskWhereInput {
  if (scope === "mine") return doerWhere(actor.id);
  if (scope === "created") return { creatorId: actor.id };
  return { isPersonal: false };
}

const asDate = (value: string) => new Date(`${value}T00:00:00Z`);

// Filters on top of visibility (visibility is always added by the service).
// `quick: false` leaves out the quick filters (due, priority) — for counting the chips.
export function filtersWhere(
  filters: TaskFilters,
  actor: Actor,
  today: string,
  { quick = true }: { quick?: boolean } = {},
): Prisma.TaskWhereInput {
  // A chosen employee replaces "whose": all their tasks the actor may see.
  const and: Prisma.TaskWhereInput[] = [
    filters.person ? doerWhere(filters.person) : scopeWhere(filters.scope, actor),
  ];

  if (filters.status === "active") and.push({ status: { notIn: CLOSED_STATUSES } });
  else if (filters.status !== "all") and.push({ status: filters.status });

  if (filters.project) and.push({ project: filters.project });
  if (filters.label) and.push({ labels: { has: filters.label } });
  if (filters.q) and.push({ title: { contains: filters.q, mode: "insensitive" } });
  if (!quick) return { AND: and };

  if (filters.priority === "important") and.push({ priority: { in: ["HIGH", "URGENT"] } });
  else if (filters.priority !== "any") and.push({ priority: filters.priority });

  if (filters.due === "overdue") {
    // Handed-in work waits for acceptance: it is not «overdue» (see sort.ts).
    and.push({
      dueDate: { lt: asDate(today) },
      status: { notIn: [...CLOSED_STATUSES, "IN_REVIEW"] },
    });
  } else if (filters.due === "today") {
    and.push({ dueDate: asDate(today) });
  } else if (filters.due === "week") {
    // Today and the 6 days after it, like the «Ближайшие 7 дней» group with «Сегодня».
    and.push({ dueDate: { gte: asDate(today), lt: asDate(addDays(today, WEEK_DAYS)) } });
  } else if (filters.due === "none") {
    and.push({ dueDate: null });
  }
  return { AND: and };
}
