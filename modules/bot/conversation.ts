import { MAX_FILE_MB, MAX_FILES_PER_LANG } from "@/modules/content/files";
import { ContentError } from "@/modules/content/service";
import { handleSentButton } from "@/modules/content/telegram";
import { db } from "@/lib/db";
import {
  addDays,
  addMonths,
  formatDay,
  isDateString,
  startOfMonth,
  todayInTimezone,
} from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { Prisma, type TaskStatus, type User } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
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
import { createProposedTasks } from "@/modules/tasks/batch";
import { TaskError } from "@/modules/tasks/errors";
import { parseTaskFilters } from "@/modules/tasks/filters";
import {
  deleteButtons,
  listDeleteRequests,
  resolveTaskDeletion,
} from "@/modules/tasks/delete-service";
import { STATUS_CODES, statusButton } from "@/modules/tasks/notifications";
import { availableTransitions } from "@/modules/tasks/status";
import { shortRouteHints } from "@/modules/tasks/route-hints";
import { completeTask, findTasksByQuery, setDueDate } from "@/modules/tasks/quick-actions";
import {
  changeStatus,
  getTodayOverview,
  listProjects,
  listTasks,
  type TaskView,
} from "@/modules/tasks/service";
import type { AudioInput, SpeechToText } from "@/modules/stt";

export { resolveTasks };

import {
  assigneeButtons,
  dueButtons,
  editMenuButtons,
  renderCardButtons,
  renderCardText,
  type DraftPayload,
  type DraftTask,
} from "./draft-card";
import { resolveTasks } from "./resolve";
import { formatDateTime } from "@/lib/time";
import { proposeActionItems, type ActionItemExtractor } from "@/modules/meetings/minutes";
import {
  MeetingError,
  getMeetingDetail,
  recentMeetingsForNotes,
  saveNotes,
} from "@/modules/meetings/service";
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
  extractActionItems?: ActionItemExtractor;
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
  const draft = await db.botDraft.findUnique({ where: { id: draftId }, select: { userId: true } });
  const routes = draft
    ? await shortRouteHints(
        draft.userId,
        payload.tasks.map((task) => ({ assigneeId: task.assigneeId, personal: task.personal })),
      )
    : [];
  return {
    text: renderCardText(payload, people, routes),
    buttons: renderCardButtons(draftId, payload, people),
    edit,
    draftId,
  };
}

async function startDraft(
  user: User,
  chatId: bigint,
  tasks: DraftTask[],
  prefix?: string,
  meetingId?: string,
): Promise<BotReply> {
  if (tasks.length === 0)
    return { text: [prefix, t("bot.card.empty")].filter(Boolean).join("\n\n") };
  const payload: DraftPayload = { tasks, meetingId };
  const draft = await db.botDraft.create({
    data: { userId: user.id, chatId, payload: payload as unknown as Prisma.InputJsonValue },
  });
  const reply = await cardReply(draft.id, payload, false);
  return prefix ? { ...reply, text: `${prefix}\n\n${reply.text}` } : reply;
}

