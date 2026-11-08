import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { db } from "@/lib/db";
import { fromDateString } from "@/lib/dates";
import { getEnv } from "@/lib/env";

import { getAnthropicClient, isAiConfigured } from "./client";

export type AiErrorCode = "not_configured" | "limit" | "unavailable" | "invalid";

// A clear, user-facing failure; `code` maps to ai.errors.* in the i18n dictionary.
export class AiError extends Error {
  constructor(public readonly code: AiErrorCode) {
    super(code);
    this.name = "AiError";
  }
}

export type ModelCall = (request: {
  model: string;
  system: string;
  // A large block that is the same on every call (e.g. the user guide): sent after `system`
  // and cached, so repeated calls read it from the prompt cache.
  context?: string;
  prompt: string;
  schema: z.ZodType;
}) => Promise<{ output: unknown; inputTokens: number; outputTokens: number }>;

export function systemBlocks(system: string, context?: string) {
  if (!context) return system;
  return [
    { type: "text" as const, text: system },
    { type: "text" as const, text: context, cache_control: { type: "ephemeral" as const } },
  ];
}

// The real call: JSON output constrained by the zod schema (structured outputs).
const callClaude: ModelCall = async ({ model, system, context, prompt, schema }) => {
  const response = await getAnthropicClient().messages.parse({
    model,
    max_tokens: 4096,
    system: systemBlocks(system, context),
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(schema) },
  });
  const usage = response.usage;
  return {
    output: response.stop_reason === "refusal" ? null : response.parsed_output,
    // All prompt tokens, cached or not, so the monthly summary shows the real context size.
    inputTokens:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
};

// Calls since the start of the given day (YYYY-MM-DD in the user's timezone, approximated as UTC day).
export async function countAiCallsSince(userId: string, since: Date) {
  return db.aiUsage.count({ where: { userId, createdAt: { gte: since } } });
}

type RunOptions<T extends z.ZodType> = {
  userId: string;
  // Prompt function name for the usage log.
  fn: string;
  system: string;
  // See ModelCall: a stable, cached block after the system prompt.
  context?: string;
  prompt: string;
  schema: T;
  today: string;
  call?: ModelCall;
};

// Every Claude call goes through here: daily limit, JSON validation with one retry,
// and a row in ai_usage per attempt.
export async function runStructured<T extends z.ZodType>(
  options: RunOptions<T>,
): Promise<z.infer<T>> {
  const { userId, fn, system, context, prompt, schema, today } = options;
  const call = options.call ?? (isAiConfigured() ? callClaude : null);
  if (!call) throw new AiError("not_configured");

  const { AI_DAILY_LIMIT, CLAUDE_MODEL } = getEnv();
  if ((await countAiCallsSince(userId, fromDateString(today))) >= AI_DAILY_LIMIT) {
    throw new AiError("limit");
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: Awaited<ReturnType<ModelCall>>;
    try {
      result = await call({ model: CLAUDE_MODEL, system, context, prompt, schema });
    } catch (error) {
      if (error instanceof Anthropic.APIError || error instanceof Error) {
        console.error(`AI call ${fn} failed`, error.message);
      }
      if (attempt === 2) throw new AiError("unavailable");
      continue;
    }
    const parsed = schema.safeParse(result.output);
    await db.aiUsage.create({
      data: {
        userId,
        function: fn,
        model: CLAUDE_MODEL,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ok: parsed.success,
      },
    });
    if (parsed.success) return parsed.data;
  }
  throw new AiError("invalid");
}

// Monthly summary for the OWNER: tokens by user and by function.
export async function getMonthlyUsage(monthStart: Date, nextMonthStart: Date) {
  const rows = await db.aiUsage.groupBy({
    by: ["userId", "function"],
    where: { createdAt: { gte: monthStart, lt: nextMonthStart } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  return rows.map((row) => ({
    user: users.find((u) => u.id === row.userId)!,
    fn: row.function,
    calls: row._count._all,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
  }));
}
