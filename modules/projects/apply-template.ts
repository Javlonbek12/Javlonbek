import { addDays, fromDateString } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";

import type { Route } from "@/modules/tasks/routing";

import { routeFields } from "./routing";
import type { ProjectTemplate, TemplateTask } from "./templates";

// Phases, tasks and dependencies of a template, dated from the anchor day. Each task goes to the
// person picked for its role («Кто делает»), along the route from the creator to that person
// (routing v2; `routes` has one per assignee). Returns how many tasks each person got.
export async function applyTemplate(
  tx: Prisma.TransactionClient,
  project: { id: string; name: string },
  template: ProjectTemplate,
  anchor: string,
  people: { creatorId: string; assigneeOf: (task: TemplateTask) => string },
  routes: Map<string, Route>,
  now = new Date(),
) {
  const byCode = new Map<string, string>();
  const made = new Map<string, number>();
  for (const [i, phase] of template.phases.entries()) {
    const created = await tx.projectPhase.create({
      data: {
        projectId: project.id,
        title: phase.title,
        sortOrder: i,
        dueDate: fromDateString(addDays(anchor, phase.due)),
      },
    });
    for (const task of phase.tasks) {
      const assigneeId = people.assigneeOf(task);
      const row = await tx.task.create({
        data: {
          title: task.title,
          description: task.result ? `Результат: ${task.result}` : null,
          creatorId: people.creatorId,
          assigneeId,
          ...routeFields(routes.get(assigneeId)!, now),
          priority: task.milestone ? "HIGH" : "MEDIUM",
          project: project.name,
          phaseId: created.id,
          code: task.code,
          responsible: task.responsible,
          isMilestone: task.milestone ?? false,
          startDate: fromDateString(addDays(anchor, task.start)),
          dueDate: fromDateString(addDays(anchor, task.due)),
        },
      });
      byCode.set(task.code, row.id);
      made.set(assigneeId, (made.get(assigneeId) ?? 0) + 1);
    }
  }
  for (const task of template.phases.flatMap((p) => p.tasks)) {
    for (const code of task.dependsOn ?? []) {
      await tx.taskDependency.create({
        data: { blockerId: byCode.get(code)!, blockedId: byCode.get(task.code)! },
      });
    }
  }
  return made;
}
