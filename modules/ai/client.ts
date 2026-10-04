import Anthropic from "@anthropic-ai/sdk";

import { getEnv } from "@/lib/env";

let client: Anthropic | undefined;

export function isAiConfigured(): boolean {
  return Boolean(getEnv().ANTHROPIC_API_KEY);
}

export function getAnthropicClient(): Anthropic {
  client ??= new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}
