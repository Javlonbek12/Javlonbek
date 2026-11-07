import { z } from "zod";

import { isDateString } from "@/lib/dates";

import { contextBlock, type PromptContext } from "./context";
import { runStructured, type ModelCall } from "./run";
import { currentLocale } from "@/lib/i18n";

// ---------- extractTasks ----------

const extractedTaskSchema = z.object({
  title: z.string(),
  assigneeName: z.string().nullable(),
  dueDate: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable(),
  project: z.string().nullable(),
  // The speaker asks for a personal task (only they see it); otherwise their own tasks are team
  // tasks their manager sees.
  personal: z.boolean(),
});

export const extractTasksSchema = z.object({ tasks: z.array(extractedTaskSchema) });

export type ExtractedTask = z.infer<typeof extractedTaskSchema>;

// Never trust a malformed date or empty title from the model.
function cleanTasks(tasks: ExtractedTask[]): ExtractedTask[] {
  return tasks
    .map((task) => ({
      ...task,
      title: task.title.trim().slice(0, 200),
      dueDate: task.dueDate && isDateString(task.dueDate) ? task.dueDate : null,
      assigneeName: task.assigneeName?.trim() || null,
      project: task.project?.trim().slice(0, 60) || null,
    }))
    .filter((task) => task.title.length > 0);
}

export const EXTRACT_TASKS_SYSTEM = `You turn a manager's message into a list of tasks for a task tracker.
The message may be in Russian, Uzbek (Latin or Cyrillic) or a mix of both, and may come from speech recognition, so expect missing punctuation and small recognition errors.

For each separate task return:
- title: a short imperative task title (3-10 words) in the language of the message. Remove the assignee name and date words from the title. Fix obvious speech-recognition errors.
- assigneeName: the person who must do the task, in the nominative case, as close as possible to a name from "Team members" (e.g. "Азизу" -> "Азиз", "Dilnozaga" -> "Dilnoza"). Use null when the speaker means themselves ("мне", "я", "себе", "напомни", "o'zim", "menga") or no person is named.
- dueDate: YYYY-MM-DD resolved with the calendar below, or null if no deadline is mentioned.
  "сегодня"/"bugun" = today; "завтра"/"ertaga" = tomorrow; "послезавтра"/"indinga" = today+2;
  a weekday ("в пятницу", "jumaga", "до четверга") = the nearest such day from today onwards (today counts);
  "на следующей неделе в X" = that weekday of next week; "через неделю"/"bir haftadan keyin" = the "In one week" date;
  "до конца недели"/"hafta oxirigacha" = end of this week; "до конца месяца"/"oy oxirigacha" = end of this month;
  an explicit date like "5 октября" or "15.10" = that date this year (next year if it already passed).
- priority: URGENT for "срочно", "очень срочно", "shoshilinch", "tezda"; HIGH for "важно", "muhim", "в приоритете"; LOW for "не срочно", "когда будет время"; otherwise null.
- project: a project from "Known projects" if the message clearly refers to it, otherwise a short brand or campaign name if one is explicitly named as the project (e.g. "по проекту ESSE Change"), otherwise null.
- personal: true only when the speaker explicitly calls their own task personal or private ("личная задача", "лично", "личное", "shaxsiy", "shaxsiy vazifa", "personal"); remove that word from the title. Otherwise false. Always false for a task given to someone else.

One sentence can contain several tasks ("Азизу подготовить отчёт, а Дильнозе созвониться с дистрибьютором") - split them. A task given to several people is one task per person. Do not invent tasks that are not in the message. If the message contains no task at all, return an empty list.`;

export async function extractTasks(
  userId: string,
  text: string,
  ctx: PromptContext,
  call?: ModelCall,
): Promise<ExtractedTask[]> {
  const result = await runStructured({
    userId,
    fn: "extractTasks",
    system: EXTRACT_TASKS_SYSTEM,
    prompt: `${contextBlock(ctx)}\n\nMessage:\n"""\n${text}\n"""`,
    schema: extractTasksSchema,
    today: ctx.today,
    call,
  });
  return cleanTasks(result.tasks);
}

// ---------- interpretCommand ----------

export const COMMAND_INTENTS = [
  "create_tasks",
  "show_today",
  "show_week",
  "show_overdue",
  "show_pending",
  "reschedule",
  "complete",
  "help",
] as const;

export const interpretCommandSchema = z.object({
  intent: z.enum(COMMAND_INTENTS),
  taskQuery: z.string().nullable(),
  newDueDate: z.string().nullable(),
});

export type InterpretedCommand = z.infer<typeof interpretCommandSchema>;

