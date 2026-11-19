import { db } from "@/lib/db";
import { displayName } from "@/modules/core/users/display-name";

// «Расход ИИ» for the owner in money, not tokens: an estimate by the model's list price per
// million tokens (USD, Anthropic's first-party prices, October 2026). The exact sum is in the
// Anthropic invoice; a model not listed here is counted at the default model's price.
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-haiku-5-5", input: 0.1, output: 0.5 },
  { prefix: "claude-haiku-4-5", input: 1, output: 5 },
  { prefix: "claude-sonnet-5", input: 2, output: 10 },
  { prefix: "claude-sonnet-4-6", input: 3, output: 15 },
  { prefix: "claude-opus-5-5", input: 4, output: 20 },
  { prefix: "claude-opus", input: 5, output: 25 },
  { prefix: "claude-fable", input: 10, output: 50 },
];
const DEFAULT_PRICE = PRICES[1]!;

export function priceOf(model: string) {
  return PRICES.find((p) => model.startsWith(p.prefix)) ?? DEFAULT_PRICE;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const price = priceOf(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// The prompt functions the app has, in the order shown; others (added later) come after them.
export const AI_FUNCTIONS = [
  "extractTasks",
  "interpretCommand",
  "writeDigest",
  "extractActionItems",
  "suggestLayout",
  "tagContent",
  "help",
  "responsibilitiesSuggest",
] as const;
export type AiFunction = (typeof AI_FUNCTIONS)[number];
export const isKnownFunction = (fn: string): fn is AiFunction =>
  (AI_FUNCTIONS as readonly string[]).includes(fn);

type Row = { calls: number; inputTokens: number; outputTokens: number; cost: number };
const empty = (): Row => ({ calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });

// The month by function and by person, with the cost; `previous`: last month's total cost.
export async function monthlyAiCost(from: Date, to: Date, previousFrom: Date) {
  const [rows, before] = await Promise.all([
    db.aiUsage.groupBy({
      by: ["userId", "function", "model"],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.aiUsage.groupBy({
      by: ["model"],
      where: { createdAt: { gte: previousFrom, lt: from } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byFunction = new Map<string, Row>();
  const byUser = new Map<string, Row>();
  const total = empty();
  for (const r of rows) {
    const input = r._sum.inputTokens ?? 0;
    const output = r._sum.outputTokens ?? 0;
    const cost = costUsd(r.model, input, output);
    for (const [map, key] of [
      [byFunction, r.function],
      [byUser, r.userId],
    ] as const) {
      const entry = map.get(key) ?? empty();
      entry.calls += r._count._all;
      entry.inputTokens += input;
      entry.outputTokens += output;
      entry.cost += cost;
      map.set(key, entry);
    }
    total.calls += r._count._all;
    total.inputTokens += input;
    total.outputTokens += output;
    total.cost += cost;
  }
  const order = (fn: string) => (isKnownFunction(fn) ? AI_FUNCTIONS.indexOf(fn) : 99);
  return {
    functions: [...byFunction]
      .map(([fn, row]) => ({ fn, ...row }))
      .sort((a, b) => order(a.fn) - order(b.fn) || b.cost - a.cost),
    people: [...byUser]
      .map(([id, row]) => {
        const user = users.find((u) => u.id === id);
        return { name: user ? displayName(user) : "—", ...row };
      })
      .sort((a, b) => b.cost - a.cost),
    total,
    previousCost: before.reduce(
      (sum, r) => sum + costUsd(r.model, r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0),
      0,
    ),
  };
}
