import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { Prisma, Task } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { approverIdsFor } from "@/modules/core/access/approvers";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canControl, canViewTask, isDoer } from "./access";
import { TaskError } from "./errors";
import { getTaskSettings } from "./settings";
import { stopTimersOnTask } from "./time-rules";

// Deleting tasks (routing v2, «Удаление»). The author deletes their own task right away until
// someone else has put work into it; after that, deletion goes up: the author or the assignee asks,
// and whoever controls the task (the owner, a manager in the zone who doesn't do it) deletes or
// keeps it. Whoever controls a task deletes it right away. Personal tasks: only the author, always.
// A deleted team task waits in the bin (Settings → days) and the owner can restore it.

type TaskForDelete = Pick<
  Task,
  | "id"
  | "isPersonal"
  | "creatorId"
  | "assigneeId"
  | "status"
  | "approvedAt"
  | "approvedById"
  | "deleteRequestedAt"
  | "deciderIds"
  | "reviewerId"
  | "coAssigneeIds"
>;

export type DeleteMode = "direct" | "request" | "none";

// Someone other than the author has put work into the task: the assignee started it (or further),
// someone commented, added a file, ticked a step or changed the notes, or approved it (not the
// route on its own). The author's own work on their own task is no movement.
export function hasProgress(
  task: TaskForDelete,
  counts: { comments: number; files: number; steps?: number; notes?: boolean; time?: number },
) {
  return (
    ((task.assigneeId !== task.creatorId || (task.coAssigneeIds ?? []).length > 0) &&
      ["IN_PROGRESS", "IN_REVIEW", "DONE"].includes(task.status)) ||
    counts.comments > 0 ||
    counts.files > 0 ||
    (counts.steps ?? 0) > 0 ||
    (counts.time ?? 0) > 0 ||
    counts.notes === true ||
    (task.approvedById !== null && task.approvedById !== task.creatorId)
  );
}

export function deleteMode(actor: Actor, task: TaskForDelete, progress: boolean): DeleteMode {
  if (task.isPersonal) return task.creatorId === actor.id ? "direct" : "none";
  if (!canViewTask(actor, task)) return "none";
  if (canControl(actor, task)) return "direct";
  if (task.creatorId === actor.id && !progress) return "direct";
  if (task.creatorId === actor.id || isDoer(actor, task)) return "request";
  return "none";
}

async function load(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new TaskError("forbidden");
  // Only what others did counts: the author's own comments and files are no reason to ask.
  const others = { not: task.creatorId };
  const [comments, files, steps, note, time] = await Promise.all([
    db.comment.count({ where: { taskId, authorId: others } }),
    db.taskAttachment.count({ where: { taskId, uploadedById: others } }),
    db.taskStep.count({ where: { taskId, doneAt: { not: null }, doneById: others } }),
    db.taskNote.findUnique({ where: { taskId }, select: { editedByOthersAt: true } }),
    db.taskTimeEntry.count({ where: { taskId, userId: others } }),
  ]);
  return {
    task,
    progress: hasProgress(task, {
      comments,
      files,
      steps,
      notes: !!note?.editedByOthersAt,
      time,
    }),
  };
}

// What the task page shows: the delete button, the request form, or nothing.
export async function getDeleteMode(actor: Actor, taskId: string) {
  const { task, progress } = await load(taskId);
  return deleteMode(actor, task, progress);
}

const nameOf = async (userId: string) =>
  displayName(await db.user.findUniqueOrThrow({ where: { id: userId } }));

const uploads = () => path.resolve(getEnv().UPLOAD_DIR);
const filesOf = (id: string) => path.join(uploads(), "tasks", id);
const binOf = (id: string) => path.join(uploads(), "trash", "tasks", id);

