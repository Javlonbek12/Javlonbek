import { z } from "zod";

import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import { notify } from "@/modules/core/notifications/service";
import type { Actor } from "@/modules/core/permissions";
import { ACTIVE_USER } from "@/modules/core/users/active";
import { displayName } from "@/modules/core/users/display-name";

import { withAccess } from "@/modules/core/access/actor";
import { getRoleConfig } from "@/modules/core/access/config";

import { canViewTask, isDoer, reviewerOf } from "./access";
import { TaskError } from "./errors";
import { mentionedUserIds } from "./mentions";

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

  // Creator, assignee and co-assignees hear about it, whoever accepts the result, whoever decides
  // while the task waits, and anyone @mentioned (routing v2) — if they can see the task and didn't
  // write it.
  const author = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  // Deactivated people are not mentioned and hear nothing.
  const people = await db.user.findMany({ where: ACTIVE_USER });
  const mentioned = new Set(mentionedUserIds(text.data, people));
  const involved = new Set([
    task.creatorId,
    ...(task.isPersonal ? [] : [reviewerOf(task)]),
    ...(task.status === "PENDING_APPROVAL" ? task.deciderIds : []),
  ]);
  const recipients = people.filter(
    (user) =>
      user.id !== actor.id &&
      (mentioned.has(user.id) || involved.has(user.id) || isDoer(user, task)),
  );
  const config = recipients.length ? await getRoleConfig() : undefined;
  for (const user of recipients) {
    if (!canViewTask(await withAccess(user, config), task)) continue;
    await notify(user.id, () => ({
      type: "task_comment",
      title: mentioned.has(user.id)
        ? t("notifications.events.taskMentionTitle")
        : t("notifications.events.taskCommentTitle"),
      body: t("notifications.events.taskCommentBody", {
        title: task.title,
        name: displayName(author),
        text: text.data.length > 200 ? `${text.data.slice(0, 200)}…` : text.data,
      }),
      link: `/tasks/${taskId}`,
    }));
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
