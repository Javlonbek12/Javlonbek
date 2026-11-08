"use server";

import { z } from "zod";

import type { TranslationKey } from "@/lib/i18n";
import { answerHelpQuestion, type HelpAnswer } from "@/modules/ai/help";
import { HISTORY_TURNS, MAX_QUESTION } from "@/modules/ai/help-shared";
import { AiError } from "@/modules/ai/run";
import { requireUser } from "@/modules/core/auth/current-user";

const inputSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(5000) }))
    .max(50)
    .transform((turns) => turns.slice(-HISTORY_TURNS)),
  path: z.string().max(500),
});

export type HelpResult = ({ ok: true } & HelpAnswer) | { ok: false; error: TranslationKey };

// The help panel's question: an answer from the user guide for this person and page.
export async function askHelpAction(input: unknown): Promise<HelpResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.generic" };
  try {
    return { ok: true, ...(await answerHelpQuestion(user, parsed.data, { locale: user.locale })) };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: `ai.errors.${error.code}` };
    throw error;
  }
}
