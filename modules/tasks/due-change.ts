import { db } from "@/lib/db";
import { fromDateString, isDateString, toDateString } from "@/lib/dates";
import type { Task } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canEditTask, canViewTask, isClosed, isDoer, reviewerOf } from "./access";
import { TaskError } from "./errors";

// «Попросить перенести срок»: the one doing a team task can't change its due date, but may ask
// for a new one with a reason. The author (or whoever accepts the work) decides, from «Ждут
// решения» or the task card: the date moves, or stays. Honest dates instead of silent delays.

type DueTask = Pick<
  Task,
  | "isPersonal"
  | "status"
  | "creatorId"
  | "assigneeId"
  | "reviewerId"
  | "coAssigneeIds"
  | "dueChangeAt"
  | "dueChangeById"
>;

// The doer asks while the task is open and not handed in, when they can't change the date.
export function canRequestDueChange(
  actor: Actor,
  task: DueTask & Parameters<typeof canEditTask>[1],
) {
  return (
    !task.isPersonal &&
    !isClosed(task.status) &&
    task.status !== "IN_REVIEW" &&
    isDoer(actor, task) &&
    !canEditTask(actor, task) &&
    !task.dueChangeAt
  );
}

// Whose decision a request is: the author, and whoever accepts the work if that is someone else.
export function dueChangeDeciders(task: DueTask) {
  return [...new Set([task.creatorId, reviewerOf(task)])].filter(
    (id): id is string => id !== null && id !== task.dueChangeById,
  );
}

// Decided by those, or by anyone else who may change the task's fields (the owner).
export const canDecideDueChange = (
  actor: Actor,
  task: DueTask & Parameters<typeof canEditTask>[1],
) =>
  Boolean(task.dueChangeAt) &&
  task.dueChangeById !== actor.id &&
  (dueChangeDeciders(task).includes(actor.id) || canEditTask(actor, task));

async function nameOf(userId: string) {
  return displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));
}

export async function requestDueChange(
  actor: Actor,
  taskId: string,
  date: string,
  reason: string,
  today: string,
) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");
  if (task.dueChangeAt) throw new TaskError("requested");
  if (!canRequestDueChange(actor, task)) throw new TaskError("forbidden");
  const text = reason.trim().slice(0, 500);
  const current = task.dueDate ? toDateString(task.dueDate) : null;
  if (!isDateString(date) || date < today || date === current || !text)
    throw new TaskError("invalid");
  await db.task.update({
    where: { id: taskId },
    data: {
      dueChangeById: actor.id,
      dueChangeAt: new Date(),
      dueChangeTo: fromDateString(date),
      dueChangeReason: text,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.due_change_requested",
    entityType: "Task",
    entityId: taskId,
    details: { from: current, to: date, reason: text },
  });
  const name = await nameOf(actor.id);
  for (const userId of dueChangeDeciders({ ...task, dueChangeById: actor.id })) {
    await notify(userId, () => ({
      type: "task_status",
      title: t("tasks.dueChange.notifyTitle"),
      body: t("tasks.dueChange.notifyBody", { name, title: task.title, date, reason: text }),
      link: `/tasks/decide?task=${encodeURIComponent(taskId)}`,
    }));
  }
}

// «Перенести» (the date moves), «Оставить срок», or the asker's «Отозвать».
export async function resolveDueChange(
  actor: Actor,
  taskId: string,
  decision: "approve" | "reject" | "withdraw",
) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task) || !task.dueChangeAt) throw new TaskError("forbidden");
  const own = task.dueChangeById === actor.id;
  if (decision === "withdraw" ? !own : !canDecideDueChange(actor, task))
    throw new TaskError("forbidden");
  const to = task.dueChangeTo;
  await db.task.update({
    where: { id: taskId },
    data: {
      ...(decision === "approve" && to ? { dueDate: to } : {}),
      dueChangeById: null,
      dueChangeAt: null,
      dueChangeTo: null,
      dueChangeReason: null,
    },
  });
  await logActivity({
    actorId: actor.id,
    action: `task.due_change_${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "withdrawn"}`,
    entityType: "Task",
    entityId: taskId,
    details: to ? { to: toDateString(to) } : undefined,
  });
  if (decision !== "withdraw" && task.dueChangeById) {
    const name = await nameOf(actor.id);
    await notify(task.dueChangeById, () => ({
      type: "task_status",
      title: t(
        decision === "approve" ? "tasks.dueChange.approvedTitle" : "tasks.dueChange.rejectedTitle",
      ),
      body: t("tasks.dueChange.decidedBody", { name, title: task.title }),
      link: `/tasks/${taskId}`,
    }));
  }
}
