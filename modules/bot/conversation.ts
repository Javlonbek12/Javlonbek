import { db } from "@/lib/db";
import { addDays, addMonths, formatDay, isDateString, startOfMonth } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { Prisma, type TaskStatus, type User } from "@/lib/generated/prisma/client";
import { t, type TranslationKey } from "@/lib/i18n";
import { parseUserDate } from "@/lib/parse-date";
import {
  extractTasks,
  interpretCommand,
  type ExtractedTask,
  type InterpretedCommand,
} from "@/modules/ai/prompts";
import { AiError } from "@/modules/ai/run";
import type { PromptContext } from "@/modules/ai/context";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";
import { isApprover } from "@/modules/tasks/access";
import { TaskError } from "@/modules/tasks/errors";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { STATUS_CODES, statusButton } from "@/modules/tasks/notifications";
import { completeTask, findTasksByQuery, setDueDate } from "@/modules/tasks/quick-actions";
import {
  changeStatus,
  createTask,
  getTodayOverview,
  listProjects,
  listTasks,
  type TaskView,
} from "@/modules/tasks/service";
import { todayInTimezone } from "@/lib/dates";
import type { AudioInput, SpeechToText } from "@/modules/stt";

import {
  assigneeButtons,
  dueButtons,
  editMenuButtons,
  renderCardButtons,
  renderCardText,
  type DraftPayload,
  type DraftTask,
} from "./draft-card";
import { matchPerson } from "./match";
import type { TelegramButton } from "./keyboard";

// What the bot should answer. `edit` = replace the message the button belongs to.
export type BotReply = {
  text: string;
  buttons?: TelegramButton[][];
  edit?: boolean;
  // Set when the reply is a confirmation card, so its message id can be remembered.
  draftId?: string;
};

// AI functions are injectable for tests.
export type ConversationDeps = {
  extract: (userId: string, text: string, ctx: PromptContext) => Promise<ExtractedTask[]>;
  interpret: (userId: string, text: string, ctx: PromptContext) => Promise<InterpretedCommand>;
  now?: Date;
};

export const defaultDeps: ConversationDeps = {
  extract: (userId, text, ctx) => extractTasks(userId, text, ctx),
  interpret: (userId, text, ctx) => interpretCommand(userId, text, ctx),
};

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const AWAIT_TTL_MS = 30 * 60 * 1000;
const MAX_VOICE_SECONDS = 300;

async function userToday(user: User, now = new Date()) {
  const { timezone } = await getSettings(user.id);
  return { today: todayInTimezone(timezone, now), timezone };
}

async function team() {
  return db.user.findMany({
    select: { id: true, firstName: true, lastName: true, telegramUsername: true },
    orderBy: { firstName: "asc" },
  });
}

async function promptContext(user: User, now?: Date): Promise<PromptContext> {
  const [{ today, timezone }, people, projects] = await Promise.all([
    userToday(user, now),
    team(),
    listProjects(user),
  ]);
  return {
    today,
    timezone,
    speakerName: displayName(user),
    teamNames: people.map((p) => displayName(p)),
    projects,
  };
}

// ---------- confirmation cards ----------

async function loadDraft(user: User, draftId: string) {
  const draft = await db.botDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.userId !== user.id || Date.now() - draft.createdAt.getTime() > DRAFT_TTL_MS)
    return null;
  return { ...draft, payload: draft.payload as unknown as DraftPayload };
}

// Saves the card; `awaiting` says what the next text message means (none by default).
async function saveDraft(
  draftId: string,
  payload: DraftPayload,
  awaiting: Prisma.InputJsonValue | null = null,
) {
  await db.botDraft.update({
    where: { id: draftId },
    data: {
      payload: payload as unknown as Prisma.InputJsonValue,
      awaiting: awaiting ?? Prisma.DbNull,
    },
  });
}

async function cardReply(draftId: string, payload: DraftPayload, edit: boolean): Promise<BotReply> {
  const people = await team();
  return {
    text: renderCardText(payload, people),
    buttons: renderCardButtons(draftId, payload, people),
    edit,
    draftId,
  };
}

export function resolveTasks(
  extracted: ExtractedTask[],
  people: {
    id: string;
    firstName: string;
    lastName: string | null;
    telegramUsername: string | null;
  }[],
  speakerId: string,
): DraftTask[] {
  return extracted.map((task) => {
    const base = {
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
      project: task.project,
      saidName: task.assigneeName,
    };
    if (!task.assigneeName)
      return { ...base, assigneeId: null, unresolved: false, candidateIds: [] };
    const match = matchPerson(task.assigneeName, people);
    if (match.status === "matched") {
      return {
        ...base,
        assigneeId: match.user.id === speakerId ? null : match.user.id,
        unresolved: false,
        candidateIds: [],
      };
    }
    return {
      ...base,
      assigneeId: null,
      unresolved: true,
      candidateIds: match.status === "ambiguous" ? match.candidates.map((c) => c.id) : [],
    };
  });
}

