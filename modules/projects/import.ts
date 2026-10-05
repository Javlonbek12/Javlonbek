import { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString, isDateString } from "@/lib/dates";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/enums";
import { matchUser } from "@/modules/org/import";

// Loads a whole project plan at once (e.g. from the Excel plan the owner sent), as JSON:
// { "name": "...", "team": "...", "lead": "<person's name>", "phases": [{ "title": "...", "due": "2026-10-05" }],
//   "tasks": [{ "code": "T01", "phase": 1, "title": "...", "responsible": "...", "start": "...", "due": "...",
//               "status": "Не начато", "priority": "Высокий", "dependsOn": ["T02"], "milestone": true,
//               "area": "...", "participants": "...", "result": "...", "comment": "..." }] }
// "phase" is the phase's number (1 = first). The lead is linked to the app user with that name;
// all tasks are assigned to the lead (or the owner) — "responsible" keeps who does it by the plan.

const text = (max: number) => z.string().trim().max(max).optional();
const date = z.string().refine(isDateString, "date must be YYYY-MM-DD").optional();

const STATUSES: Record<string, { status: TaskStatus; atRisk?: boolean }> = {
  "не начато": { status: "APPROVED" },
  "в работе": { status: "IN_PROGRESS" },
  готово: { status: "DONE" },
  риск: { status: "IN_PROGRESS", atRisk: true },
  отложено: { status: "APPROVED" },
};
const PRIORITIES: Record<string, TaskPriority> = {
  низкий: "LOW",
  средний: "MEDIUM",
  высокий: "HIGH",
  срочно: "URGENT",
};

export const projectImportSchema = z.object({
  name: z.string().trim().min(1).max(60),
  team: text(120),
  lead: text(120),
  description: text(2000),
  replace: z.boolean().optional(),
  phases: z.array(z.object({ title: z.string().trim().min(1).max(200), due: date })).max(50),
  tasks: z
    .array(
      z.object({
        code: text(20),
        phase: z.number().int().min(1).optional(),
        title: z.string().trim().min(1).max(200),
        responsible: text(120),
        start: date,
        due: date,
        status: text(40),
        priority: text(40),
        dependsOn: z.array(z.string().trim().max(20)).optional(),
        milestone: z.boolean().optional(),
        area: text(200),
        participants: text(200),
        result: text(1000),
        comment: text(1000),
      }),
    )
    .min(1)
    .max(500),
});
export type ProjectImport = z.input<typeof projectImportSchema>;

export async function importProject(input: unknown, now = new Date()) {
  const plan = projectImportSchema.parse(input);
  const owner = await db.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner yet: log in to the site first.");
  const existing = await db.project.findUnique({ where: { name: plan.name } });
  if (existing && !plan.replace)
    throw new Error(`Project "${plan.name}" already exists. Set "replace": true to load it again.`);
  for (const task of plan.tasks) {
    if (task.phase && task.phase > plan.phases.length)
      throw new Error(`Task ${task.code ?? task.title}: no phase ${task.phase}.`);
    if (task.start && task.due && task.start > task.due)
      throw new Error(`Task ${task.code ?? task.title}: starts after its due date.`);
  }
  const users = await db.user.findMany({ select: { id: true, firstName: true, lastName: true } });
  const leadId = plan.lead ? matchUser(plan.lead, users) : null;
  const assigneeId = leadId ?? owner.id;
  const color = existing ? existing.color : (await db.project.count()) % 8;

  return db.$transaction(
    async (tx) => {
      if (existing) {
        await tx.task.deleteMany({ where: { project: plan.name } });
        await tx.project.delete({ where: { id: existing.id } });
      }
      const project = await tx.project.create({
        data: {
          name: plan.name,
          team: plan.team ?? null,
          description: plan.description ?? null,
          leadId,
          color,
          createdById: owner.id,
          phases: {
            create: plan.phases.map((phase, i) => ({
              title: phase.title,
              sortOrder: i,
              dueDate: phase.due ? fromDateString(phase.due) : null,
            })),
          },
        },
        include: { phases: { orderBy: { sortOrder: "asc" } } },
      });
      const byCode = new Map<string, string>();
      for (const task of plan.tasks) {
        const mapped = STATUSES[(task.status ?? "").toLowerCase()] ?? STATUSES["не начато"];
        const description = [
          task.area && `Область: ${task.area}`,
          task.participants && `Участники: ${task.participants}`,
          task.result && `Результат: ${task.result}`,
          task.comment && `Комментарий: ${task.comment}`,
          task.status?.toLowerCase() === "отложено" && "Отложено",
        ]
          .filter(Boolean)
          .join("\n");
        const created = await tx.task.create({
          data: {
            title: task.title,
            description: description || null,
            creatorId: owner.id,
            assigneeId,
            status: mapped.status,
            atRisk: mapped.atRisk ?? false,
            priority: PRIORITIES[(task.priority ?? "").toLowerCase()] ?? "MEDIUM",
            project: plan.name,
            phaseId: task.phase ? project.phases[task.phase - 1].id : null,
            code: task.code ?? null,
            responsible: task.responsible ?? null,
            isMilestone: task.milestone ?? false,
            startDate: task.start ? fromDateString(task.start) : null,
            dueDate: task.due ? fromDateString(task.due) : null,
            approvedAt: now,
            completedAt: mapped.status === "DONE" ? now : null,
          },
        });
        if (task.code) byCode.set(task.code, created.id);
      }
      let links = 0;
      for (const task of plan.tasks) {
        if (!task.code || !task.dependsOn) continue;
        for (const code of task.dependsOn) {
          const blockerId = byCode.get(code);
          if (!blockerId) throw new Error(`Task ${task.code}: unknown dependency ${code}.`);
          await tx.taskDependency.create({
            data: { blockerId, blockedId: byCode.get(task.code)! },
          });
          links += 1;
        }
      }
      return {
        projectId: project.id,
        phases: project.phases.length,
        tasks: plan.tasks.length,
        links,
        leadLinked: leadId !== null,
        replaced: existing !== null,
      };
    },
    { timeout: 60_000 },
  );
}
