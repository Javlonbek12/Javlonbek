import { z } from "zod";

import { db } from "@/lib/db";
import { createTask } from "@/modules/tasks/service";
import { daysBetween, fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { CLOSED_STATUSES } from "@/modules/tasks/access";

import { canManageProject, ProjectError } from "./service";
import { templateByKey } from "./templates";

// Adjusting a project's plan on the site: phases, tasks, moving the anchor day, the written plan.
// Only the owner and the project's lead.

async function managed(actor: Actor, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ProjectError("notFound");
  if (!canManageProject(actor, project)) throw new ProjectError("forbidden");
  return project;
}

const log = (actor: Actor, action: string, projectId: string, details?: Prisma.InputJsonValue) =>
  logActivity({ actorId: actor.id, action, entityType: "Project", entityId: projectId, details });

const optionalDate = z
  .string()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || isDateString(v), "date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const phaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: optionalDate,
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function savePhase(
  actor: Actor,
  projectId: string,
  phaseId: string | null,
  input: z.input<typeof phaseSchema>,
) {
  await managed(actor, projectId);
  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) throw new ProjectError("invalid");
  const data = {
    title: parsed.data.title,
    sortOrder: parsed.data.sortOrder,
    dueDate: parsed.data.dueDate ? fromDateString(parsed.data.dueDate) : null,
  };
  if (phaseId) {
    const updated = await db.projectPhase.updateMany({ where: { id: phaseId, projectId }, data });
    if (!updated.count) throw new ProjectError("notFound");
  } else {
    await db.projectPhase.create({ data: { ...data, projectId } });
  }
  await log(actor, "project.phase_saved", projectId);
}

// Its tasks stay in the project, without a phase.
export async function deletePhase(actor: Actor, projectId: string, phaseId: string) {
  await managed(actor, projectId);
  const deleted = await db.projectPhase.deleteMany({ where: { id: phaseId, projectId } });
  if (!deleted.count) throw new ProjectError("notFound");
  await log(actor, "project.phase_deleted", projectId);
}

const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    phaseId: optionalText(64),
    code: optionalText(20),
    responsible: optionalText(120),
    startDate: optionalDate,
    dueDate: optionalDate,
    isMilestone: z.boolean().default(false),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, "start after due");

export async function saveProjectTask(
  actor: Actor,
  projectId: string,
  taskId: string | null,
  input: z.input<typeof taskSchema>,
) {
  const project = await managed(actor, projectId);
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) throw new ProjectError("invalid");
  const { startDate, dueDate, phaseId, ...rest } = parsed.data;
  if (phaseId && !(await db.projectPhase.findFirst({ where: { id: phaseId, projectId } })))
    throw new ProjectError("invalid");
  const data = {
    ...rest,
    phaseId,
    startDate: startDate ? fromDateString(startDate) : null,
    dueDate: dueDate ? fromDateString(dueDate) : null,
  };
  if (taskId) {
    const updated = await db.task.updateMany({
      where: { id: taskId, project: project.name, status: { notIn: CLOSED_STATUSES } },
      data,
    });
    if (!updated.count) throw new ProjectError("notFound");
    await logActivity({
      actorId: actor.id,
      action: "task.updated",
      entityType: "Task",
      entityId: taskId,
      details: Object.fromEntries(Object.keys(data).map((k) => [k, true])),
    });
    return taskId;
  }
  // A new task of the plan goes along the route like any task (routing v2): the project lead
  // hears «Вам назначена задача», or whoever decides gets it for approval. A deactivated lead gets
  // no new work: the task is the actor's.
  const lead = project.leadId
    ? await db.user.findFirst({ where: { id: project.leadId, deactivatedAt: null } })
    : null;
  const assigneeId = lead?.id ?? actor.id;
  const task = await createTask(
    actor,
    {
      title: rest.title,
      description: null,
      isPersonal: false,
      assigneeId,
      startDate: startDate ?? null,
      dueDate: dueDate ?? null,
      priority: "MEDIUM",
      project: project.name,
      planId: null,
      estimateHours: null,
    },
    "create",
    {
      // The lead adding a task for themselves starts it right away, as everywhere else; one with
      // a start date ahead still waits.
      startOwn: true,
      extra: {
        phaseId: phaseId ?? null,
        code: rest.code ?? null,
        responsible: rest.responsible ?? null,
        isMilestone: rest.isMilestone,
      },
    },
  );
  return task.id;
}

// Moves the anchor day (e.g. the start of sales): every open task and phase deadline moves with it.
export async function shiftProject(actor: Actor, projectId: string, newAnchor: string) {
  const project = await managed(actor, projectId);
  if (!isDateString(newAnchor) || !project.anchorDate) throw new ProjectError("invalid");
  const days = daysBetween(toDateString(project.anchorDate), newAnchor);
  if (days === 0) return 0;
  await db.$transaction([
    db.$executeRaw`UPDATE "Task" SET "startDate" = "startDate" + ${days}::int, "dueDate" = "dueDate" + ${days}::int
      WHERE "project" = ${project.name} AND "isPersonal" = false AND "status" NOT IN ('DONE', 'CANCELLED')`,
    db.$executeRaw`UPDATE "ProjectPhase" SET "dueDate" = "dueDate" + ${days}::int WHERE "projectId" = ${projectId}`,
    db.project.update({
      where: { id: projectId },
      data: { anchorDate: fromDateString(newAnchor) },
    }),
  ]);
  await log(actor, "project.shifted", projectId, { days });
  return days;
}

// The written plan: only the template's sections are kept.
export async function savePlanSections(
  actor: Actor,
  projectId: string,
  input: Record<string, string>,
) {
  const project = await managed(actor, projectId);
  const template = templateByKey(project.template);
  if (!template?.sections.length) throw new ProjectError("invalid");
  const sections = Object.fromEntries(
    template.sections.map((s) => [s.key, (input[s.key] ?? "").trim().slice(0, 10_000)]),
  );
  await db.project.update({ where: { id: projectId }, data: { planSections: sections } });
  await log(actor, "project.plan_saved", projectId);
}
