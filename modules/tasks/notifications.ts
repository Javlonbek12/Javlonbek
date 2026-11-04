import type { TaskStatus } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { notify } from "@/modules/core/notifications/service";
import type { NotificationType } from "@/modules/core/notifications/types";
import type { TelegramButton } from "@/modules/bot/keyboard";

type TaskForNotice = {
  id: string;
  title: string;
  isPersonal: boolean;
  creatorId: string;
  assigneeId: string;
  approvedAt: Date | null;
  deciderIds?: string[];
  reviewerId?: string | null;
};

type Notice = {
  userId: string;
  type: NotificationType;
  // Made when sending, in the recipient's language.
  title: () => string;
  buttons?: TelegramButton[][];
};

// Callback data for status buttons in Telegram: t:<taskId>:<code>.
export const STATUS_CODES = {
  A: "APPROVED",
  D: "DRAFT",
  F: "DONE",
  W: "IN_PROGRESS",
  C: "CANCELLED",
} as const satisfies Record<string, TaskStatus>;

export function statusButton(
  text: string,
  taskId: string,
  code: keyof typeof STATUS_CODES,
): TelegramButton {
  return { text, data: `t:${taskId}:${code}` };
}

// What happened to a team task (routing v2, «Уведомления»).
export type TaskEvent =
  // Started right away by the route: the assignee, and the assignee's nearest manager (teamNoticeId).
  | { kind: "started"; teamNoticeId: string | null }
  | { kind: "pending" }
  | { kind: "approved" }
  | { kind: "rejected"; reason: string }
  | { kind: "withdrawn" }
  | { kind: "taken" }
  | { kind: "review"; reviewerIds: string[] }
  | { kind: "done" }
  | { kind: "rework"; reason: string | null }
  | { kind: "cancelled"; wasPending: boolean; reason: string | null }
  | { kind: "reassigned"; previousAssigneeId: string; previousSaw: boolean };

// The assignee hears about a task only once they can see it.
const assigneeSees = (task: TaskForNotice) =>
  task.approvedAt !== null ||
  task.assigneeId === task.creatorId ||
  (task.deciderIds ?? []).includes(task.assigneeId);

// Who should hear about it. Personal tasks never notify anyone; nobody hears about their own
// action, and everyone at most once.
export function taskEventRecipients(task: TaskForNotice, event: TaskEvent, actorId: string) {
  if (task.isPersonal) return [];
  const notices: Notice[] = [];
  const add = (userId: string | null | undefined, type: NotificationType, title: () => string) => {
    if (userId) notices.push({ userId, type, title });
  };
  const status = (to: TaskStatus) => () =>
    t("notifications.events.taskStatusTitle", { status: t(`tasks.status.${to}`) });
  const assigned = () => t("notifications.events.taskAssignedTitle");
  const deciders = task.deciderIds ?? [];

  switch (event.kind) {
    case "started":
      add(task.assigneeId, "task_assigned", assigned);
      if (event.teamNoticeId)
        notices.push({
          userId: event.teamNoticeId,
          type: "task_team",
          title: () => t("notifications.events.taskTeamTitle"),
          buttons: [[statusButton(t("bot.actions.cancelTask"), task.id, "C")]],
        });
      break;
    case "pending":
      for (const id of deciders)
        add(id, "task_pending_approval", () => t("notifications.events.taskPendingTitle"));
      break;
    case "approved":
      add(task.assigneeId, "task_assigned", assigned);
      add(task.creatorId, "task_status", () => t("notifications.events.taskApprovedTitle"));
      break;
    case "rejected":
      add(task.creatorId, "task_status", () => t("notifications.events.taskRejectedTitle"));
      break;
    case "withdrawn":
      for (const id of deciders)
        add(id, "task_status", () => t("notifications.events.taskWithdrawnTitle"));
      break;
    case "taken":
      add(task.creatorId, "task_status", () => t("notifications.events.taskTakenTitle"));
      break;
    case "review":
      for (const id of event.reviewerIds)
        add(id, "task_status", () => t("notifications.events.taskReviewTitle"));
      break;
    case "done":
      add(task.assigneeId, "task_status", status("DONE"));
      add(task.creatorId, "task_status", status("DONE"));
      break;
    case "rework":
      add(task.assigneeId, "task_status", () => t("notifications.events.taskReworkTitle"));
      add(task.creatorId, "task_status", () => t("notifications.events.taskReworkTitle"));
      break;
    case "cancelled":
      if (assigneeSees(task)) add(task.assigneeId, "task_status", status("CANCELLED"));
      add(task.creatorId, "task_status", status("CANCELLED"));
      if (event.wasPending) for (const id of deciders) add(id, "task_status", status("CANCELLED"));
      break;
    case "reassigned":
      if (task.approvedAt !== null) add(task.assigneeId, "task_assigned", assigned);
      else
        for (const id of deciders)
          add(id, "task_pending_approval", () => t("notifications.events.taskPendingTitle"));
      if (event.previousSaw)
        add(event.previousAssigneeId, "task_status", () =>
          t("notifications.events.taskUnassignedTitle"),
        );
      break;
  }

  const seen = new Set<string>([actorId]);
  return notices.filter((notice) => {
    if (seen.has(notice.userId)) return false;
    seen.add(notice.userId);
    return true;
  });
}

export async function sendTaskNotices(
  notices: Notice[],
  task: TaskForNotice,
  actorName: string,
  reason?: string | null,
) {
  for (const notice of notices) {
    await notify(notice.userId, () => ({
      type: notice.type,
      title: notice.title(),
      body: reason
        ? t("notifications.events.taskReasonBody", { title: task.title, name: actorName, reason })
        : t("notifications.events.taskBody", { title: task.title, name: actorName }),
      link: `/tasks/${task.id}`,
      telegramButtons: notice.buttons,
    }));
  }
}

export async function notifyTaskEvent(
  task: TaskForNotice,
  event: TaskEvent,
  actorId: string,
  actorName: string,
) {
  const reason = "reason" in event ? event.reason : null;
  await sendTaskNotices(taskEventRecipients(task, event, actorId), task, actorName, reason);
}
