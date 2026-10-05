import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString, todayInTimezone } from "@/lib/dates";
import { logActivity } from "@/modules/core/activity/service";
import { canUseModule } from "@/modules/core/access/actor";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { canEditTask, CLOSED_STATUSES, visibleTasksWhere } from "@/modules/tasks/access";

import { applyTemplate } from "./apply-template";
import {
  milestones,
  problemsByPriority,
  projectRange,
  projectStats,
  type ProjectTask,
} from "./progress";
import { templateByKey } from "./templates";

export class ProjectError extends Error {
  constructor(public readonly code: "forbidden" | "invalid" | "notFound" | "nameTaken") {
    super(code);
    this.name = "ProjectError";
  }
}

// The owner sees all projects. Others see a project they lead, or one they have tasks in
// (if "Projects" is switched on for their role).
async function visibleProjectsWhere(actor: Actor) {
  if (actor.role === "OWNER") return {};
  const own = { leadId: actor.id };
  if (!canUseModule(actor, "projects")) return own;
  const rows = await db.task.findMany({
    where: { AND: [visibleTasksWhere(actor), { project: { not: null } }] },
    select: { project: true },
    distinct: ["project"],
  });
  return { OR: [own, { name: { in: rows.map((r) => r.project!) } }] };
}

export const canManageProject = (actor: Actor, project: { leadId: string | null }) =>
  actor.role === "OWNER" || project.leadId === actor.id;

async function loadTasks(names: string[], timeZone: string): Promise<Map<string, ProjectTask[]>> {
  const rows = await db.task.findMany({
    where: { project: { in: names }, isPersonal: false },
    include: {
      assignee: { select: { firstName: true, lastName: true } },
      blockedBy: { select: { blocker: { select: { status: true } } } },
    },
    orderBy: [{ dueDate: "asc" }, { code: "asc" }, { createdAt: "asc" }],
  });
  const result = new Map<string, ProjectTask[]>(names.map((name) => [name, []]));
  for (const row of rows) {
    result.get(row.project!)?.push({
      id: row.id,
      title: row.title,
      code: row.code,
      status: row.status,
      priority: row.priority,
      startDate: row.startDate ? toDateString(row.startDate) : null,
      dueDate: row.dueDate ? toDateString(row.dueDate) : null,
      completedOn: row.completedAt ? todayInTimezone(timeZone, row.completedAt) : null,
      phaseId: row.phaseId,
      responsible: row.responsible,
      assigneeName: displayName(row.assignee),
      isMilestone: row.isMilestone,
      atRisk: row.atRisk,
      openBlockers: row.blockedBy.filter((b) => !CLOSED_STATUSES.includes(b.blocker.status)).length,
    });
  }
  return result;
}

export async function listProjectCards(actor: Actor, today: string, timeZone: string) {
  const projects = await db.project.findMany({
    where: { AND: [await visibleProjectsWhere(actor), { archived: false }] },
    include: { lead: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { name: "asc" },
  });
  const tasks = await loadTasks(
    projects.map((p) => p.name),
    timeZone,
  );
  return projects.map((project) => {
    const own = tasks.get(project.name) ?? [];
    return {
      id: project.id,
      name: project.name,
      team: project.team,
      color: project.color,
      lead: project.lead ? displayName(project.lead) : null,
      range: projectRange(own),
      stats: projectStats(own, today),
      problems: problemsByPriority(own, today),
      next: milestones(own, today).next,
    };
  });
}

export async function getProject(actor: Actor, id: string, timeZone: string) {
  const project = await db.project.findFirst({
    where: { AND: [{ id }, await visibleProjectsWhere(actor)] },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      phases: { orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }] },
    },
  });
  if (!project) return null;
  const tasks = (await loadTasks([project.name], timeZone)).get(project.name) ?? [];
  return {
    project,
    lead: project.lead ? displayName(project.lead) : null,
    phases: project.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      sortOrder: phase.sortOrder,
      dueDate: phase.dueDate ? toDateString(phase.dueDate) : null,
    })),
    tasks,
    canManage: canManageProject(actor, project),
  };
}

// The project a task belongs to (by its project name) and its phase, for the task page.
export async function projectOfTask(task: { project: string | null; phaseId: string | null }) {
  if (!task.project) return null;
  const project = await db.project.findUnique({
    where: { name: task.project },
    select: { id: true, name: true },
  });
  if (!project) return null;
  const phase = task.phaseId
    ? await db.projectPhase.findUnique({ where: { id: task.phaseId }, select: { title: true } })
    : null;
  return { ...project, phase: phase?.title ?? null };
}

const projectSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
  team: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  leadId: z
    .string()
    .max(64)
    .nullish()
    .transform((v) => v || null),
});

const createSchema = projectSchema.extend({
  template: z
    .string()
    .max(40)
    .nullish()
    .transform((v) => v || null),
  anchorDate: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateString(v)),
});
export type ProjectInput = z.input<typeof projectSchema>;

// From a template: its phases and tasks are created, dated from the anchor day (required then).
export async function createProject(
  actor: Actor,
  input: z.input<typeof createSchema>,
  now = new Date(),
) {
  if (actor.role !== "OWNER") throw new ProjectError("forbidden");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new ProjectError("invalid");
  const { template: key, anchorDate, ...fields } = parsed.data;
  const template = templateByKey(key);
  if (template?.anchor && !anchorDate) throw new ProjectError("invalid");
  if (await db.project.findUnique({ where: { name: fields.name } }))
    throw new ProjectError("nameTaken");
  if (fields.leadId && !(await db.user.findUnique({ where: { id: fields.leadId } })))
    throw new ProjectError("invalid");
  const color = (await db.project.count()) % 8;
  const project = await db.$transaction(
    async (tx) => {
      const created = await tx.project.create({
        data: {
          ...fields,
          createdById: actor.id,
          color,
          template: template?.key ?? null,
          anchorDate: template?.anchor && anchorDate ? fromDateString(anchorDate) : null,
        },
      });
      if (template?.anchor && anchorDate)
        await applyTemplate(
          tx,
          created,
          template,
          anchorDate,
          {
            creatorId: actor.id,
            assigneeId: fields.leadId ?? actor.id,
          },
          now,
        );
      return created;
    },
    { timeout: 30_000 },
  );
  await logActivity({
    actorId: actor.id,
    action: "project.created",
    entityType: "Project",
    entityId: project.id,
    details: { template: template?.key ?? null },
  });
  return project;
}

// The owner changes everything; the lead changes the name, team and description.
// With moveTasks, open tasks of the project held by the previous lead (or by the creator when
// there was no lead) go to the new lead.
export async function updateProject(
  actor: Actor,
  id: string,
  input: ProjectInput,
  options: { moveTasks?: boolean } = {},
) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project) throw new ProjectError("notFound");
  if (!canManageProject(actor, project)) throw new ProjectError("forbidden");
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) throw new ProjectError("invalid");
  const data = { ...parsed.data };
  if (actor.role !== "OWNER") data.leadId = project.leadId;
  if (data.name !== project.name && (await db.project.findUnique({ where: { name: data.name } })))
    throw new ProjectError("nameTaken");
  if (data.leadId && !(await db.user.findUnique({ where: { id: data.leadId } })))
    throw new ProjectError("invalid");
  const handOver = options.moveTasks && data.leadId && data.leadId !== project.leadId;
  await db.$transaction([
    db.project.update({ where: { id }, data }),
    // Tasks follow the project by name.
    db.task.updateMany({ where: { project: project.name }, data: { project: data.name } }),
    ...(handOver
      ? [
          db.task.updateMany({
            where: {
              project: data.name,
              isPersonal: false,
              assigneeId: project.leadId ?? project.createdById,
              status: { notIn: CLOSED_STATUSES },
            },
            data: { assigneeId: data.leadId! },
          }),
        ]
      : []),
  ]);
  await logActivity({
    actorId: actor.id,
    action: "project.updated",
    entityType: "Project",
    entityId: id,
  });
}

// Marks a task of a project as "at risk" (or clears it): whoever can edit the task, or the lead.
export async function setTaskRisk(actor: Actor, taskId: string, atRisk: boolean) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new ProjectError("notFound");
  const project = task.project
    ? await db.project.findUnique({ where: { name: task.project } })
    : null;
  if (!project) throw new ProjectError("notFound");
  if (!canEditTask(actor, task) && project.leadId !== actor.id) throw new ProjectError("forbidden");
  await db.task.update({ where: { id: taskId }, data: { atRisk } });
  await logActivity({
    actorId: actor.id,
    action: atRisk ? "task.risk_marked" : "task.risk_cleared",
    entityType: "Task",
    entityId: taskId,
  });
}

// The "Projects" section: the owner, roles it is switched on for, and project leads.
export async function canOpenProjects(actor: Actor) {
  if (actor.role === "OWNER" || canUseModule(actor, "projects")) return true;
  return (await db.project.count({ where: { leadId: actor.id } })) > 0;
}
