import { z } from "zod";

import { addDays } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import { CLOSED_STATUSES } from "./access";

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
  });
}

export function scopeWhere(scope: Scope, actor: Actor): Prisma.TaskWhereInput {
  if (scope === "mine") return { assigneeId: actor.id };
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
  const and: Prisma.TaskWhereInput[] = [scopeWhere(filters.scope, actor)];

  if (filters.status === "active") and.push({ status: { notIn: CLOSED_STATUSES } });
  else if (filters.status !== "all") and.push({ status: filters.status });

  if (filters.project) and.push({ project: filters.project });
  if (filters.q) and.push({ title: { contains: filters.q, mode: "insensitive" } });
  if (!quick) return { AND: and };

  if (filters.priority === "important") and.push({ priority: { in: ["HIGH", "URGENT"] } });
  else if (filters.priority !== "any") and.push({ priority: filters.priority });

  if (filters.due === "overdue") {
    and.push({ dueDate: { lt: asDate(today) }, status: { notIn: CLOSED_STATUSES } });
  } else if (filters.due === "today") {
    and.push({ dueDate: asDate(today) });
  } else if (filters.due === "week") {
    and.push({ dueDate: { gte: asDate(today), lt: asDate(addDays(today, 7)) } });
  } else if (filters.due === "none") {
    and.push({ dueDate: null });
  }
  return { AND: and };
}
