import { z } from "zod";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canViewTask } from "./access";
import { TaskError } from "./errors";

const bodySchema = z.string().trim().min(1).max(2000);

export async function addComment(actor: Actor, taskId: string, body: string) {
  const text = bodySchema.safeParse(body);
  if (!text.success) throw new TaskError("invalid");
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(actor, task)) throw new TaskError("forbidden");

  const comment = await db.comment.create({
    data: { taskId, authorId: actor.id, body: text.data },
  });
  await logActivity({
    actorId: actor.id,
    action: "task.comment_added",
    entityType: "Task",
    entityId: taskId,
  });

  // Creator and assignee hear about it, if they can see the task and didn't write it.
  const author = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const recipients = await db.user.findMany({
    where: { id: { in: [task.creatorId, task.assigneeId].filter((id) => id !== actor.id) } },
  });
  for (const user of recipients) {
    if (!canViewTask(user, task)) continue;
    await notify(user.id, {
      type: "task_comment",
      title: t("notifications.events.taskCommentTitle"),
      body: t("notifications.events.taskCommentBody", {
        title: task.title,
        name: displayName(author),
        text: text.data.length > 200 ? `${text.data.slice(0, 200)}…` : text.data,
      }),
      link: `/tasks/${taskId}`,
    });
  }
  return comment;
}

export async function listComments(taskId: string) {
  return db.comment.findMany({
    where: { taskId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });
}
