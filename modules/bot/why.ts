import { db } from "@/lib/db";
import type { Task, TaskStatus, User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { displayName } from "@/modules/core/users/display-name";
import { canEditTask, canViewTask, isClosed, isDoer, reviewerOf } from "@/modules/tasks/access";
import type { TaskErrorCode } from "@/modules/tasks/errors";

// Why the bot can't do what was asked, in words that say what is going on and who can do it —
// instead of a bare «Это действие вам недоступно».

async function names(ids: (string | null)[]) {
  const wanted = ids.filter((id): id is string => id !== null);
  if (wanted.length === 0) return "";
  const people = await db.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, firstName: true, lastName: true },
  });
  return wanted
    .map((id) => people.find((p) => p.id === id))
    .filter((p) => p !== undefined)
    .map(displayName)
    .join(", ");
}

const statusName = (status: TaskStatus) => t(`tasks.status.${status}`);

// What every refusal checks first: the task is gone or hidden, or already closed.
async function load(user: User, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !canViewTask(user, task)) return { text: t("bot.why.unavailable"), task: null };
  if (isClosed(task.status))
    return { text: t("bot.why.closed", { status: statusName(task.status) }), task: null };
  return { text: null, task };
}

// The status a decision button expects the task to be in: approve / decline a waiting task,
// accept / send back handed-in work.
const EXPECTED: Partial<Record<TaskStatus, TaskStatus>> = {
  APPROVED: "PENDING_APPROVAL",
  DRAFT: "PENDING_APPROVAL",
  DONE: "IN_REVIEW",
};

// A status change refused: already decided by someone, or who decides it.
export async function whyNotStatus(
  user: User,
  taskId: string,
  to: TaskStatus,
  code: TaskErrorCode,
): Promise<string> {
  if (code === "blocked") return t("bot.actions.blocked");
  if (code === "cancelledDependency") return t("bot.actions.cancelledDependency");
  const { text, task } = await load(user, taskId);
  if (!task) return text!;
  const expected = to === "IN_PROGRESS" && task.status !== "APPROVED" ? "IN_REVIEW" : EXPECTED[to];
  if (expected && task.status !== expected)
    return t("bot.why.alreadyDecided", { status: statusName(task.status) });
  if (to === "CANCELLED") return t("bot.why.cancel", { name: await names([task.creatorId]) });
  if (task.status === "PENDING_APPROVAL")
    return t("bot.why.deciders", { names: await names(task.deciderIds) });
  if (task.status === "IN_REVIEW") return reviewerText(task);
  return t("bot.actions.noRights");
}

async function reviewerText(task: Task) {
  const reviewer = reviewerOf(task);
  return reviewer
    ? t("bot.why.reviewer", { name: await names([reviewer]) })
    : t("bot.actions.noRights");
}

// «Перенеси …» refused: only the author (or whoever controls the task) moves the due date.
export async function whyNotReschedule(
  user: User,
  taskId: string,
  code: TaskErrorCode,
): Promise<string> {
  if (code === "invalid") return t("bot.edit.badDate");
  const { text, task } = await load(user, taskId);
  if (!task) return text!;
  if (!canEditTask(user, task))
    return t("bot.why.dateByAuthor", { name: await names([task.creatorId]) });
  return t("bot.actions.noRights");
}

// «Закрой …» refused: where the task is, and whose move it is.
export async function whyNotComplete(
  user: User,
  taskId: string,
  code: TaskErrorCode,
): Promise<string> {
  if (code === "blocked") return t("bot.actions.blocked");
  if (code === "cancelledDependency") return t("bot.actions.cancelledDependency");
  const { text, task } = await load(user, taskId);
  if (!task) return text!;
  switch (task.status) {
    case "DRAFT":
      return t("bot.why.draft");
    case "PENDING_APPROVAL":
      return t("bot.why.waitingApproval", { names: await names(task.deciderIds) });
    case "IN_REVIEW":
      return isDoer(user, task)
        ? t("bot.why.inReview", { name: await names([reviewerOf(task)]) })
        : reviewerText(task);
  }
  if (!isDoer(user, task)) return t("bot.why.doerCloses", { name: await names([task.assigneeId]) });
  return t("bot.actions.noRights");
}
