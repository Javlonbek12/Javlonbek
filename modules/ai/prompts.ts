import { z } from "zod";

import { isDateString } from "@/lib/dates";

import { contextBlock, type PromptContext } from "./context";
import { runStructured, type ModelCall } from "./run";

// ---------- extractTasks ----------

const extractedTaskSchema = z.object({
  title: z.string(),
  assigneeName: z.string().nullable(),
  dueDate: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable(),
  project: z.string().nullable(),
});

export const extractTasksSchema = z.object({ tasks: z.array(extractedTaskSchema) });

export type ExtractedTask = z.infer<typeof extractedTaskSchema>;

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
  // Never trust a malformed date from the model.
  return result.tasks
    .map((task) => ({
      ...task,
      title: task.title.trim().slice(0, 200),
      dueDate: task.dueDate && isDateString(task.dueDate) ? task.dueDate : null,
      assigneeName: task.assigneeName?.trim() || null,
      project: task.project?.trim().slice(0, 60) || null,
    }))
    .filter((task) => task.title.length > 0);
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
