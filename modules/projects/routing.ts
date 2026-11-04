import { t } from "@/lib/i18n";
import { notify } from "@/modules/core/notifications/service";
import { loadRouting, resolveRoute, type Route } from "@/modules/tasks/routing";

// Tasks of a project plan (Excel, a template) are made in bulk inside one transaction, but along the
// same route as any task (routing v2): this gives their fields, and one notice afterwards instead
// of one per task.

export async function planRoute(creatorId: string, assigneeId: string) {
  const { people, settings } = await loadRouting();
  return resolveRoute(people, settings, creatorId, assigneeId);
}

export function routeFields(route: Route, now: Date) {
  return {
    status: route.status,
    deciderIds: route.deciderIds,
    reviewerId: route.reviewerId,
    approvedAt: route.status === "APPROVED" ? now : null,
    statusChangedAt: now,
  };
}

// The assignee hears that the plan's tasks are theirs (or, if they wait, whoever decides).
export async function notifyPlanTasks(
  route: Route,
  creatorId: string,
  assigneeId: string,
  project: string,
  count: number,
) {
  if (count === 0) return;
  const to = route.status === "APPROVED" ? [assigneeId] : route.deciderIds;
  for (const userId of to) {
    if (userId === creatorId) continue;
    await notify(userId, () => ({
      type: route.status === "APPROVED" ? "task_assigned" : "task_pending_approval",
      title: t("notifications.events.projectTasksTitle", { project, count }),
      body: t("notifications.events.projectTasksBody", { project, count }),
      link: `/tasks?project=${encodeURIComponent(project)}`,
    }));
  }
}
