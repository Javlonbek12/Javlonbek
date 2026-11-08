import { db } from "@/lib/db";
import { formatDay } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { Prisma, type TaskStatus, type User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { getUserToday } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { decideCoAssignee } from "@/modules/tasks/co-assignees";
import { resolveTaskDeletion } from "@/modules/tasks/delete-service";
import { TaskError } from "@/modules/tasks/errors";
import { STATUS_CODES, statusButton } from "@/modules/tasks/notifications";
import { changeStatus, decisionCount, listDecisions, type TaskView } from "@/modules/tasks/service";
import { availableTransitions } from "@/modules/tasks/status";
import { isLateWork } from "@/modules/tasks/today";

import type { BotReply } from "./conversation";
import type { TelegramButton } from "./keyboard";
import { whyNotStatus } from "./why";

// Decisions in the bot: the /pending list and the buttons under notices — approve or decline,
// accept or send back, cancel (after «Отменить задачу?»), delete or keep, add a co-assignee or
// decline. A button pressed in the /pending list redraws the list (the decided row goes, the
// others keep their buttons, the result is on top); one pressed under a notice answers in place.
// Callback data: t:<taskId>:<code>[:l], tc:<taskId>:y|n[:l], x:<taskId>:y|n[:l],
// ca:<requestId>:y|n[:l], rc (no reason after all). «:l» — pressed in the list.

const LIST = "l";
// At most this many decisions in /pending, each with its buttons.
export const PENDING_LIMIT = 15;

const title60 = (text: string, title: string) => `${text} · ${title}`.slice(0, 60);

function taskLine(task: Pick<TaskView, "title" | "dueDate" | "status">, today: string) {
  const due = task.dueDate
    ? ` — ${formatDay(task.dueDate)}${isLateWork(task, today) ? " 🔥" : ""}`
    : "";
  return `• ${task.title}${due}`;
}

type PendingOptions = {
  // A line on top: what the last button did.
  notice?: string | null;
  // This task's row asks «Отменить задачу?» instead of its usual buttons.
  confirmCancel?: string;
};

// «Ждут вашего решения»: the same list as the site's «Ждут решения» (listDecisions), each item
// with its own row of buttons.
export async function showPending(
  user: User,
  today: string,
  options: PendingOptions = {},
): Promise<BotReply> {
  const decisions = await listDecisions(user);
  const items: { line: string; buttons: TelegramButton[] }[] = [];
  const inList = (button: TelegramButton) => ({ ...button, data: `${button.data}:${LIST}` });

  for (const task of [...decisions.approve, ...decisions.accept]) {
    const waiting = task.status === "PENDING_APPROVAL";
    const line = `${taskLine(task, today)} · ${t(waiting ? "bot.lists.toApprove" : "bot.lists.toAccept")}`;
    if (options.confirmCancel === task.id) {
      items.push({ line, buttons: cancelButtons(task.id, task.title).map(inList) });
      continue;
    }
    const buttons = waiting
      ? [
          statusButton(
            title60(
              t(task.assigneeId === user.id ? "bot.actions.takeOn" : "bot.actions.approve"),
              task.title,
            ),
            task.id,
            "A",
          ),
          statusButton(t("bot.actions.decline"), task.id, "D"),
        ]
      : [
          statusButton(title60(t("bot.actions.accept"), task.title), task.id, "F"),
          statusButton(t("bot.actions.returnWork"), task.id, "W"),
        ];
    if (availableTransitions(user, task).includes("CANCELLED"))
      buttons.push(statusButton("✖️", task.id, "C"));
    items.push({ line, buttons: buttons.map(inList) });
  }
  for (const task of decisions.remove)
    items.push({
      line: `• ${task.title} · ${t("bot.lists.toDelete")}`,
      buttons: [
        { text: title60(t("bot.actions.deleteYes"), task.title), data: `x:${task.id}:y:${LIST}` },
        { text: t("bot.actions.deleteNo"), data: `x:${task.id}:n:${LIST}` },
      ],
    });
  for (const request of decisions.coAssignees)
    items.push({
      line: `• ${request.task.title} · ${t("bot.lists.coRequest", { requester: request.requestedBy, name: request.name })}`,
      buttons: [
        {
          text: title60(t("bot.actions.coAdd"), request.name),
          data: `ca:${request.id}:y:${LIST}`,
        },
        { text: t("bot.actions.coDecline"), data: `ca:${request.id}:n:${LIST}` },
      ],
    });

  const shown = items.slice(0, PENDING_LIMIT);
  const lines = [`${t("bot.lists.pending")} (${decisionCount(decisions)})`];
  if (items.length === 0) lines.push(t("bot.lists.empty"));
  lines.push(...shown.map((item) => item.line));
  if (items.length > shown.length)
    lines.push(t("bot.lists.more", { count: items.length - shown.length }));
  return {
    text: [options.notice, lines.join("\n"), t("bot.lists.open", { url: getEnv().APP_URL })]
      .filter(Boolean)
      .join("\n\n"),
    buttons: shown.map((item) => item.buttons),
  };
}

// «Отменить задачу?» — Да / Нет.
function cancelButtons(taskId: string, title: string): TelegramButton[] {
  return [
    { text: title60(t("bot.actions.cancelYes"), title), data: `tc:${taskId}:y` },
    { text: t("bot.actions.cancelNo"), data: `tc:${taskId}:n` },
  ];
}

// ---------- reasons («Отклонить», «На доработку») ----------

// A change that needs a reason waits for it: a reply to the bot's question, or any text within a
// few minutes of it. Anything else is an ordinary message (a new task is never taken for a reason).
const REASON_KEY = (userId: string) => `bot.reason:${userId}`;
const REASON_TTL_MS = 30 * 60_000;
export const REASON_WINDOW_MS = 5 * 60_000;

type WaitingReason = { taskId: string; to: TaskStatus; at: number; messageId?: number };

async function readReason(userId: string): Promise<WaitingReason | null> {
  const row = await db.systemState.findUnique({ where: { key: REASON_KEY(userId) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as WaitingReason;
  } catch {
    return null;
  }
}

async function writeReason(userId: string, waiting: WaitingReason) {
  const value = JSON.stringify(waiting);
  await db.systemState.upsert({
    where: { key: REASON_KEY(userId) },
    create: { key: REASON_KEY(userId), value },
    update: { value },
  });
}

async function dropReason(userId: string) {
  await db.systemState.deleteMany({ where: { key: REASON_KEY(userId) } });
}

async function askReason(user: User, taskId: string, to: TaskStatus): Promise<BotReply> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  await writeReason(user.id, { taskId, to, at: Date.now() });
  return {
    text: t("bot.actions.askReason", { title: task.title }),
    buttons: [[{ text: t("bot.actions.reasonCancel"), data: "rc" }]],
    reasonPrompt: true,
  };
}

// The bot's question went out as this message: a reply to it is the reason, whenever it comes.
export async function rememberReasonMessage(userId: string, messageId: number) {
  const waiting = await readReason(userId);
  if (waiting) await writeReason(userId, { ...waiting, messageId });
}

// The text completes the waiting change when it answers the question: a reply to it, or (without
// replying) within a few minutes. A reply to some other message is never a reason.
export async function applyReason(
  user: User,
  text: string,
  replyTo?: number | null,
): Promise<BotReply | null> {
  const waiting = await readReason(user.id);
  if (!waiting) return null;
  const age = Date.now() - waiting.at;
  if (age > REASON_TTL_MS) {
    await dropReason(user.id);
    return null;
  }
  const answers = replyTo != null ? replyTo === waiting.messageId : age <= REASON_WINDOW_MS;
  if (!answers) return null;
  await dropReason(user.id);
  const result = await applyStatus(user, waiting.taskId, waiting.to, text.trim().slice(0, 1000));
  return result.ok ? { text: result.text } : result.reply;
}

// ---------- status changes ----------

type Outcome = { ok: true; text: string } | { ok: false; reply: BotReply };

async function applyStatus(
  user: User,
  taskId: string,
  to: TaskStatus,
  reason: string | null,
): Promise<Outcome> {
  try {
    const task = await changeStatus(user, taskId, to, { reason });
    return {
      ok: true,
      text: t("bot.actions.result", {
        status: t(`tasks.status.${task.status}`),
        title: task.title,
        name: displayName(user),
      }),
    };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    if (error.code === "reason") return { ok: false, reply: await askReason(user, taskId, to) };
    return { ok: false, reply: { text: await whyNotStatus(user, taskId, to, error.code) } };
  }
}

// The answer to a button: in the list, the list again with the result on top; under a notice, the
// result in place of the notice.
async function answer(user: User, text: string, fromList: boolean, now?: Date): Promise<BotReply> {
  if (!fromList) return { text, edit: true };
  return {
    ...(await showPending(user, await getUserToday(user.id, now), { notice: text })),
    edit: true,
  };
}

async function onStatusButton(
  user: User,
  taskId: string,
  code: string,
  fromList: boolean,
  now?: Date,
): Promise<BotReply> {
  if (code === "C") return askCancel(user, taskId, fromList, now);
  const to = STATUS_CODES[code as keyof typeof STATUS_CODES] as TaskStatus | undefined;
  if (!to) return { text: t("bot.actions.noRights") };
  const result = await applyStatus(user, taskId, to, null);
  if (result.ok) return answer(user, result.text, fromList, now);
  // A reason is asked in a message of its own; the list stays as it is.
  if (result.reply.reasonPrompt) return result.reply;
  return fromList ? answer(user, result.reply.text, true, now) : result.reply;
}

// «✖️ Отменить задачу» asks first: in the list, the task's row turns into «Да / Нет»; under a
// notice, the question comes as a message of its own (the notice stays).
async function askCancel(
  user: User,
  taskId: string,
  fromList: boolean,
  now?: Date,
): Promise<BotReply> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || !availableTransitions(user, task).includes("CANCELLED")) {
    const why = await whyNotStatus(user, taskId, "CANCELLED", "forbidden");
    return fromList ? answer(user, why, true, now) : { text: why };
  }
  const question = t("bot.actions.cancelAsk", { title: task.title });
  if (fromList)
    return {
      ...(await showPending(user, await getUserToday(user.id, now), {
        notice: question,
        confirmCancel: taskId,
      })),
      edit: true,
    };
  return { text: question, buttons: [cancelButtons(task.id, task.title)] };
}

