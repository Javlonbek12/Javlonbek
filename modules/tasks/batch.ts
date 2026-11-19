import { t, type TranslationKey } from "@/lib/i18n";
import type { TaskPriority } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import type { DraftStep } from "./draft-steps";
import { TaskError } from "./errors";
import { createTask } from "./service";
import { addInitialSteps } from "./steps";

export type ProposedTask = {
  title: string;
  // null = the author themselves.
  assigneeId: string | null;
  // One's own task as a personal one (only the author sees it); otherwise it is a team task on
  // oneself, which the manager sees (owner's choice, 2026-11-07).
  personal?: boolean;
  dueDate: string | null;
  priority: TaskPriority | null;
  project: string | null;
  // Written out by the AI (the bot's card): saved with the task, the steps into «Работа».
  description?: string | null;
  steps?: DraftStep[];
};

// Creates tasks confirmed in a card (bot or meeting page). Every task goes along its route (routing
// v2): right away inside the team, for approval to another team or upwards; one's own task is a
// team task on oneself unless asked for as a personal one.
export async function createProposedTasks(actor: Actor, tasks: ProposedTask[], meetingId?: string) {
  let saved = 0;
  let pending = 0;
  const errors: string[] = [];
  for (const task of tasks) {
    const self = task.assigneeId === null || task.assigneeId === actor.id;
    const personal = self && task.personal === true;
    try {
      const created = await createTask(
        actor,
        {
          title: task.title,
          description: task.description?.trim() || null,
          isPersonal: personal,
          assigneeId: personal ? null : self ? actor.id : task.assigneeId,
          startDate: null,
          dueDate: task.dueDate,
          priority: task.priority ?? "MEDIUM",
          project: task.project,
          planId: null,
          estimateHours: null,
          meetingId: meetingId ?? null,
        },
        // A personal task starts in work, as from the web form; so does one's own team task
        // that the route starts right away.
        personal ? "start" : "create",
        { startOwn: true },
      );
      if (task.steps?.length) await addInitialSteps(actor, created.id, task.steps);
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
  return { saved, pending, errors };
}