async function moveDir(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

// A team task goes to the bin with everything it had; a personal one is gone at once.
async function removeForGood(actor: Actor, task: Task, reason: string | null) {
  if (task.isPersonal) {
    await db.task.delete({ where: { id: task.id } });
    await rm(filesOf(task.id), { recursive: true, force: true });
  } else {
    // Timers running on it stop first: the bin keeps what was counted.
    await stopTimersOnTask(task.id);
    const [comments, attachments, blockers, blocks, steps, note, time] = await Promise.all([
      db.comment.findMany({ where: { taskId: task.id } }),
      db.taskAttachment.findMany({ where: { taskId: task.id } }),
      db.taskDependency.findMany({ where: { blockedId: task.id } }),
      db.taskDependency.findMany({ where: { blockerId: task.id } }),
      db.taskStep.findMany({ where: { taskId: task.id } }),
      db.taskNote.findUnique({ where: { taskId: task.id } }),
      db.taskTimeEntry.findMany({ where: { taskId: task.id } }),
    ]);
    const data = { task, comments, attachments, blockers, blocks, steps, note, time };
    await db.$transaction([
      db.deletedTask.upsert({
        where: { id: task.id },
        create: {
          id: task.id,
          title: task.title,
          data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
          deletedById: actor.id,
          reason,
        },
        update: {},
      }),
      db.task.delete({ where: { id: task.id } }),
    ]);
    await moveDir(filesOf(task.id), binOf(task.id));
  }
  await logActivity({
    actorId: actor.id,
    action: "task.deleted",
    entityType: "Task",
    entityId: task.id,
    details: { title: task.title, ...(reason ? { reason } : {}) },
  });
  if (task.isPersonal) return;
  const name = await nameOf(actor.id);
  const people = new Set([task.creatorId, task.assigneeId, task.deleteRequestedById]);
  // The assignee hears only about a task they could see.
  if (task.approvedAt === null && !task.deciderIds.includes(task.assigneeId))
    people.delete(task.assigneeId);
  people.delete(actor.id);
  const body = t("notifications.events.taskDeletedBody", { name, title: task.title });
  for (const userId of people) {
    if (!userId) continue;
    await notify(userId, () => ({
      type: "task_status",
      title: t("notifications.events.taskDeletedTitle"),
      body: reason ? `${body}\n${reason}` : body,
    }));
  }
  // The author withdrew a waiting request by deleting it: whoever was to decide hears so.
  if (task.status === "PENDING_APPROVAL")
    for (const userId of task.deciderIds.filter((id) => id !== actor.id))
      await notify(userId, () => ({
        type: "task_status",
        title: t("notifications.events.taskRequestWithdrawnTitle"),
        body: t("notifications.events.taskBody", { title: task.title, name }),
      }));
}

// Deletes right away, if the actor may (see deleteMode). A reason is kept with the task in the bin
// and sent to the author and the assignee.
export async function deleteTask(actor: Actor, taskId: string, reason?: string | null) {
  const { task, progress } = await load(taskId);
  if (deleteMode(actor, task, progress) !== "direct") throw new TaskError("forbidden");
  await removeForGood(actor, task, reason?.trim().slice(0, 500) || null);
}

// ——— The bin: the owner sees deleted team tasks and restores them ———

export async function listDeletedTasks(actor: Actor) {
  if (actor.role !== "OWNER") throw new TaskError("forbidden");
  const rows = await db.deletedTask.findMany({ orderBy: { deletedAt: "desc" } });
  const people = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.deletedById) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const { trashDays } = await getTaskSettings();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    reason: r.reason,
    deletedAt: r.deletedAt,
    purgeAt: new Date(r.deletedAt.getTime() + trashDays * 86_400_000),
    deletedBy: people.find((p) => p.id === r.deletedById) ?? null,
  }));
}

type Snapshot = {
  task: Record<string, unknown>;
  comments: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  blockers: { blockerId: string; blockedId: string; createdAt: string }[];
  blocks: { blockerId: string; blockedId: string; createdAt: string }[];
  // Missing in tasks deleted before steps (notes, time) existed.
  steps?: Record<string, unknown>[];
  note?: Record<string, unknown> | null;
  time?: Record<string, unknown>[];
};