async function startDraft(
  user: User,
  chatId: bigint,
  tasks: DraftTask[],
  prefix?: string,
): Promise<BotReply> {
  if (tasks.length === 0)
    return { text: [prefix, t("bot.card.empty")].filter(Boolean).join("\n\n") };
  const payload: DraftPayload = { tasks };
  const draft = await db.botDraft.create({
    data: { userId: user.id, chatId, payload: payload as unknown as Prisma.InputJsonValue },
  });
  const reply = await cardReply(draft.id, payload, false);
  return prefix ? { ...reply, text: `${prefix}\n\n${reply.text}` } : reply;
}

async function saveTasks(user: User, draftId: string, payload: DraftPayload): Promise<BotReply> {
  let saved = 0;
  let pending = 0;
  const errors: string[] = [];
  for (const task of payload.tasks) {
    const personal = task.assigneeId === null;
    try {
      const created = await createTask(
        user,
        {
          title: task.title,
          description: null,
          isPersonal: personal,
          assigneeId: task.assigneeId,
          startDate: null,
          dueDate: task.dueDate,
          priority: task.priority ?? "MEDIUM",
          project: task.project,
          planId: null,
          estimateHours: null,
        },
        personal ? "draft" : isApprover(user.role) ? "approve" : "submit",
      );
      saved += 1;
      if (created.status === "PENDING_APPROVAL") pending += 1;
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      errors.push(
        t("bot.card.failed", {
          title: task.title,
          reason: t(`tasks.errors.${error.code}` as TranslationKey, { mb: 20 }),
        }),
      );
    }
  }
  await db.botDraft.delete({ where: { id: draftId } });
  const lines = [t("bot.card.saved", { count: saved })];
  if (pending > 0) lines.push(t("bot.card.savedPending", { count: pending }));
  lines.push(...errors, t("bot.lists.open", { url: `${getEnv().APP_URL}/tasks` }));
  return { text: lines.join("\n"), edit: true };
}

async function handleDraftCallback(user: User, parts: string[], now?: Date): Promise<BotReply> {
  const [, draftId, action, indexText, arg] = parts;
  const draft = await loadDraft(user, draftId);
  if (!draft) return { text: t("bot.card.expired"), edit: true };
  const payload = draft.payload;
  const index = Number(indexText);
  const task = Number.isInteger(index) ? payload.tasks[index] : undefined;
  const people = await team();

  switch (action) {
    case "save":
      if (payload.tasks.some((x) => x.unresolved)) return cardReply(draftId, payload, true);
      return saveTasks(user, draftId, payload);
    case "cancel":
      await db.botDraft.delete({ where: { id: draftId } });
      return { text: t("bot.card.cancelled"), edit: true };
    case "menu":
      await saveDraft(draftId, payload);
      return cardReply(draftId, payload, true);
  }
  if (!task) return cardReply(draftId, payload, true);

  switch (action) {
    case "e":
      return {
        text: t("bot.edit.menu", { title: task.title }),
        buttons: editMenuButtons(draftId, index),
        edit: true,
      };
    case "t":
      await saveDraft(draftId, payload, { kind: "title", index });
      return { text: t("bot.edit.askTitle"), edit: true };
    case "dt":
      await saveDraft(draftId, payload, { kind: "due", index });
      return { text: t("bot.edit.askDue"), edit: true };
    case "due": {
      const { today } = await userToday(user, now);
      const options = {
        today,
        tomorrow: addDays(today, 1),
        week: addDays(today, 7),
        monthEnd: addDays(addMonths(startOfMonth(today), 1), -1),
      };
      return {
        text: t("bot.edit.menu", { title: task.title }),
        buttons: dueButtons(draftId, index, options),
        edit: true,
      };
    }
    case "dv": {
      const date =
        arg === "none" ? null : `${arg?.slice(0, 4)}-${arg?.slice(4, 6)}-${arg?.slice(6, 8)}`;
      if (date === null || isDateString(date)) task.dueDate = date;
      await saveDraft(draftId, payload);
      return cardReply(draftId, payload, true);
    }
    case "as":
      return {
        text: t("bot.card.chooseAssignee", { title: task.title }),
        buttons: assigneeButtons(draftId, index, task, people, true),
        edit: true,
      };
    case "av": {
      if (arg === "me") task.assigneeId = null;
      else if (people.some((p) => p.id === arg)) task.assigneeId = arg === user.id ? null : arg!;
      else return cardReply(draftId, payload, true);
      task.unresolved = false;
      task.candidateIds = [];
      await saveDraft(draftId, payload);
      return cardReply(draftId, payload, true);
    }
    case "rm":
      payload.tasks.splice(index, 1);
      if (payload.tasks.length === 0) {
        await db.botDraft.delete({ where: { id: draftId } });
        return { text: t("bot.card.cancelled"), edit: true };
      }
      await saveDraft(draftId, payload);
      return cardReply(draftId, payload, true);
  }
  return cardReply(draftId, payload, true);
}

