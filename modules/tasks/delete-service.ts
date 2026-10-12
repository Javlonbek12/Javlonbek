import { rm } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { Task } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { approverIdsFor } from "@/modules/core/access/approvers";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canViewTask, oversees } from "./access";
import { TaskError } from "./errors";

// Deleting tasks. An employee deletes their own task right away while nothing has happened to it
// yet. Once there was work (approval, a status past it, comments or files), deletion goes up the
// hierarchy: the employee asks, and whoever oversees the task (manager, owner) deletes or keeps it.
// Whoever oversees a task can delete it right away. Personal tasks: only the author, always.

type TaskForDelete = Pick<
  Task,
  "id" | "isPersonal" | "creatorId" | "assigneeId" | "status" | "approvedAt" | "deleteRequestedAt"
>;

export type DeleteMode = "direct" | "request" | "none";

// Something has happened to the task besides its creation.
export function hasProgress(task: TaskForDelete, counts: { comments: number; files: number }) {
  return (
    task.approvedAt !== null ||
    ["APPROVED", "IN_PROGRESS", "IN_REVIEW", "DONE"].includes(task.status) ||
    counts.comments > 0 ||
    counts.files > 0
  );
}

export function deleteMode(actor: Actor, task: TaskForDelete, progress: boolean): DeleteMode {
  if (task.isPersonal) return task.creatorId === actor.id ? "direct" : "none";
  if (!canViewTask(actor, task)) return "none";
  if (oversees(actor, task)) return "direct";
  if (task.creatorId === actor.id && !progress) return "direct";
  if (task.creatorId === actor.id || task.assigneeId === actor.id) return "request";
  return "none";
}

async function load(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { _count: { select: { comments: true, attachments: true } } },
  });
  if (!task) throw new TaskError("forbidden");
  const progress = hasProgress(task, {
    comments: task._count.comments,
    files: task._count.attachments,
  });
  return { task, progress };
}

// What the task page shows: the delete button, the request form, or nothing.
export async function getDeleteMode(actor: Actor, taskId: string) {
  const { task, progress } = await load(taskId);
  return deleteMode(actor, task, progress);
}

const nameOf = async (userId: string) =>
  displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));

async function removeForGood(actor: Actor, task: Task) {
  await db.task.delete({ where: { id: task.id } });
  await rm(path.join(path.resolve(getEnv().UPLOAD_DIR), "tasks", task.id), {
    recursive: true,
    force: true,
  });
  await logActivity({
    actorId: actor.id,
    action: "task.deleted",
    entityType: "Task",
    entityId: task.id,
    details: { title: task.title },
  });
  if (task.isPersonal) return;
  const name = await nameOf(actor.id);
  const people = new Set([task.creatorId, task.assigneeId, task.deleteRequestedById]);
  people.delete(actor.id);
  for (const userId of people) {
    if (!userId) continue;
    await notify(userId, () => ({
      type: "task_status",
      title: t("notifications.events.taskDeletedTitle"),
      body: t("notifications.events.taskDeletedBody", { name, title: task.title }),
    }));
  }
}

// Deletes right away, if the actor may (see deleteMode).
export async function deleteTask(actor: Actor, taskId: string) {
  const { task, progress } = await load(taskId);
  if (deleteMode(actor, task, progress) !== "direct") throw new TaskError("forbidden");
  await removeForGood(actor, task);
}

// Asks whoever oversees the task to delete it.
export async function requestTaskDeletion(actor: Actor, taskId: string, reason: string) {
  const { task, progress } = await load(taskId);
  if (deleteMode(actor, task, progress) !== "request") throw new TaskError("forbidden");
  if (task.deleteRequestedAt) throw new TaskError("requested");
  const approvers = (await approverIdsFor(task)).filter((id) => id !== actor.id);
  if (!approvers.length) throw new TaskError("noApprover");
  const text = reason.trim().slice(0, 500) || null;
  await db.task.update({
    where: { id: taskId },
    data: { deleteRequestedById: actor.id, deleteRequestedAt: new Date(), deleteReason: text },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.delete_requested",
    entityType: "Task",
    entityId: taskId,
    details: text ? { reason: text } : undefined,
  });
  const name = await nameOf(actor.id);
  for (const userId of approvers) {
    await notify(userId, () => ({
      type: "task_delete_request",
      title: t("notifications.events.taskDeleteRequestTitle"),
      body:
        t("notifications.events.taskDeleteRequestBody", { name, title: task.title }) +
        (text ? `\n${text}` : ""),
      link: `/tasks/${taskId}`,
    }));
  }
}

// The overseer deletes the task (approve) or keeps it; the requester can withdraw the request.
export async function resolveTaskDeletion(actor: Actor, taskId: string, approve: boolean) {
  const { task } = await load(taskId);
  if (!task.deleteRequestedAt) throw new TaskError("invalid");
  const own = task.deleteRequestedById === actor.id;
  const overseer = !task.isPersonal && oversees(actor, task) && canViewTask(actor, task);
  if (approve ? !overseer : !overseer && !own) throw new TaskError("forbidden");
  if (approve) return removeForGood(actor, task);

  await db.task.update({
    where: { id: taskId },
    data: { deleteRequestedById: null, deleteRequestedAt: null, deleteReason: null },
  });
  await logActivity({
    actorId: actor.id,
    action: own && !overseer ? "task.delete_withdrawn" : "task.delete_rejected",
    entityType: "Task",
    entityId: taskId,
  });
  if (task.deleteRequestedById && !own) {
    await notify(task.deleteRequestedById, async () => ({
      type: "task_status",
      title: t("notifications.events.taskDeleteRejectedTitle"),
      body: t("notifications.events.taskDeleteRejectedBody", {
        name: await nameOf(actor.id),
        title: task.title,
      }),
      link: `/tasks/${taskId}`,
    }));
  }
}