async function saveTasks(user: User, draftId: string, payload: DraftPayload): Promise<BotReply> {
  const { saved, pending, errors } = await createProposedTasks(
    user,
    payload.tasks,
    payload.meetingId,
  );
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
      // «Я»: a team task on oneself; «Я (личная)»: a personal one.
      if (arg === "me" || arg === "mine") {
        task.assigneeId = null;
        task.personal = arg === "mine";
      } else if (people.some((p) => p.id === arg)) {
        task.assigneeId = arg === user.id ? null : arg!;
        task.personal = false;
      } else return cardReply(draftId, payload, true);
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

// Minutes sent after /notes: save them, then propose tasks from them.
async function applyMeetingNotes(
  user: User,
  chatId: bigint,
  draftId: string,
  meetingId: string,
  text: string,
  deps: ConversationDeps,
  prefix?: string,
): Promise<BotReply> {
  await db.botDraft.delete({ where: { id: draftId } });
  let meeting;
  try {
    meeting = await saveNotes(user, meetingId, text);
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    return { text: t(`meetings.errors.${error.code}`) };
  }
  const saved = [prefix, t("meetings.bot.saved", { title: meeting.title })]
    .filter(Boolean)
    .join("\n\n");
  try {
    const tasks = await proposeActionItems(user, meetingId, deps.extractActionItems);
    if (tasks.length === 0) return { text: `${saved}\n${t("meetings.actions.none")}` };
    return startDraft(user, chatId, tasks, saved, meetingId);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { text: `${saved}\n${t(`ai.errors.${error.code}`)}` };
  }
}

// A plain text message answering "type the new title / date / the minutes".
async function applyAwaitingText(
  user: User,
  chatId: bigint,
  draftId: string,
  text: string,
  deps: ConversationDeps,
  prefix?: string,
): Promise<BotReply | null> {
  const now = deps.now;
  const draft = await loadDraft(user, draftId);
  if (!draft?.awaiting) return null;
  const awaiting = draft.awaiting as { kind: "title" | "due" | "notes"; index: number };
  if (awaiting.kind === "notes" && draft.payload.meetingId) {
    return applyMeetingNotes(user, chatId, draftId, draft.payload.meetingId, text, deps, prefix);
  }
  const { kind, index } = awaiting;
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
  const [{ waiting }, deletions] = await Promise.all([
    getTodayOverview(user, today),
    listDeleteRequests(user),
  ]);
  // One row per task: the decision, the way back (with a reason, asked next), cancel if allowed.
  const buttons = waiting.slice(0, 8).map((task) => {
    const label = (text: string) => `${text} · ${task.title}`.slice(0, 60);
    const canCancel = availableTransitions(user, task).includes("CANCELLED");
    const row =
      task.status === "PENDING_APPROVAL"
        ? [
            statusButton(
              label(
                task.assigneeId === user.id ? t("bot.actions.takeOn") : t("bot.actions.approve"),
              ),
              task.id,
              "A",
            ),
            statusButton(t("bot.actions.decline"), task.id, "D"),
          ]
        : [
            statusButton(label(t("bot.actions.accept")), task.id, "F"),
            statusButton(t("bot.actions.rework"), task.id, "W"),
          ];
    return canCancel ? [...row, statusButton("✖️", task.id, "C")] : row;
  });
  const deleteRows = deletions.slice(0, 5).map((task) => {
    const [yes, no] = deleteButtons(task.id);
    return [{ ...yes!, text: `${yes!.text} · ${task.title}`.slice(0, 60) }, no!];
  });
  const deleteBlock = deletions.length
    ? [
        t("bot.lists.deleteRequests"),
        ...deletions.slice(0, 5).map((task) => `• ${task.title}`),
      ].join("\n")
    : null;
  return {
    text: [listBlock(t("bot.lists.pending"), waiting, today), deleteBlock, footer]
      .filter(Boolean)
      .join("\n\n"),
    buttons: [...buttons, ...deleteRows],
  };
}

// ---------- status buttons and quick actions ----------

// A status change that needs a reason (declining, sending back) waits for the next text message.
const REASON_KEY = (userId: string) => `bot.reason:${userId}`;
const REASON_TTL_MS = 30 * 60_000;

async function setStatus(
  user: User,
  taskId: string,
  to: TaskStatus,
  reason: string | null = null,
): Promise<BotReply> {
  try {
    const task = await changeStatus(user, taskId, to, { reason });
    return {
      text: t("bot.actions.result", {
        status: t(`tasks.status.${to}`),
        title: task.title,
        name: displayName(user),
      }),
      edit: reason === null,
    };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    if (error.code === "reason") {
      const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const value = JSON.stringify({ taskId, to, at: Date.now() });
      await db.systemState.upsert({
        where: { key: REASON_KEY(user.id) },
        create: { key: REASON_KEY(user.id), value },
        update: { value },
      });
      return { text: t("bot.actions.askReason", { title: task.title }) };
    }
    if (error.code === "cancelledDependency") return { text: t("bot.actions.cancelledDependency") };
    return {
      text: error.code === "blocked" ? t("bot.actions.blocked") : t("bot.actions.noRights"),
    };
  }
}

async function handleStatusCallback(user: User, taskId: string, code: string): Promise<BotReply> {
  const to = STATUS_CODES[code as keyof typeof STATUS_CODES] as TaskStatus | undefined;
  if (!to) return { text: t("bot.actions.noRights") };
  return setStatus(user, taskId, to);
}

// The reason the bot asked for: the text completes the waiting status change (once, while fresh).
async function applyReason(user: User, text: string): Promise<BotReply | null> {
  const row = await db.systemState.findUnique({ where: { key: REASON_KEY(user.id) } });
  if (!row) return null;
  await db.systemState.delete({ where: { key: REASON_KEY(user.id) } });
  let waiting: { taskId: string; to: TaskStatus; at: number };
  try {
    waiting = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (Date.now() - waiting.at > REASON_TTL_MS) return null;
  return setStatus(user, waiting.taskId, waiting.to, text.trim().slice(0, 1000));
}

async function resolveDeletion(user: User, taskId: string, approve: boolean): Promise<BotReply> {
  try {
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    await resolveTaskDeletion(user, taskId, approve);
    return {
      text: t(approve ? "bot.actions.deleted" : "bot.actions.kept", { title: task.title }),
      edit: true,
    };
  } catch (error) {
    if (!(error instanceof TaskError) && !(error instanceof Prisma.PrismaClientKnownRequestError))
      throw error;
    return { text: t("bot.actions.noRights") };
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
  chatId: bigint = user.botChatId ?? user.telegramId,
): Promise<BotReply> {
  const parts = data.split(":");
  if (parts[0] === "d") return handleDraftCallback(user, parts, deps.now);
  if (parts[0] === "t" && parts[1]) return handleStatusCallback(user, parts[1], parts[2]);
  if (parts[0] === "r" && parts[1] && /^\d{8}$/.test(parts[2] ?? "")) {
    const d = parts[2];
    return reschedule(user, parts[1], `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  if (parts[0] === "k" && parts[1]) return complete(user, parts[1]);
  if (parts[0] === "x" && parts[1] && (parts[2] === "y" || parts[2] === "n"))
    return resolveDeletion(user, parts[1], parts[2] === "y");
  if (parts[0] === "m" && parts[1]) return waitForNotes(user, parts[1], chatId);
  if (parts[0] === "cs" && parts[1] && parts[2]) {
    try {
      return { ...(await handleSentButton(user, parts[1], parts[2])), edit: true };
    } catch (error) {
      if (!(error instanceof ContentError)) throw error;
      return {
        text: t(`content.errors.${error.code}`, { mb: MAX_FILE_MB, max: MAX_FILES_PER_LANG }),
      };
    }
  }
  return { text: t("bot.card.expired") };
}

export async function handleText(
  user: User,
  chatId: bigint,
  text: string,
  deps: ConversationDeps = defaultDeps,
  prefix?: string,
): Promise<BotReply> {
  const reason = await applyReason(user, text);
  if (reason) return reason;
  const awaiting = await findAwaitingDraft(user);
  if (awaiting) {
    const reply = await applyAwaitingText(user, chatId, awaiting.id, text, deps, prefix);
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
          personal: false,
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

// A hint for speech recognition: the team's names and common work words in both
// languages, so names come out right and Uzbek is written in Latin letters.
async function voicePrompt() {
  const people = await db.user.findMany({
    select: { firstName: true, lastName: true },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  const names = people.map((p) => [p.firstName, p.lastName].filter(Boolean).join(" ")).join(", ");
  return `Задачи: отчёт, срок, завтра, до пятницы. Vazifa: hisobot, ertaga, juma kuni. ${names}`.slice(
    0,
    600,
  );
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
    text = await stt.transcribe(audio, { prompt: await voicePrompt() });
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

// ---------- meeting minutes (/notes) ----------

export async function showMeetingsForNotes(user: User, now?: Date): Promise<BotReply> {
  const meetings = await recentMeetingsForNotes(user, now);
  if (meetings.length === 0) return { text: t("meetings.bot.none") };
  const { timezone } = await getSettings(user.id);
  return {
    text: t("meetings.bot.choose"),
    buttons: meetings.map((m) => [
      {
        text: `${formatDateTime(m.startsAt, timezone)} · ${m.title}`.slice(0, 60),
        data: `m:${m.id}`,
      },
    ]),
  };
}

async function waitForNotes(user: User, meetingId: string, chatId: bigint): Promise<BotReply> {
  const detail = await getMeetingDetail(user, meetingId);
  if (!detail) return { text: t("bot.actions.noRights") };
  // Only one pending "send me the minutes" at a time.
  await db.botDraft.deleteMany({
    where: { userId: user.id, awaiting: { path: ["kind"], equals: "notes" } },
  });
  await db.botDraft.create({
    data: {
      userId: user.id,
      chatId,
      payload: { tasks: [], meetingId } as unknown as Prisma.InputJsonValue,
      awaiting: { kind: "notes", index: 0 },
    },
  });
  return { text: t("meetings.bot.waiting", { title: detail.meeting.title }), edit: true };
}