export const INTERPRET_COMMAND_SYSTEM = `You classify one message sent to a task-tracker Telegram bot. The message may be in Russian, Uzbek (Latin or Cyrillic) or a mix.

Choose intent:
- create_tasks: the user dictates new tasks or reminders for themselves or others ("Азизу подготовить отчёт до пятницы", "напомни позвонить в банк", "ertaga Sardorga hisobot").
- show_today: asks what they have today ("что у меня сегодня", "bugun nima ishlarim bor").
- show_week: asks about this week ("что на неделе", "план на неделю").
- show_overdue: asks about overdue tasks ("что просрочено", "muddati o'tgan").
- show_pending: asks what waits for their approval or review ("что ждёт моего утверждения", "что согласовать").
- reschedule: asks to move an existing task to another date ("перенеси отчёт на четверг"). Fill taskQuery with words identifying the task and newDueDate as YYYY-MM-DD using the calendar.
- complete: says an existing task is done or asks to close it ("закрой задачу отчёт", "отчёт готов", "hisobot tayyor"). Fill taskQuery.
- help: greetings, questions about the bot, or anything else.

taskQuery and newDueDate are null unless the intent needs them.`;

export async function interpretCommand(
  userId: string,
  text: string,
  ctx: PromptContext,
  call?: ModelCall,
): Promise<InterpretedCommand> {
  const result = await runStructured({
    userId,
    fn: "interpretCommand",
    system: INTERPRET_COMMAND_SYSTEM,
    prompt: `${contextBlock(ctx)}\n\nMessage:\n"""\n${text}\n"""`,
    schema: interpretCommandSchema,
    today: ctx.today,
    call,
  });
  return {
    ...result,
    newDueDate: result.newDueDate && isDateString(result.newDueDate) ? result.newDueDate : null,
    taskQuery: result.taskQuery?.trim() || null,
  };
}

// ---------- writeDigest ----------

export const digestSchema = z.object({ text: z.string() });

// The digest is written in the reader's language (the current one, see lib/i18n).
export const writeDigestSystem = (language: string) =>
  `You write a short morning digest for a busy trade-marketing manager, in ${language}, for a Telegram message.
You get JSON with the person's tasks: dueToday, overdue, waitingForDecision (tasks they must approve or accept), dueTomorrow.
Write at most 8 short lines: start with what is overdue (most urgent first), then today's tasks, then what waits for their decision, then a one-line heads-up about tomorrow if anything is due.
Mention task titles exactly as given, with assignee names where present. Plain text with a few emojis, no Markdown, no greeting (it is added separately), no invented facts.`;

export type DigestData = {
  dueToday: { title: string; assignee?: string }[];
  overdue: { title: string; dueDate: string; assignee?: string }[];
  waitingForDecision: { title: string; status: string }[];
  dueTomorrow: { title: string }[];
};

export async function writeDigest(
  userId: string,
  today: string,
  data: DigestData,
  call?: ModelCall,
) {
  const result = await runStructured({
    userId,
    fn: "writeDigest",
    system: writeDigestSystem(currentLocale() === "en" ? "English" : "Russian"),
    prompt: `Today: ${today}\n\n${JSON.stringify(data)}`,
    schema: digestSchema,
    today,
    call,
  });
  return result.text.trim().slice(0, 3000);
}

// ---------- extractActionItems ----------

export const EXTRACT_ACTION_ITEMS_SYSTEM = `You read the minutes (notes) of a team meeting and list the action items: concrete things a person agreed to do.
The notes may be in Russian, Uzbek (Latin or Cyrillic) or a mix, and may come from speech recognition.

Ignore discussion, opinions and decisions that need no action. For each action item return the same fields as a task:
- title: a short imperative task title (3-10 words) in the language of the notes.
- assigneeName: the responsible person in the nominative case, matched to "Team members" when possible; null if the note author takes it ("я", "беру на себя", "o'zim") or nobody is named.
- dueDate: YYYY-MM-DD resolved with the calendar below; relative dates count from the meeting date given as "Today"; null if no deadline.
- priority and project: as in the notes, otherwise null.
- personal: always false.

Return an empty list if there are no action items. Do not invent items.`;

export async function extractActionItems(
  userId: string,
  notes: string,
  ctx: PromptContext,
  call?: ModelCall,
): Promise<ExtractedTask[]> {
  const result = await runStructured({
    userId,
    fn: "extractActionItems",
    system: EXTRACT_ACTION_ITEMS_SYSTEM,
    prompt: `${contextBlock(ctx)}\n\nMeeting minutes:\n"""\n${notes}\n"""`,
    schema: extractTasksSchema,
    today: ctx.today,
    call,
  });
  return cleanTasks(result.tasks);
}
