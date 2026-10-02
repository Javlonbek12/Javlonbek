import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { PlanLevel } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import { isApprover, visibleTasksWhere } from "./access";
import { TaskError } from "./errors";
import {
  canBeParent,
  normalizePeriodStart,
  periodLabel,
  planProgress,
  planSubtreeIds,
} from "./plans";

// Team plans are visible to everyone, personal plans only to their author.
export function visiblePlansWhere(actor: Actor): Prisma.PlanWhereInput {
  return { OR: [{ isPersonal: false }, { isPersonal: true, createdById: actor.id }] };
}

export const planInputSchema = z.object({
  title: z.string().trim().max(200),
  level: z.enum(PlanLevel),
  date: z.string().refine(isDateString),
  parentId: z
    .string()
    .max(64)
    .nullable()
    .transform((v) => v || null),
  isPersonal: z.boolean(),
});

export type PlanInput = z.input<typeof planInputSchema>;

export async function createPlan(actor: Actor, input: PlanInput) {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  const data = parsed.data;
  // Team plans are set by OWNER/MANAGER; anyone can keep personal plans.
  if (!data.isPersonal && !isApprover(actor.role)) throw new TaskError("forbidden");

  const periodStart = normalizePeriodStart(data.level, data.date);
  if (data.parentId) {
    const parent = await db.plan.findFirst({
      where: { id: data.parentId, ...visiblePlansWhere(actor) },
    });
    if (
      !parent ||
      parent.isPersonal !== data.isPersonal ||
      !canBeParent(
        { level: parent.level, periodStart: toDateString(parent.periodStart) },
        { level: data.level, periodStart },
      )
    ) {
      throw new TaskError("plan");
    }
  }

  return db.plan.create({
    data: {
      title: data.title || periodLabel(data.level, periodStart),
      level: data.level,
      periodStart: fromDateString(periodStart),
      isPersonal: data.isPersonal,
      createdById: actor.id,
      parentId: data.parentId,
    },
  });
}

// All visible plans with progress counted over the plan and its nested plans.
export async function listPlansWithProgress(actor: Actor) {
  const plans = await db.plan.findMany({
    where: visiblePlansWhere(actor),
    orderBy: [{ periodStart: "asc" }, { level: "asc" }, { title: "asc" }],
  });
  const tasks = await db.task.findMany({
    where: { planId: { in: plans.map((p) => p.id) } },
    select: { planId: true, status: true },
  });
  return plans.map((plan) => {
    const subtree = new Set(planSubtreeIds(plans, plan.id));
    return {
      ...plan,
      periodStart: toDateString(plan.periodStart),
      period: periodLabel(plan.level, toDateString(plan.periodStart)),
      progress: planProgress(tasks.filter((t) => subtree.has(t.planId!)).map((t) => t.status)),
    };
  });
}

export type PlanWithProgress = Awaited<ReturnType<typeof listPlansWithProgress>>[number];

export async function getPlanDetail(actor: Actor, planId: string) {
  const plans = await listPlansWithProgress(actor);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return null;
  const tasks = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { planId }] },
    include: { assignee: { select: { firstName: true, lastName: true } } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
  });
  return {
    plan,
    parent: plans.find((p) => p.id === plan.parentId) ?? null,
    children: plans.filter((p) => p.parentId === plan.id),
    tasks: tasks.map((t) => ({ ...t, dueDate: t.dueDate ? toDateString(t.dueDate) : null })),
  };
}
