import { z } from "zod";

import { isDateString } from "@/lib/dates";

import { contextBlock, type PromptContext } from "./context";
import { runStructured, type ModelCall } from "./run";
import { currentLocale } from "@/lib/i18n";

// ---------- extractTasks ----------

const extractedStepSchema = z.object({ title: z.string(), dueDate: z.string().nullable() });

const extractedTaskSchema = z.object({
  title: z.string(),
  assigneeName: z.string().nullable(),
  dueDate: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable(),
  project: z.string().nullable(),
  // The speaker asks for a personal task (only they see it); otherwise their own tasks are team
  // tasks their manager sees.
  personal: z.boolean(),
  // The task written out properly («Оформить с ИИ»): what / why / done when / materials, only
  // from what the message says; steps when the work has stages; questions about what is missing.
  description: z.string().nullable(),
  steps: z.array(extractedStepSchema),
  missing: z.array(z.string()),
});

export const extractTasksSchema = z.object({ tasks: z.array(extractedTaskSchema) });

export type ExtractedStep = z.infer<typeof extractedStepSchema>;

type FullTask = z.infer<typeof extractedTaskSchema>;
// The written-out parts are optional for callers (tests, older drafts): none means none.
export type ExtractedTask = Omit<FullTask, "description" | "steps" | "missing"> &
  Partial<Pick<FullTask, "description" | "steps" | "missing">>;

export const MAX_DESCRIPTION = 1500;
export const MAX_COMPOSED_STEPS = 6;
export const MAX_MISSING = 4;

// Never trust a malformed date or empty title from the model. A step's date must be a real date
// no later than the task's own due date (else it has none).
export function cleanTasks(tasks: ExtractedTask[]): ExtractedTask[] {
  return tasks
    .map((task) => {
      const dueDate = task.dueDate && isDateString(task.dueDate) ? task.dueDate : null;
      return {
        ...task,
        title: task.title.trim().slice(0, 200),
        dueDate,
        assigneeName: task.assigneeName?.trim() || null,
        project: task.project?.trim().slice(0, 60) || null,
        description: task.description?.trim().slice(0, MAX_DESCRIPTION) || null,
        steps: (task.steps ?? [])
          .map((step) => {
            const date = step.dueDate && isDateString(step.dueDate) ? step.dueDate : null;
            return {
              title: step.title.trim().replace(/\s+/g, " ").slice(0, 200),
              dueDate: date && (!dueDate || date <= dueDate) ? date : null,
            };
          })
          .filter((step) => step.title.length > 0)
          .slice(0, MAX_COMPOSED_STEPS),
        missing: (task.missing ?? [])
          .map((question) => question.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, MAX_MISSING),
      };
    })
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

- description: the task written out for the person who will do it, in the language of the message, as up to four lines, each starting with its label:
  "Что сделать: ..." - what exactly, with the numbers, places, brands and items from the message (skip this line if it would only repeat the title);
  "Зачем: ..." - the reason or the event it is tied to, only if the message gives one;
  "Готово, когда: ..." - the checkable result, only if the message says how to tell the work is done;
  "Материалы: ..." - files, lists or samples to use, only if the message names them.
  Write only facts from the message, never guesses; leave a line out when the message says nothing about it. null when no line is left.
  For an Uzbek message use the same labels in Uzbek: "Nima qilish kerak:", "Nima uchun:", "Tayyor, qachonki:", "Materiallar:".
- steps: when the work clearly has several stages (prepare, hand over, check...), 2-6 short imperative steps in order, each with dueDate (YYYY-MM-DD, not later than the task's dueDate) or null; you may break the work into the obvious stages it needs, but add nothing the task does not need. An empty list for a simple one-action task.
- missing: up to 4 short questions, in the language of the message, about what the task still lacks to be clear: no deadline, no assignee, no quantity or list, no way to tell it is done (then suggest one, e.g. "Как понять, что готово? Например: отгрузки записаны и есть фото накладных"). Ask only about what really matters for this task; an empty list when everything is clear.

Russian typed in Latin letters (translit, e.g. "otpravit posm do pyatnicy") is Russian: write the title, description, steps and questions in proper Russian Cyrillic.

One sentence can contain several tasks ("Азизу подготовить отчёт, а Дильнозе созвониться с дистрибьютором") - split them. A task given to several people is one task per person. Do not invent tasks that are not in the message. If the message contains no task at all, return an empty list.`;

export async function extractTasks(
  userId: string,
  text: string,
  ctx: PromptContext,
  call?: ModelCall,
  // The usage log name: the bot's messages, or the task form's «Оформить с ИИ» (composeTask).
  fn: "extractTasks" | "composeTask" = "extractTasks",
): Promise<ExtractedTask[]> {
  const result = await runStructured({
    userId,
    fn,
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
You get JSON with the person's tasks: dueToday, overdue, overdueAtDoers (tasks they gave others or decide on that the assignee let slip), waitingForDecision (what they must approve, accept or decide), dueTomorrow, and runningTimer (a timer of theirs left running since an earlier day, or null).
Write at most 10 short lines: start with what is overdue (most urgent first), then what is overdue at the assignees (with the assignee's name), then today's tasks, then what waits for their decision, then a one-line heads-up about tomorrow if anything is due, and last, if runningTimer is set, a reminder to stop that timer if the work is done.
Mention task titles exactly as given, with assignee names where present. Plain text with a few emojis, no Markdown, no greeting (it is added separately), no invented facts.`;

export type DigestData = {
  dueToday: { title: string; assignee?: string }[];
  overdue: { title: string; dueDate: string; assignee?: string }[];
  // Others' overdue work the person answers for (as the author, decider or reviewer).
  overdueAtDoers: { title: string; dueDate: string; assignee: string }[];
  waitingForDecision: { title: string; status: string }[];
  dueTomorrow: { title: string }[];
  // The person's timer left running since an earlier day (forgotten?).
  runningTimer: { title: string; since: string } | null;
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
