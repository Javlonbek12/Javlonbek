import { db } from "@/lib/db";
import { todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { PromptContext } from "@/modules/ai/context";
import { extractTasks, type ExtractedTask } from "@/modules/ai/prompts";
import { matchPerson } from "@/modules/bot/match";
import type { Actor } from "@/modules/core/permissions";
import { getSettings } from "@/modules/core/settings/service";
import { displayName } from "@/modules/core/users/display-name";

// «Оформить с ИИ» on the new task form: the task in one's own words → the form's fields (title,
// assignee, due date, priority, project, description, steps), plus what the task still lacks.
// The person checks the form and creates the task as usual; nothing is saved here.

export const MAX_COMPOSE_TEXT = 2000;

export type ComposeResult = {
  // Form fields to fill, as strings like the form's own values; only what the text gave.
  values: Record<string, string>;
  // The model's questions: what the task still lacks to be clear.
  missing: string[];
  // What the form could not fill by itself (an unknown person or project, several tasks).
  notes: string[];
};

type Extract = (userId: string, text: string, ctx: PromptContext) => Promise<ExtractedTask[]>;

const defaultExtract: Extract = (userId, text, ctx) =>
  extractTasks(userId, text, ctx, undefined, "composeTask");

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
  const task = tasks[0];
  if (!task) return null;

  const values: Record<string, string> = { title: task.title };
  const notes: string[] = [];
  if (tasks.length > 1) notes.push(t("tasks.compose.several", { count: tasks.length }));

  if (!task.assigneeName) {
    if (task.personal) values.isPersonal = "on";
    else values.assigneeId = actor.id;
  } else {
    const match = matchPerson(task.assigneeName, people);
    if (match.status === "matched" && options.assignableIds.includes(match.user.id)) {
      values.assigneeId = match.user.id;
    } else {
      notes.push(
        t(
          match.status === "ambiguous"
            ? "tasks.compose.personAmbiguous"
            : "tasks.compose.personUnknown",
          {
            name: task.assigneeName,
          },
        ),
      );
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