async function onCancelAnswer(
  user: User,
  taskId: string,
  yes: boolean,
  fromList: boolean,
  now?: Date,
): Promise<BotReply> {
  if (!yes) {
    if (fromList) return answer(user, "", true, now);
    const task = await db.task.findUnique({ where: { id: taskId } });
    return { text: t("bot.actions.cancelKept", { title: task?.title ?? "" }), edit: true };
  }
  const result = await applyStatus(user, taskId, "CANCELLED", null);
  return answer(user, result.ok ? result.text : result.reply.text, fromList, now);
}

async function onDeletion(
  user: User,
  taskId: string,
  approve: boolean,
  fromList: boolean,
  now?: Date,
): Promise<BotReply> {
  let text: string;
  try {
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    await resolveTaskDeletion(user, taskId, approve);
    text = t(approve ? "bot.actions.deleted" : "bot.actions.kept", { title: task.title });
  } catch (error) {
    if (!(error instanceof TaskError) && !(error instanceof Prisma.PrismaClientKnownRequestError))
      throw error;
    text = t("bot.why.deleteGone");
  }
  return answer(user, text, fromList, now);
}

async function onCoAssignee(
  user: User,
  requestId: string,
  approve: boolean,
  fromList: boolean,
  now?: Date,
): Promise<BotReply> {
  const request = await db.taskCoAssigneeRequest.findUnique({
    where: { id: requestId },
    include: { user: true, task: { select: { title: true } } },
  });
  let text: string;
  if (!request) text = t("bot.why.coGone");
  else
    try {
      await decideCoAssignee(user, requestId, approve);
      text = t(approve ? "bot.actions.coAdded" : "bot.actions.coDeclined", {
        name: displayName(request.user),
        title: request.task.title,
      });
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      text = t(`tasks.errors.${error.code}`);
    }
  return answer(user, text, fromList, now);
}

// The decision buttons; null for any other callback.
export async function handleDecisionCallback(
  user: User,
  parts: string[],
  now?: Date,
): Promise<BotReply | null> {
  const [kind, id, value, origin] = parts;
  const fromList = origin === LIST;
  if (kind === "rc") {
    await dropReason(user.id);
    return { text: t("bot.actions.reasonCancelled"), edit: true };
  }
  if (!id) return null;
  if (kind === "t" && value) return onStatusButton(user, id, value, fromList, now);
  if (kind === "tc" && (value === "y" || value === "n"))
    return onCancelAnswer(user, id, value === "y", fromList, now);
  if (kind === "x" && (value === "y" || value === "n"))
    return onDeletion(user, id, value === "y", fromList, now);
  if (kind === "ca" && (value === "y" || value === "n"))
    return onCoAssignee(user, id, value === "y", fromList, now);
  return null;
}
