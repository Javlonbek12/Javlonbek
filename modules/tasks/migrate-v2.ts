import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { notify } from "@/modules/core/notifications/service";
import { displayName } from "@/modules/core/users/display-name";

import { CLOSED_STATUSES } from "./access";
import { loadRouting, resolveRoute } from "./routing";

// Once, when routing v2 arrives on the server (the scheduler's first pass after the deploy):
// - tasks waiting for approval go through the new route: those that would start right away now
//   are approved, and the assignee and the author hear «утверждена автоматически по новым
//   правилам»; the rest get the new list of who decides;
// - open team tasks get who accepts their result.
// Tasks of project plans made earlier stay as they are; no notices are sent after the fact.

const KEY = "tasks.routingV2";

export async function migrateToRoutingV2(now = new Date()) {
  if (await db.systemState.findUnique({ where: { key: KEY } })) return { done: false };
  const { people, settings } = await loadRouting();
  const users = await db.user.findMany({ select: { id: true, firstName: true, lastName: true } });
  const names = new Map(users.map((u) => [u.id, displayName(u)]));
  const tasks = await db.task.findMany({
    where: { isPersonal: false, status: { notIn: CLOSED_STATUSES } },
  });
  let approved = 0;
  for (const task of tasks) {
    const route = resolveRoute(people, settings, task.creatorId, task.assigneeId);
    if (task.status !== "PENDING_APPROVAL") {
      if (task.reviewerId === null && route.reviewerId !== null)
        await db.task.update({ where: { id: task.id }, data: { reviewerId: route.reviewerId } });
      continue;
    }
    if (route.status === "APPROVED") {
      await db.task.update({
        where: { id: task.id },
        data: {
          status: "APPROVED",
          approvedAt: now,
          statusChangedAt: now,
          deciderIds: [],
          reviewerId: route.reviewerId,
        },
      });
      approved++;
      for (const userId of new Set([task.assigneeId, task.creatorId]))
        await notify(userId, () => ({
          type: "task_status",
          title: t("notifications.events.taskAutoApprovedTitle"),
          body: t("notifications.events.taskBody", {
            title: task.title,
            name: names.get(task.creatorId) ?? "",
          }),
          link: `/tasks/${task.id}`,
        }));
    } else {
      await db.task.update({
        where: { id: task.id },
        data: { deciderIds: route.deciderIds, reviewerId: route.reviewerId },
      });
    }
  }
  await db.systemState.upsert({
    where: { key: KEY },
    create: { key: KEY, value: now.toISOString() },
    update: {},
  });
  return { done: true, approved };
}
