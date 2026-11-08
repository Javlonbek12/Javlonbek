import { db } from "@/lib/db";
import type { TelegramButton } from "@/modules/bot/keyboard";
import type { Actor } from "@/modules/core/permissions";
import { availableTransitions } from "@/modules/tasks/status";

// A notification that asks the person to decide something: the app shows the decision right in
// the list, and once it is decided (here, in the bot, on the task, by someone else) the
// notification reads itself — the unread count shows only what still waits.
export type PendingDecision =
  | { kind: "approve" | "accept" | "waiting" | "delete"; taskId: string }
  | { kind: "coAssignee"; requestId: string }
  | { kind: "postReview" | "postLegal"; postId: string };

type NotificationLike = { type: string; link: string | null; buttons: unknown };

const idAfter = (link: string | null, prefix: string) => {
  const match = link && new RegExp(`^${prefix}([A-Za-z0-9_-]{1,64})$`).exec(link);
  return match ? match[1]! : null;
};

// What the notification asks for: from the decision buttons sent with it, or (older ones,
// saved without buttons) from its type and link.
export function decisionOf(notification: NotificationLike): PendingDecision | null {
  const rows = Array.isArray(notification.buttons)
    ? (notification.buttons as TelegramButton[][])
    : [];
  const data = rows[0]?.[0]?.data ?? "";
  const [kind, id, value] = data.split(":");
  if (id) {
    if (kind === "t" && value === "A") return { kind: "approve", taskId: id };
    if (kind === "t" && value === "F") return { kind: "accept", taskId: id };
    if (kind === "x") return { kind: "delete", taskId: id };
    if (kind === "ca") return { kind: "coAssignee", requestId: id };
  }
  const taskId = idAfter(notification.link, "/tasks/");
  const postId = idAfter(notification.link, "/content/");
  switch (notification.type) {
    case "task_pending_approval":
      return taskId && !rows.length ? { kind: "approve", taskId } : null;
    case "task_waiting":
      return taskId ? { kind: "waiting", taskId } : null;
    case "task_delete_request":
      return taskId ? { kind: "delete", taskId } : null;
    case "content_review":
      return postId ? { kind: "postReview", postId } : null;
    case "content_legal":
      return postId ? { kind: "postLegal", postId } : null;
  }
  return null;
}

type TaskState = { status: string; deleteRequestedAt: Date | null };

function stillPending(
  decision: PendingDecision,
  tasks: Map<string, TaskState>,
  requests: Set<string>,
  posts: Map<string, string>,
) {
  switch (decision.kind) {
    case "approve":
      return tasks.get(decision.taskId)?.status === "PENDING_APPROVAL";
    case "accept":
      return tasks.get(decision.taskId)?.status === "IN_REVIEW";
    case "waiting":
      return ["PENDING_APPROVAL", "IN_REVIEW"].includes(tasks.get(decision.taskId)?.status ?? "");
    case "delete":
      return !!tasks.get(decision.taskId)?.deleteRequestedAt;
    case "coAssignee":
      return requests.has(decision.requestId);
    case "postReview":
      return posts.get(decision.postId) === "REVIEW";
    case "postLegal":
      return posts.get(decision.postId) === "LEGAL_REVIEW";
  }
}

const DECISION_TYPES = [
  "task_pending_approval",
  "task_status",
  "task_waiting",
  "task_delete_request",
  "content_review",
  "content_legal",
];

// Unread notifications whose decision was already taken become read; returns the ones that still
// wait, by notification id, with what they wait for.
export async function settleDecided(userId: string, now = new Date()) {
  const unread = await db.notification.findMany({
    where: { userId, readAt: null, type: { in: DECISION_TYPES } },
    select: { id: true, type: true, link: true, buttons: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const decisions = new Map<string, PendingDecision>();
  for (const n of unread) {
    const decision = decisionOf(n);
    if (decision) decisions.set(n.id, decision);
  }
  if (decisions.size === 0) return decisions;
  const all = [...decisions.values()];
  const taskIds = all.flatMap((d) => ("taskId" in d ? [d.taskId] : []));
  const requestIds = all.flatMap((d) => (d.kind === "coAssignee" ? [d.requestId] : []));
  const postIds = all.flatMap((d) => ("postId" in d ? [d.postId] : []));
  const [tasks, requests, posts] = await Promise.all([
    taskIds.length
      ? db.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, status: true, deleteRequestedAt: true },
        })
      : [],
    requestIds.length
      ? db.taskCoAssigneeRequest.findMany({
          where: { id: { in: requestIds } },
          select: { id: true },
        })
      : [],
    postIds.length
      ? db.contentPost.findMany({
          where: { id: { in: postIds } },
          select: { id: true, status: true },
        })
      : [],
  ]);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const requestSet = new Set(requests.map((r) => r.id));
  const postMap = new Map(posts.map((post) => [post.id, post.status as string]));
  const decided = [...decisions].filter(
    ([, decision]) => !stillPending(decision, taskMap, requestSet, postMap),
  );
  if (decided.length) {
    await db.notification.updateMany({
      where: { id: { in: decided.map(([id]) => id) }, userId, readAt: null },
      data: { readAt: now },
    });
    for (const [id] of decided) decisions.delete(id);
  }
  return decisions;
}

// The one-press answer the app offers in the list: «Утвердить» or «Принять» for a task the person
// may decide now, «Добавить» / «Отказать» for a co-assignee request. Anything else opens.
// `takeOn`: the assignee decides on a request themselves — «Принять задачу», as on the task card.
export type InAppDecision =
  | { kind: "approve"; taskId: string; takeOn: boolean }
  | { kind: "accept"; taskId: string }
  | { kind: "coAssignee"; requestId: string };

export async function inAppDecisions(actor: Actor, pending: Map<string, PendingDecision>) {
  const result = new Map<string, InAppDecision>();
  const taskIds = [...pending.values()].flatMap((d) =>
    d.kind === "approve" || d.kind === "accept" || d.kind === "waiting" ? [d.taskId] : [],
  );
  const tasks = taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } } }) : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const [id, decision] of pending) {
    if (decision.kind === "coAssignee") {
      result.set(id, decision);
      continue;
    }
    if (decision.kind !== "approve" && decision.kind !== "accept" && decision.kind !== "waiting")
      continue;
    const task = byId.get(decision.taskId);
    if (!task) continue;
    const allowed = availableTransitions(actor, task);
    if (task.status === "PENDING_APPROVAL" && allowed.includes("APPROVED"))
      result.set(id, { kind: "approve", taskId: task.id, takeOn: task.assigneeId === actor.id });
    else if (task.status === "IN_REVIEW" && allowed.includes("DONE"))
      result.set(id, { kind: "accept", taskId: task.id });
  }
  return result;
}