const DATE_FIELDS = [
  "startDate",
  "dueDate",
  "approvedAt",
  "completedAt",
  "deleteRequestedAt",
  "createdAt",
  "updatedAt",
  "statusChangedAt",
];

function revive<T extends Record<string, unknown>>(row: T, fields = DATE_FIELDS): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of fields)
    if (typeof copy[field] === "string") copy[field] = new Date(copy[field] as string);
  return copy as T;
}

export async function restoreTask(actor: Actor, id: string) {
  if (actor.role !== "OWNER") throw new TaskError("forbidden");
  const row = await db.deletedTask.findUnique({ where: { id } });
  if (!row) throw new TaskError("invalid");
  const data = row.data as unknown as Snapshot;
  const userIds = new Set((await db.user.findMany({ select: { id: true } })).map((u) => u.id));
  const task = revive(data.task) as unknown as Task;
  if (!userIds.has(task.creatorId) || !userIds.has(task.assigneeId)) throw new TaskError("invalid");
  // Links to things that are gone by now are dropped.
  const exists = async <T>(id: string | null, find: (id: string) => Promise<T | null>) =>
    id && (await find(id)) ? id : null;
  const restored = {
    ...task,
    planId: await exists(task.planId, (x) => db.plan.findUnique({ where: { id: x } })),
    meetingId: await exists(task.meetingId, (x) => db.meeting.findUnique({ where: { id: x } })),
    phaseId: await exists(task.phaseId, (x) => db.projectPhase.findUnique({ where: { id: x } })),
    seriesId: await exists(task.seriesId, (x) => db.taskSeries.findUnique({ where: { id: x } })),
    coAssigneeIds: (task.coAssigneeIds ?? []).filter((x) => userIds.has(x)),
    deleteRequestedById: null,
    deleteRequestedAt: null,
    deleteReason: null,
  };
  const others = new Set(
    (
      await db.task.findMany({
        where: {
          id: { in: [...data.blockers, ...data.blocks].flatMap((d) => [d.blockerId, d.blockedId]) },
        },
        select: { id: true },
      })
    ).map((t) => t.id),
  );
  await db.$transaction([
    db.task.create({ data: restored as Prisma.TaskUncheckedCreateInput }),
    db.comment.createMany({
      data: data.comments
        .map((c) => revive(c, ["createdAt"]))
        .filter((c) => userIds.has(c.authorId as string)) as Prisma.CommentCreateManyInput[],
    }),
    db.taskAttachment.createMany({
      data: data.attachments
        .map((a) => revive(a, ["createdAt"]))
        .filter((a) =>
          userIds.has(a.uploadedById as string),
        ) as Prisma.TaskAttachmentCreateManyInput[],
    }),
    db.taskStep.createMany({
      data: (data.steps ?? [])
        .map((s) => revive(s, ["dueDate", "doneAt", "createdAt", "updatedAt"]))
        .map((s) => ({
          ...s,
          responsibleId: userIds.has(s.responsibleId as string) ? s.responsibleId : null,
          doneById: userIds.has(s.doneById as string) ? s.doneById : null,
        })) as Prisma.TaskStepCreateManyInput[],
    }),
    db.taskNote.createMany({
      data: data.note
        ? [
            {
              ...revive(data.note, ["editedByOthersAt", "createdAt", "updatedAt"]),
              updatedById: userIds.has(data.note.updatedById as string)
                ? (data.note.updatedById as string)
                : null,
            } as Prisma.TaskNoteCreateManyInput,
          ]
        : [],
    }),
    db.taskTimeEntry.createMany({
      data: (data.time ?? [])
        .map((e) => revive(e, ["startedAt", "endedAt", "createdAt"]))
        .filter((e) => userIds.has(e.userId as string)) as Prisma.TaskTimeEntryCreateManyInput[],
    }),
    db.taskDependency.createMany({
      data: [...data.blockers, ...data.blocks]
        .filter((d) => others.has(d.blockerId === id ? d.blockedId : d.blockerId))
        .map((d) => ({ ...d, createdAt: new Date(d.createdAt) })),
      skipDuplicates: true,
    }),
    db.deletedTask.delete({ where: { id } }),
  ]);
  await moveDir(binOf(id), filesOf(id));
  await logActivity({
    actorId: actor.id,
    action: "task.restored",
    entityType: "Task",
    entityId: id,
  });
  const name = await nameOf(actor.id);
  for (const userId of new Set([task.creatorId, task.assigneeId]))
    if (userId !== actor.id)
      await notify(userId, () => ({
        type: "task_status",
        title: t("notifications.events.taskRestoredTitle"),
        body: t("notifications.events.taskBody", { title: task.title, name }),
        link: `/tasks/${id}`,
      }));
}