// A plain text message answering "type the new title / date".
async function applyAwaitingText(
  user: User,
  draftId: string,
  text: string,
  now?: Date,
): Promise<BotReply | null> {
  const draft = await loadDraft(user, draftId);
  if (!draft?.awaiting) return null;
  const { kind, index } = draft.awaiting as { kind: "title" | "due"; index: number };
  const task = draft.payload.tasks[index];
  if (!task) return null;
  if (kind === "title") {
    task.title = text.trim().slice(0, 200) || task.title;
  } else {
    const { today } = await userToday(user, now);
    const date = parseUserDate(text, today);
    if (!date) return { text: t("bot.edit.badDate") };
    task.dueDate = date;
  }
  await saveDraft(draftId, draft.payload);
  return cardReply(draftId, draft.payload, false);
}

async function findAwaitingDraft(user: User) {
  return db.botDraft.findFirst({
    where: {
      userId: user.id,
      awaiting: { not: Prisma.DbNull },
      updatedAt: { gte: new Date(Date.now() - AWAIT_TTL_MS) },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ---------- task lists ----------

function taskLine(task: Pick<TaskView, "title" | "dueDate">, today: string) {
  const due = task.dueDate
    ? ` — ${formatDay(task.dueDate)}${task.dueDate < today ? " 🔥" : ""}`
    : "";
  return `• ${task.title}${due}`;
}

function listBlock(title: string, tasks: TaskView[], today: string, limit = 15) {
  const lines = [`${title} (${tasks.length})`];
  if (tasks.length === 0) lines.push(t("bot.lists.empty"));
  lines.push(...tasks.slice(0, limit).map((task) => taskLine(task, today)));
  if (tasks.length > limit) lines.push(t("bot.lists.more", { count: tasks.length - limit }));
  return lines.join("\n");
}

export async function showList(
  user: User,
  kind: "today" | "week" | "overdue" | "pending",
  now?: Date,
): Promise<BotReply> {
  const { today } = await userToday(user, now);
  const footer = t("bot.lists.open", { url: getEnv().APP_URL });
  if (kind === "today") {
    const { dueToday, overdue } = await getTodayOverview(user, today);
    return {
      text: [
        listBlock(t("bot.lists.today"), dueToday, today),
        listBlock(t("bot.lists.overdue"), overdue, today),
        footer,
      ].join("\n\n"),
    };
  }
  if (kind === "week" || kind === "overdue") {
    const filters = parseTaskFilters({ scope: "mine", due: kind });
    const tasks = await listTasks(user, filters, today);
    return {
      text: [
        listBlock(t(kind === "week" ? "bot.lists.week" : "bot.lists.overdue"), tasks, today),
        footer,
      ].join("\n\n"),
    };
  }
  const { waiting } = await getTodayOverview(user, today);
  const buttons = waiting
    .slice(0, 8)
    .map((task) =>
      task.status === "PENDING_APPROVAL"
        ? [
            statusButton(`${t("bot.actions.approve")} · ${task.title}`.slice(0, 60), task.id, "A"),
            statusButton(t("bot.actions.reject"), task.id, "D"),
          ]
        : [
            statusButton(`${t("bot.actions.accept")} · ${task.title}`.slice(0, 60), task.id, "F"),
            statusButton(t("bot.actions.rework"), task.id, "W"),
          ],
    );
  return {
    text: [listBlock(t("bot.lists.pending"), waiting, today), footer].join("\n\n"),
    buttons,
  };
}

// ---------- status buttons and quick actions ----------

async function handleStatusCallback(user: User, taskId: string, code: string): Promise<BotReply> {
  const to = STATUS_CODES[code as keyof typeof STATUS_CODES] as TaskStatus | undefined;
  if (!to) return { text: t("bot.actions.noRights") };
  try {
    const task = await changeStatus(user, taskId, to);
    return {
      text: t("bot.actions.result", {
        status: t(`tasks.status.${to}`),
        title: task.title,
        name: displayName(user),
      }),
      edit: true,
    };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    return {
      text: error.code === "blocked" ? t("bot.actions.blocked") : t("bot.actions.noRights"),
    };
  }
}

async function reschedule(user: User, taskId: string, date: string): Promise<BotReply> {
  try {
    const task = await setDueDate(user, taskId, date);
    return { text: t("bot.actions.rescheduled", { title: task.title, date: formatDay(date) }) };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    return { text: t("bot.actions.noRights") };
  }
}

async function complete(user: User, taskId: string): Promise<BotReply> {
  try {
    const status = await completeTask(user, taskId);
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    return {
      text: t("bot.actions.completed", { title: task.title, status: t(`tasks.status.${status}`) }),
    };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    return {
      text: error.code === "blocked" ? t("bot.actions.blocked") : t("bot.actions.noRights"),
    };
  }
}

async function quickAction(user: User, command: InterpretedCommand): Promise<BotReply> {
  if (command.intent === "reschedule" && !command.newDueDate)
    return { text: t("bot.actions.needDate") };
  const found = command.taskQuery ? await findTasksByQuery(user, command.taskQuery) : [];
  if (found.length === 0)
    return { text: t("bot.actions.notFound", { query: command.taskQuery ?? "" }) };
  if (found.length === 1) {
    return command.intent === "reschedule"
      ? reschedule(user, found[0].id, command.newDueDate!)
      : complete(user, found[0].id);
  }
  const data = (id: string) =>
    command.intent === "reschedule"
      ? `r:${id}:${command.newDueDate!.replaceAll("-", "")}`
      : `k:${id}`;
  return {
    text: t("bot.actions.choose"),
    buttons: found.map((task) => [{ text: task.title.slice(0, 60), data: data(task.id) }]),
  };
}

// ---------- entry points ----------

export async function handleCallback(
  user: User,
  data: string,
  deps: ConversationDeps = defaultDeps,
): Promise<BotReply> {
  const parts = data.split(":");
  if (parts[0] === "d") return handleDraftCallback(user, parts, deps.now);
  if (parts[0] === "t" && parts[1]) return handleStatusCallback(user, parts[1], parts[2]);
  if (parts[0] === "r" && parts[1] && /^\d{8}$/.test(parts[2] ?? "")) {
    const d = parts[2];
    return reschedule(user, parts[1], `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  if (parts[0] === "k" && parts[1]) return complete(user, parts[1]);
  return { text: t("bot.card.expired") };
}

export async function handleText(
  user: User,
  chatId: bigint,
  text: string,
  deps: ConversationDeps = defaultDeps,
  prefix?: string,
): Promise<BotReply> {
  const awaiting = await findAwaitingDraft(user);
  if (awaiting) {
    const reply = await applyAwaitingText(user, awaiting.id, text, deps.now);
    if (reply) return reply;
  }

  const ctx = await promptContext(user, deps.now);
  let command: InterpretedCommand;
  try {
    command = await deps.interpret(user.id, text, ctx);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    if (error.code === "limit") return { text: t("ai.errors.limit") };
    // Without AI the message still becomes one task the user can fix in the card.
    const fallback = [prefix, t("bot.aiFallback")].filter(Boolean).join("\n\n");
    const single = resolveTasks(
      [
        {
          title: text.slice(0, 200),
          assigneeName: null,
          dueDate: null,
          priority: null,
          project: null,
        },
      ],
      [],
      user.id,
    );
    return startDraft(user, chatId, single, fallback);
  }

  switch (command.intent) {
    case "show_today":
      return showList(user, "today", deps.now);
    case "show_week":
      return showList(user, "week", deps.now);
    case "show_overdue":
      return showList(user, "overdue", deps.now);
    case "show_pending":
      return showList(user, "pending", deps.now);
    case "reschedule":
    case "complete":
      return quickAction(user, command);
    case "help":
      return { text: [prefix, t("bot.help")].filter(Boolean).join("\n\n") };
  }

  let extracted: ExtractedTask[];
  try {
    extracted = await deps.extract(user.id, text, ctx);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { text: t(`ai.errors.${error.code}`) };
  }
  return startDraft(user, chatId, resolveTasks(extracted, await team(), user.id), prefix);
}

export async function handleVoice(
  user: User,
  chatId: bigint,
  audio: AudioInput,
  durationSeconds: number,
  stt: SpeechToText,
  deps: ConversationDeps = defaultDeps,
): Promise<BotReply> {
  if (durationSeconds > MAX_VOICE_SECONDS) return { text: t("bot.voiceTooLong") };
  let text: string;
  try {
    text = await stt.transcribe(audio);
  } catch (error) {
    console.error("Speech recognition failed", error);
    return { text: t("bot.voiceFailed") };
  }
  if (!text) return { text: t("bot.voiceFailed") };
  return handleText(user, chatId, text, deps, t("bot.recognized", { text }));
}

export async function rememberCardMessage(draftId: string, messageId: number) {
  await db.botDraft.updateMany({ where: { id: draftId }, data: { messageId } });
}
