import { z } from "zod";

import { db } from "@/lib/db";
import { isDateString, todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { PromptContext } from "@/modules/ai/context";
import { extractTasks, type ExtractedTask } from "@/modules/ai/prompts";
import { matchPerson } from "@/modules/bot/match";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

import type { ProposedTask } from "./batch";
import { cleanDraftSteps } from "./draft-steps";

// «Оформить с ИИ» on the new task form: the task in one's own words → the form's fields (title,
// assignee, due date, priority, project, description, steps), plus what the task still lacks.
// The person checks the form and creates the task as usual; nothing is saved here.

export const MAX_COMPOSE_TEXT = 2000;

// One task written out for the form: its fields (strings, like the form's own values; only what the
// text gave), the model's questions about what it lacks, and what the form could not fill itself
// (an unknown person or project).
export type ComposedTask = {
  values: Record<string, string>;
  missing: string[];
  notes: string[];
};

// Every task found in the text, in order (the form fills itself from one; several are listed with
// «Создать все»).
export type ComposeResult = { tasks: ComposedTask[] };

// At most this many tasks from one text on the form.
export const MAX_COMPOSED_TASKS = 10;

type Extract = (userId: string, text: string, ctx: PromptContext) => Promise<ExtractedTask[]>;

const defaultExtract: Extract = (userId, text, ctx) =>
  extractTasks(userId, text, ctx, undefined, "composeTask");

type Person = {
  id: string;
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
};

const lower = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");

export async function composeTask(
  actor: Actor & { firstName: string; lastName: string | null },
  text: string,
  options: {
    // Who the form may assign to (ids) and the projects it offers (names).
    assignableIds: string[];
    projects: string[];
    extract?: Extract;
    now?: Date;
  },
): Promise<ComposeResult | null> {
  const { timezone } = await getSettings(actor.id);
  const people = await db.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, firstName: true, lastName: true, telegramUsername: true },
    orderBy: { firstName: "asc" },
  });
  const ctx: PromptContext = {
    today: todayInTimezone(timezone, options.now ?? new Date()),
    timezone,
    speakerName: displayName(actor),
    teamNames: people.map((p) => displayName(p)),
    projects: options.projects,
  };
  const tasks = await (options.extract ?? defaultExtract)(actor.id, text, ctx);
  if (tasks.length === 0) return null;
  return {
    tasks: tasks
      .slice(0, MAX_COMPOSED_TASKS)
      .map((task) => toForm(task, actor.id, people, options)),
  };
}

function toForm(
  task: ExtractedTask,
  actorId: string,
  people: Person[],
  options: { assignableIds: string[]; projects: string[] },
): ComposedTask {
  const values: Record<string, string> = { title: task.title };
  const notes: string[] = [];
  if (!task.assigneeName) {
    if (task.personal) values.isPersonal = "on";
    else values.assigneeId = actorId;
  } else {
    const match = matchPerson(task.assigneeName, people);
    if (match.status === "matched" && options.assignableIds.includes(match.user.id)) {
      values.assigneeId = match.user.id;
    } else {
      const key =
        match.status === "ambiguous"
          ? "tasks.compose.personAmbiguous"
          : "tasks.compose.personUnknown";
      notes.push(t(key, { name: task.assigneeName }));
    }
  }
  if (task.dueDate) values.dueDate = task.dueDate;
  if (task.priority) values.priority = task.priority;
  if (task.project) {
    const known = options.projects.find((name) => lower(name) === lower(task.project!));
    if (known) values.project = known;
    else notes.push(t("tasks.compose.projectUnknown", { name: task.project }));
  }
  if (task.description) values.description = task.description;
  if (task.steps?.length) values.steps = JSON.stringify(task.steps);
  return { values, missing: task.missing ?? [], notes };
}

// The list the page sends with «Создать все»: checked, tidied and ready for createProposedTasks
// (which sends each task along its route). Null when it is not a list of tasks.
const listSchema = z
  .array(
    z.object({
      title: z.string(),
      assigneeId: z.string().max(100).nullable(),
      personal: z.boolean(),
      dueDate: z.string().nullable(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
      project: z.string().max(200).nullable(),
      description: z.string().max(5000).nullable(),
      steps: z.unknown(),
    }),
  )
  .min(1)
  .max(MAX_COMPOSED_TASKS);

export function parseTasksToCreate(input: unknown): ProposedTask[] | null {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return null;
  const tasks = parsed.data.map((task) => ({
    title: task.title.trim().replace(/\s+/g, " ").slice(0, 200),
    // A personal task is one's own; otherwise the chosen person (createProposedTasks treats one's
    // own id as oneself).
    assigneeId: task.personal ? null : task.assigneeId || null,
    personal: task.personal,
    dueDate: task.dueDate && isDateString(task.dueDate) ? task.dueDate : null,
    priority: task.priority,
    project: task.project?.trim() || null,
    description: task.description?.trim() || null,
    steps: cleanDraftSteps(task.steps ?? []),
  }));
  if (tasks.some((task) => !task.title || (!task.personal && !task.assigneeId))) return null;
  return tasks;
}
