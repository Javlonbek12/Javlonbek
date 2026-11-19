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
import { Prisma, type User } from "@/lib/generated/prisma/client";
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
import { shortRouteHints } from "@/modules/tasks/route-hints";
import { completeTask, findTasksByQuery, setDueDate } from "@/modules/tasks/quick-actions";
import { getTodayOverview, listProjects, listTasks, type TaskView } from "@/modules/tasks/service";
import type { AudioInput, SpeechToText } from "@/modules/stt";

import { applyReason, handleDecisionCallback, showPending } from "./decisions";
import { listHeader, moreLine, taskLine } from "./format";
import { whyNotComplete, whyNotReschedule } from "./why";

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
  appendNotes,
  getMeetingDetail,
  recentMeetingsForNotes,
} from "@/modules/meetings/service";
import { escapeHtml, type TelegramButton } from "./keyboard";

// What the bot should answer. `edit` = replace the message the button belongs to.
export type BotReply = {
  text: string;
  buttons?: TelegramButton[][];
  edit?: boolean;
  // Set when the reply is a confirmation card, so its message id can be remembered.
  draftId?: string;
  // The reply asks for a reason: its message id is remembered, a reply to it is the reason.
  reasonPrompt?: boolean;
  // The text is Telegram HTML (bold headers; everything else escaped).
  html?: boolean;
  // A page of the app: an «Открыть в приложении» button under the reply (a link in the text
  // where Telegram can't take a link button).
  open?: string;
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

// People the bot matches names against: active ones only (deactivated people get no new work).
async function team() {
  return db.user.findMany({
    where: { deactivatedAt: null },
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
  lines.push(...errors);
  return { text: lines.join("\n"), edit: true, open: "/tasks" };
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
        buttons: editMenuButtons(draftId, index, Boolean(task.description || task.steps?.length)),
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
      // arg: the page of people (everyone, ten at a time).
      return {
        text: t("bot.card.chooseAssignee", { title: task.title }),
        buttons: assigneeButtons(draftId, index, task, people, true, Number(arg) || 0),
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
    case "pl":
      // «Без описания и шагов»: the task as a bare title (the questions go too).
      task.description = null;
      task.steps = [];
      task.missing = [];
      await saveDraft(draftId, payload);
      return cardReply(draftId, payload, true);
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

// Minutes sent after /notes: add them below the meeting's minutes, then propose tasks from what
// was just sent (tasks from the earlier minutes were proposed back then).
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
    meeting = await appendNotes(user, meetingId, text, deps.now);
  } catch (error) {
    if (!(error instanceof MeetingError)) throw error;
    return { text: t(`meetings.errors.${error.code}`) };
  }
  const saved = [prefix, t("meetings.bot.saved", { title: meeting.title })]
    .filter(Boolean)
    .join("\n\n");
  try {
    const tasks = await proposeActionItems(user, meetingId, deps.extractActionItems, text);
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

export const LIST_KINDS = ["today", "week", "overdue", "pending"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
// Lines per block, and how many of the numbered tasks get a «✅ n» button.
const LIST_LIMIT = 15;
const BUTTON_LIMIT = 8;

// One block of a list: a bold header with the count, numbered lines from `start`.
function listBlock(title: string, tasks: TaskView[], today: string, start: number, fire = true) {
  const lines = [listHeader(title, tasks.length)];
  if (tasks.length === 0) lines.push(escapeHtml(t("bot.lists.empty")));
  lines.push(
    ...tasks.slice(0, LIST_LIMIT).map((task, i) => taskLine(task, today, start + i, { fire })),
  );
  if (tasks.length > LIST_LIMIT) lines.push(moreLine(tasks.length - LIST_LIMIT));
  return lines.join("\n");
}

async function listTasksOf(user: User, kind: Exclude<ListKind, "pending">, today: string) {
  if (kind === "today") {
    const { dueToday, overdue } = await getTodayOverview(user, today);
    return { blocks: [dueToday, overdue], all: [...dueToday, ...overdue] };
  }
  const tasks = await listTasks(user, parseTaskFilters({ scope: "mine", due: kind }), today);
  return { blocks: [tasks], all: tasks };
}

// /today, /week, /overdue: numbered tasks, «✅ 1 … ✅ 8» closes a task in one tap (the list comes
// back with the result on top), «📅 Перенести срок» asks which task and to when.
export async function showList(
  user: User,
  kind: ListKind,
  now?: Date,
  notice?: string,
): Promise<BotReply> {
  const { today } = await userToday(user, now);
  if (kind === "pending") return showPending(user, today, { notice });
  const { blocks, all } = await listTasksOf(user, kind, today);
  const titles =
    kind === "today"
      ? [t("bot.lists.today"), t("bot.lists.overdue")]
      : [t(kind === "week" ? "bot.lists.week" : "bot.lists.overdue")];
  let start = 1;
  const text = blocks.map((tasks, i) => {
    // In «🔥 Просрочено» every task is late: no 🔥 on each line.
    const lateBlock = kind === "overdue" || (kind === "today" && i === 1);
    const block = listBlock(titles[i]!, tasks, today, start, !lateBlock);
    start += Math.min(tasks.length, LIST_LIMIT);
    return block;
  });
  // The numbers run on through the blocks, as far as lines are shown.
  const numbered = blocks.flatMap((tasks) => tasks.slice(0, LIST_LIMIT));
  const buttons: TelegramButton[][] = [];
  const done = numbered.slice(0, BUTTON_LIMIT).map((task, i) => ({
    text: `✅ ${i + 1}`,
    data: `k:${task.id}:${kind}`,
  }));
  for (let i = 0; i < done.length; i += 4) buttons.push(done.slice(i, i + 4));
  if (all.length) buttons.push([{ text: t("bot.lists.reschedule"), data: `rs:${kind}` }]);
  return {
    text: [notice ? escapeHtml(notice) : null, ...text].filter(Boolean).join("\n\n"),
    buttons,
    html: true,
    open: kind === "today" ? "/" : "/tasks",
  };
}

// «📅 Перенести срок»: which task (by its number in the list)…
async function chooseToReschedule(user: User, kind: ListKind, now?: Date): Promise<BotReply> {
  if (kind === "pending") return { text: t("bot.card.expired") };
  const { today } = await userToday(user, now);
  const { blocks } = await listTasksOf(user, kind, today);
  const numbered = blocks.flatMap((tasks) => tasks.slice(0, LIST_LIMIT)).slice(0, BUTTON_LIMIT);
  if (numbered.length === 0) return { text: t("bot.lists.empty") };
  return {
    text: t("bot.lists.rescheduleWhich"),
    buttons: numbered.map((task, i) => [
      { text: `📅 ${i + 1}. ${task.title}`.slice(0, 60), data: `rd:${task.id}` },
    ]),
  };
}

// …and to when: the usual choices; any other date can be written («перенеси … на 15.10»).
async function chooseDate(user: User, taskId: string, now?: Date): Promise<BotReply> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true } });
  if (!task) return { text: t("bot.why.unavailable"), edit: true };
  const { today } = await userToday(user, now);
  const options = [
    ["bot.edit.tomorrow", addDays(today, 1)],
    ["bot.edit.week", addDays(today, 7)],
    ["bot.edit.monthEnd", addDays(addMonths(startOfMonth(today), 1), -1)],
  ] as const;
  return {
    text: t("bot.lists.rescheduleWhen", { title: task.title }),
    buttons: [
      options.map(([label, date]) => ({
        text: `${t(label)} · ${formatDay(date)}`,
        data: `r:${taskId}:${date.replaceAll("-", "")}`,
      })),
    ],
    edit: true,
  };
}

// The short answer to anything the bot can't take (a sticker, a photo, an unknown command): the
// main lists as buttons, the full help one tap away.
export function unknownReply(): BotReply {
  return {
    text: t("bot.unknown"),
    buttons: [
      [
        { text: t("bot.menu.today"), data: "l:today" },
        { text: t("bot.menu.pending"), data: "l:pending" },
      ],
      [{ text: t("bot.menu.help"), data: "h" }],
    ],
  };
}

// ---------- quick actions («перенеси …», «закрой …») ----------

async function reschedule(user: User, taskId: string, date: string): Promise<BotReply> {
  try {
    const task = await setDueDate(user, taskId, date);
    return { text: t("bot.actions.rescheduled", { title: task.title, date: formatDay(date) }) };
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    return { text: await whyNotReschedule(user, taskId, error.code) };
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
    return { text: await whyNotComplete(user, taskId, error.code) };
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
  const decision = await handleDecisionCallback(user, parts, deps.now);
  if (decision) return decision;
  if (parts[0] === "r" && parts[1] && /^\d{8}$/.test(parts[2] ?? "")) {
    const d = parts[2];
    return reschedule(user, parts[1], `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  }
  const kind = LIST_KINDS.find((k) => k === parts[2] || k === parts[1]);
  if (parts[0] === "k" && parts[1]) {
    const result = await complete(user, parts[1]);
    // «✅ n» under a list: the list again, with the result on top.
    return kind && parts[2]
      ? { ...(await showList(user, kind, deps.now, result.text)), edit: true }
      : result;
  }
  if (parts[0] === "rs" && kind) return chooseToReschedule(user, kind, deps.now);
  if (parts[0] === "rd" && parts[1]) return chooseDate(user, parts[1], deps.now);
  if (parts[0] === "l" && kind) return showList(user, kind, deps.now);
  if (parts[0] === "h") return { text: t("bot.help") };
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
  // The message the text replies to (Telegram's «reply»), if any.
  replyTo?: number | null,
): Promise<BotReply> {
  const reason = await applyReason(user, text, replyTo);
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
    where: { deactivatedAt: null },
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
