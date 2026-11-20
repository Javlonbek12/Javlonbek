import { z } from "zod";

import { isDateString } from "@/lib/dates";

// Steps written together with a new task (the form's «Оформить с ИИ», the bot's card), before the
// task exists: kept as JSON in a hidden form field and added once the task is created.
export type DraftStep = { title: string; dueDate: string | null };

export const MAX_DRAFT_STEPS = 10;

const schema = z
  .array(z.object({ title: z.string(), dueDate: z.string().nullable().optional() }))
  .max(50);

export function parseDraftSteps(raw: string | null | undefined): DraftStep[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return cleanDraftSteps(data);
}

// Steps from any source (the hidden field, a list sent by the page): titles tidied, wrong dates
// dropped, at most MAX_DRAFT_STEPS; anything of the wrong shape gives none.
export function cleanDraftSteps(data: unknown): DraftStep[] {
  const parsed = schema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data
    .map((step) => ({
      title: step.title.trim().replace(/\s+/g, " ").slice(0, 200),
      dueDate: step.dueDate && isDateString(step.dueDate) ? step.dueDate : null,
    }))
    .filter((step) => step.title.length > 0)
    .slice(0, MAX_DRAFT_STEPS);
}
