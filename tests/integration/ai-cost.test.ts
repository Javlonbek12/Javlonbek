import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { costUsd, monthlyAiCost } from "@/modules/ops/ai-cost";
import { createTestUser, resetDb } from "@/tests/helpers/db";

describe("AI usage in money", () => {
  beforeEach(resetDb);

  it("prices tokens by the model; an unknown model counts at the default's price", () => {
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6);
    expect(costUsd("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(costUsd("claude-sonnet-4-6", 0, 1_000_000)).toBe(15);
    expect(costUsd("something-else", 1_000_000, 0)).toBe(1);
  });

  it("sums the month by function and person, and gives last month's total", async () => {
    const user = await createTestUser("OWNER", { firstName: "Тест" });
    const row = (fn: string, at: string, input: number, output: number) => ({
      userId: user.id,
      function: fn,
      model: "claude-haiku-4-5",
      inputTokens: input,
      outputTokens: output,
      createdAt: new Date(at),
    });
    await db.aiUsage.createMany({
      data: [
        row("extractTasks", "2026-11-02T10:00:00Z", 500_000, 100_000),
        row("extractTasks", "2026-11-03T10:00:00Z", 500_000, 100_000),
        row("writeDigest", "2026-11-03T11:00:00Z", 0, 200_000),
        row("extractTasks", "2026-10-20T10:00:00Z", 1_000_000, 0),
      ],
    });
    const usage = await monthlyAiCost(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-01T00:00:00Z"),
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(usage.functions.map((f) => [f.fn, f.calls, f.cost])).toEqual([
      ["extractTasks", 2, 2],
      ["writeDigest", 1, 1],
    ]);
    expect(usage.people).toEqual([expect.objectContaining({ calls: 3, cost: 3 })]);
    expect(usage.total).toMatchObject({ calls: 3, cost: 3 });
    expect(usage.previousCost).toBe(1);
  });
});