// Empties the bin of tasks deleted longer ago than the settings say (the scheduler, once a day is
// enough, but every pass is safe).
export async function purgeDeletedTasks(now = new Date()) {
  const { trashDays } = await getTaskSettings();
  const old = await db.deletedTask.findMany({
    where: { deletedAt: { lt: new Date(now.getTime() - trashDays * 86_400_000) } },
    select: { id: true },
  });
  for (const { id } of old) {
    await db.deletedTask.delete({ where: { id } });
    await rm(binOf(id), { recursive: true, force: true });
  }
  return old.length;
}

// Asks whoever oversees the task to delete it.
export async function requestTaskDeletion(actor: Actor, taskId: string, reason: string) {
  const { task, progress } = await load(taskId);
  if (deleteMode(actor, task, progress) !== "request") throw new TaskError("forbidden");
  if (task.deleteRequestedAt) throw new TaskError("requested");
  const approvers = (await approverIdsFor(task)).filter(
    (id) => id !== actor.id && !isDoer({ id }, task),
  );
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
      telegramButtons: [deleteButtons(taskId)],
    }));
  }
}

// Deletion requests the actor decides on (for the bot's /pending).
export async function listDeleteRequests(actor: Actor) {
  const tasks = await db.task.findMany({
    where: { isPersonal: false, deleteRequestedAt: { not: null } },
    orderBy: { deleteRequestedAt: "asc" },
    take: 100,
  });
  return tasks.filter(
    (task) =>
      task.deleteRequestedById !== actor.id && canControl(actor, task) && canViewTask(actor, task),
  );
}

// Telegram buttons for a deletion request: x:<taskId>:y deletes, x:<taskId>:n keeps.
export function deleteButtons(taskId: string) {
  return [
    { text: t("bot.actions.deleteYes"), data: `x:${taskId}:y` },
    { text: t("bot.actions.deleteNo"), data: `x:${taskId}:n` },
  ];
}

// The overseer deletes the task (approve) or keeps it; the requester can withdraw the request.
export async function resolveTaskDeletion(actor: Actor, taskId: string, approve: boolean) {
  const { task } = await load(taskId);
  if (!task.deleteRequestedAt) throw new TaskError("invalid");
  const own = task.deleteRequestedById === actor.id;
  const overseer = canControl(actor, task) && canViewTask(actor, task);
  if (approve ? !overseer : !overseer && !own) throw new TaskError("forbidden");
  if (approve) return removeForGood(actor, task, task.deleteReason);

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
  // Kept: the one who asked, the author and the assignee hear it (both outcomes are answered).
  if (!own) {
    const name = await nameOf(actor.id);
    for (const userId of new Set([task.deleteRequestedById, task.creatorId, task.assigneeId])) {
      if (!userId || userId === actor.id) continue;
      await notify(userId, () => ({
        type: "task_status",
        title: t("notifications.events.taskDeleteRejectedTitle"),
        body: t("notifications.events.taskDeleteRejectedBody", { name, title: task.title }),
        link: `/tasks/${taskId}`,
      }));
    }
  }
}
