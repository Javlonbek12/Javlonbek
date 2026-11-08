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
  coAssigneeIds?: string[];
};

type Notice = {
  userId: string;
  type: NotificationType;
  // Made when sending, in the recipient's language.
  title: () => string;
  // Made when sending too (their words are in the recipient's language).
  buttons?: () => TelegramButton[][];
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

// The decision buttons under a notice, the same as in /pending: approve (or, for the assignee who
// decides on a request themselves, take it on) or decline; accept or send back. Declining and
// sending back ask for a reason in the chat.
export function approveButtons(taskId: string, takeOn: boolean): TelegramButton[][] {
  return [
    [
      statusButton(t(takeOn ? "bot.actions.takeOn" : "bot.actions.approve"), taskId, "A"),
      statusButton(t("bot.actions.decline"), taskId, "D"),
    ],
  ];
}

export function acceptButtons(taskId: string): TelegramButton[][] {
  return [
    [
      statusButton(t("bot.actions.accept"), taskId, "F"),
      statusButton(t("bot.actions.returnWork"), taskId, "W"),
    ],
  ];
}

// A request to add a co-assignee: ca:<requestId>:y adds them, ca:<requestId>:n declines.
export function coAssigneeButtons(requestId: string): TelegramButton[][] {
  return [
    [
      { text: t("bot.actions.coAdd"), data: `ca:${requestId}:y` },
      { text: t("bot.actions.coDecline"), data: `ca:${requestId}:n` },
    ],
  ];
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
  | { kind: "reassigned"; previousAssigneeId: string; previousSaw: boolean }
  // A closed or cancelled task back in work («Вернуть в работу», within 24 hours).
  | { kind: "reopened" }
  // Co-assignees (modules/tasks/co-assignees.ts): added (straight away or on a decision), asked
  // for (to whoever decides), the decision (to whoever asked), taken off.
  | { kind: "coAdded"; userId: string }
  | { kind: "coRequested"; requestId: string; deciderIds: string[]; name: string }
  | { kind: "coDecided"; requesterId: string; name: string; approved: boolean }
  | { kind: "coRemoved"; userId: string };

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
  const add = (
    userId: string | null | undefined,
    type: NotificationType,
    title: () => string,
    buttons?: () => TelegramButton[][],
  ) => {
    if (userId) notices.push({ userId, type, title, buttons });
  };
  // Whoever decides gets the decision right in the notice.
  const decide = (id: string) =>
    add(
      id,
      "task_pending_approval",
      () => t("notifications.events.taskPendingTitle"),
      () => approveButtons(task.id, id === task.assigneeId),
    );
  const status = (to: TaskStatus) => () =>
    t("notifications.events.taskStatusTitle", { status: t(`tasks.status.${to}`) });
  const assigned = () => t("notifications.events.taskAssignedTitle");
  const deciders = task.deciderIds ?? [];
  // Co-assignees hear what the assignee hears.
  const coAssignees = task.coAssigneeIds ?? [];
  const doers = (type: NotificationType, title: () => string) => {
    for (const id of [task.assigneeId, ...coAssignees]) add(id, type, title);
  };

  switch (event.kind) {
    case "started":
      doers("task_assigned", assigned);
      if (event.teamNoticeId)
        notices.push({
          userId: event.teamNoticeId,
          type: "task_team",
          title: () => t("notifications.events.taskTeamTitle"),
          buttons: () => [[statusButton(t("bot.actions.cancelTask"), task.id, "C")]],
        });
      break;
    case "pending":
      for (const id of deciders) decide(id);
      break;
    case "approved":
      doers("task_assigned", assigned);
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
      // The others doing it: one of them has started.
      for (const id of [task.assigneeId, ...coAssignees])
        add(id, "task_status", () => t("notifications.events.taskTakenTitle"));
      break;
    case "review":
      for (const id of event.reviewerIds)
        add(
          id,
          "task_status",
          () => t("notifications.events.taskReviewTitle"),
          () => acceptButtons(task.id),
        );
      for (const id of [task.assigneeId, ...coAssignees])
        add(id, "task_status", status("IN_REVIEW"));
      break;
    case "done":
      doers("task_status", status("DONE"));
      add(task.creatorId, "task_status", status("DONE"));
      break;
    case "rework":
      doers("task_status", () => t("notifications.events.taskReworkTitle"));
      add(task.creatorId, "task_status", () => t("notifications.events.taskReworkTitle"));
      break;
    case "cancelled":
      if (assigneeSees(task)) add(task.assigneeId, "task_status", status("CANCELLED"));
      if (task.approvedAt !== null)
        for (const id of coAssignees) add(id, "task_status", status("CANCELLED"));
      add(task.creatorId, "task_status", status("CANCELLED"));
      if (event.wasPending) for (const id of deciders) add(id, "task_status", status("CANCELLED"));
      break;
    case "reassigned":
      if (task.approvedAt !== null) add(task.assigneeId, "task_assigned", assigned);
      else for (const id of deciders) decide(id);
      if (event.previousSaw)
        add(event.previousAssigneeId, "task_status", () =>
          t("notifications.events.taskUnassignedTitle"),
        );
      break;
    case "reopened":
      doers("task_status", () => t("notifications.events.taskReopenedTitle"));
      add(task.creatorId, "task_status", () => t("notifications.events.taskReopenedTitle"));
      break;
    case "coAdded":
      // Before approval they can't see it yet: they hear when it starts.
      if (task.approvedAt !== null)
        add(event.userId, "task_assigned", () => t("notifications.events.coAddedTitle"));
      break;
    case "coRequested":
      for (const id of event.deciderIds)
        add(
          id,
          "task_pending_approval",
          () => t("notifications.events.coRequestedTitle", { name: event.name }),
          () => coAssigneeButtons(event.requestId),
        );
      break;
    case "coDecided":
      add(event.requesterId, "task_status", () =>
        t(
          event.approved
            ? "notifications.events.coApprovedTitle"
            : "notifications.events.coDeclinedTitle",
          { name: event.name },
        ),
      );
      break;
    case "coRemoved":
      if (task.approvedAt !== null)
        add(event.userId, "task_status", () => t("notifications.events.taskUnassignedTitle"));
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
      telegramButtons: notice.buttons?.(),
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
