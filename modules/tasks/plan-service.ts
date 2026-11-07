import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { PlanLevel } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { isApprover, oversight, visibleTasksWhere } from "./access";
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

// A personal plan is changed and deleted by its author; a team plan also by the owner.
export function canManagePlan(actor: Actor, plan: { isPersonal: boolean; createdById: string }) {
  return plan.createdById === actor.id || (!plan.isPersonal && actor.role === "OWNER");
}

export async function createPlan(actor: Actor, input: PlanInput) {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  const data = parsed.data;
  // Team plans are set by OWNER/MANAGER; anyone can keep personal plans.
  // A team plan is made by whoever sees the team's tasks: not a manager limited to their own.
  if (!data.isPersonal && (!isApprover(actor.role) || oversight(actor) === "none"))
    throw new TaskError("forbidden");

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

const planUpdateSchema = planInputSchema.omit({ isPersonal: true });

// Title, period and parent can change; personal stays personal. Nested plans must still fit:
// a month with weeks cannot become a week or move to a month that does not hold its weeks.
export async function updatePlan(
  actor: Actor,
  planId: string,
  input: z.input<typeof planUpdateSchema>,
) {
  const parsed = planUpdateSchema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  const data = parsed.data;
  const plan = await db.plan.findFirst({ where: { id: planId, ...visiblePlansWhere(actor) } });
  if (!plan || !canManagePlan(actor, plan)) throw new TaskError("forbidden");

  const self = { level: data.level, periodStart: normalizePeriodStart(data.level, data.date) };
  if (data.parentId) {
    const parent = await db.plan.findFirst({
      where: { id: data.parentId, ...visiblePlansWhere(actor) },
    });
    if (
      !parent ||
      parent.isPersonal !== plan.isPersonal ||
      !canBeParent({ level: parent.level, periodStart: toDateString(parent.periodStart) }, self)
    )
      throw new TaskError("plan");
  }
  const children = await db.plan.findMany({ where: { parentId: planId } });
  if (
    children.some(
      (child) =>
        !canBeParent(self, { level: child.level, periodStart: toDateString(child.periodStart) }),
    )
  )
    throw new TaskError("planChildren");

  // A title that was just the period follows the new period.
  const oldLabel = periodLabel(plan.level, toDateString(plan.periodStart));
  const title =
    data.title && data.title !== oldLabel ? data.title : periodLabel(self.level, self.periodStart);
  const saved = await db.plan.update({
    where: { id: planId },
    data: {
      title,
      level: self.level,
      periodStart: fromDateString(self.periodStart),
      parentId: data.parentId,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "plan.updated",
    entityType: "Plan",
    entityId: planId,
    details: { title },
  });
  return saved;
}

// The tasks stay and just leave the plan; nested plans move up to the top level.
export async function deletePlan(actor: Actor, planId: string) {
  const plan = await db.plan.findFirst({ where: { id: planId, ...visiblePlansWhere(actor) } });
  if (!plan || !canManagePlan(actor, plan)) throw new TaskError("forbidden");
  const tasks = await db.task.count({ where: { planId } });
  await db.plan.delete({ where: { id: planId } });
  await logActivity({
    actorId: actor.id,
    action: "plan.deleted",
    entityType: "Plan",
    entityId: planId,
    details: { title: plan.title, tasks },
  });
  return { tasks };
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
    canManage: canManagePlan(actor, plan),
    // Where the plan can move: a plan one level up of the same kind (team or personal).
    parentOptions: plans.filter(
      (p) => p.id !== plan.id && p.level !== "WEEK" && p.isPersonal === plan.isPersonal,
    ),
    parent: plans.find((p) => p.id === plan.parentId) ?? null,
    children: plans.filter((p) => p.parentId === plan.id),
    tasks: tasks.map((t) => ({ ...t, dueDate: t.dueDate ? toDateString(t.dueDate) : null })),
  };
}
