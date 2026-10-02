import type { TaskStatus } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { notify } from "@/modules/core/notifications/service";
import type { NotificationType } from "@/modules/core/notifications/types";

type TaskForNotice = {
  id: string;
  title: string;
  isPersonal: boolean;
  creatorId: string;
  assigneeId: string;
};

type Notice = { userId: string; type: NotificationType; title: string };

// Who should hear about a status change. Personal tasks never notify anyone.
export function statusChangeRecipients(
  task: TaskForNotice,
  from: TaskStatus,
  to: TaskStatus,
  actorId: string,
  approverIds: string[],
): Notice[] {
  if (task.isPersonal) return [];
  const notices: Notice[] = [];
  const statusTitle = t("notifications.events.taskStatusTitle", {
    status: t(`tasks.status.${to}`),
  });

  if (to === "PENDING_APPROVAL") {
    for (const id of approverIds) {
      notices.push({
        userId: id,
        type: "task_pending_approval",
        title: t("notifications.events.taskPendingTitle"),
      });
    }
  } else if (to === "APPROVED") {
    notices.push({
      userId: task.assigneeId,
      type: "task_assigned",
      title: t("notifications.events.taskAssignedTitle"),
    });
    notices.push({
      userId: task.creatorId,
      type: "task_status",
      title: t("notifications.events.taskApprovedTitle"),
    });
  } else if (to === "IN_REVIEW") {
    const reviewers = task.creatorId === task.assigneeId ? approverIds : [task.creatorId];
    for (const id of reviewers) {
      notices.push({
        userId: id,
        type: "task_status",
        title: t("notifications.events.taskReviewTitle"),
      });
    }
  } else if (to === "DRAFT" && from === "PENDING_APPROVAL") {
    notices.push({ userId: task.creatorId, type: "task_status", title: statusTitle });
  } else if (
    to === "DONE" ||
    to === "CANCELLED" ||
    (to === "IN_PROGRESS" && from === "IN_REVIEW")
  ) {
    notices.push({ userId: task.assigneeId, type: "task_status", title: statusTitle });
    notices.push({ userId: task.creatorId, type: "task_status", title: statusTitle });
  }

  // Nobody is notified about their own action, and everyone at most once.
  const seen = new Set<string>([actorId]);
  return notices.filter((notice) => {
    if (seen.has(notice.userId)) return false;
    seen.add(notice.userId);
    return true;
  });
}

export async function sendTaskNotices(notices: Notice[], task: TaskForNotice, actorName: string) {
  for (const notice of notices) {
    await notify(notice.userId, {
      type: notice.type,
      title: notice.title,
      body: t("notifications.events.taskBody", { title: task.title, name: actorName }),
      link: `/tasks/${task.id}`,
    });
  }
}
