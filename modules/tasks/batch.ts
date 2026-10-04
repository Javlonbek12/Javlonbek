import { t, type TranslationKey } from "@/lib/i18n";
import type { TaskPriority } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import { isApprover } from "./access";
import { TaskError } from "./errors";
import { createTask } from "./service";

export type ProposedTask = {
  title: string;
  // null = the author themselves (a personal task).
  assigneeId: string | null;
  dueDate: string | null;
  priority: TaskPriority | null;
  project: string | null;
};

// Creates tasks confirmed in a card (bot or meeting page): own tasks are personal,
// others' are approved right away by OWNER/MANAGER or sent for approval by a MEMBER.
export async function createProposedTasks(actor: Actor, tasks: ProposedTask[], meetingId?: string) {
  let saved = 0;
  let pending = 0;
  const errors: string[] = [];
  for (const task of tasks) {
    const personal = task.assigneeId === null || task.assigneeId === actor.id;
    try {
      const created = await createTask(
        actor,
        {
          title: task.title,
          description: null,
          isPersonal: personal,
          assigneeId: personal ? null : task.assigneeId,
          startDate: null,
          dueDate: task.dueDate,
          priority: task.priority ?? "MEDIUM",
          project: task.project,
          planId: null,
          estimateHours: null,
          meetingId: meetingId ?? null,
        },
        personal ? "draft" : isApprover(actor.role) ? "approve" : "submit",
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
  return { saved, pending, errors };
}
