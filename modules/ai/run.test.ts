import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { db } from "@/lib/db";
import { createTestUser, resetDb } from "@/tests/helpers/db";

import { extractTasks } from "./prompts";
import { AiError, limitDayStart, runStructured, systemBlocks, type ModelCall } from "./run";

const schema = z.object({ answer: z.string() });
const ctx = {
  today: "2026-10-01",
  timezone: "Asia/Tashkent",
  speakerName: "Т",
  teamNames: [],
  projects: [],
};

describe("runStructured", () => {
  beforeEach(resetDb);

  it("returns validated output and logs token usage", async () => {
    const user = await createTestUser("OWNER");
    const call: ModelCall = async () => ({
      output: { answer: "да" },
      inputTokens: 120,
      outputTokens: 8,
    });
    const result = await runStructured({
      userId: user.id,
      fn: "test",
      system: "s",
      prompt: "p",
      schema,
      today: "2026-10-01",
      call,
    });
    expect(result).toEqual({ answer: "да" });
    expect(await db.aiUsage.findFirst()).toMatchObject({
      function: "test",
      inputTokens: 120,
      outputTokens: 8,
      ok: true,
    });
  });

  it("retries once when the answer does not match the schema", async () => {
    const user = await createTestUser("OWNER");
    const call = vi
      .fn<ModelCall>()
      .mockResolvedValueOnce({ output: { wrong: 1 }, inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ output: { answer: "ok" }, inputTokens: 1, outputTokens: 1 });
    await expect(
      runStructured({
        userId: user.id,
        fn: "t",
        system: "",
        prompt: "",
        schema,
        today: "2026-10-01",
        call,
      }),
    ).resolves.toEqual({ answer: "ok" });
    expect(call).toHaveBeenCalledTimes(2);
    expect(await db.aiUsage.count()).toBe(2);
  });

  it("gives a clear error after the second bad answer", async () => {
    const user = await createTestUser("OWNER");
    const call: ModelCall = async () => ({ output: null, inputTokens: 1, outputTokens: 1 });
    await expect(
      runStructured({
        userId: user.id,
        fn: "t",
        system: "",
        prompt: "",
        schema,
        today: "2026-10-01",
        call,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("stops at the daily limit", async () => {
    const user = await createTestUser("OWNER");
    await db.aiUsage.createMany({
      data: Array.from({ length: 200 }, () => ({
        userId: user.id,
        function: "x",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
      })),
    });
    const call: ModelCall = async () => ({
      output: { answer: "x" },
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(
      runStructured({
        userId: user.id,
        fn: "t",
        system: "",
        prompt: "",
        schema,
        today: "2026-10-01",
        call,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it("hands a stable context block to the model call", async () => {
    const user = await createTestUser("OWNER");
    const call = vi.fn<ModelCall>().mockResolvedValue({
      output: { answer: "ok" },
      inputTokens: 1,
      outputTokens: 1,
    });
    await runStructured({
      userId: user.id,
      fn: "t",
      system: "s",
      context: "guide",
      prompt: "p",
      schema,
      today: "2026-10-01",
      call,
    });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ system: "s", context: "guide" }));
  });

  it("says AI is not configured when there is no API key", async () => {
    const user = await createTestUser("OWNER");
    await expect(
      runStructured({
        userId: user.id,
        fn: "t",
        system: "",
        prompt: "",
        schema,
        today: "2026-10-01",
      }),
    ).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("the daily limit's day", () => {
  it("is counted from the start of the user's day", () => {
    // Midday in Tashkent: the day started (as midnight UTC) hours ago.
    expect(limitDayStart("2026-11-23", new Date("2026-11-23T07:00:00Z")).toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    );
  });

  it("never starts ahead of now: just after a midnight ahead of UTC the limit still counts", () => {
    // 02:52 on the 24th in Tashkent is 21:52 UTC on the 23rd: «the 24th at midnight UTC» is
    // still ahead, and counting from it would count nothing.
    const now = new Date("2026-11-23T21:52:00Z");
    const start = limitDayStart("2026-11-24", now);
    expect(start.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("systemBlocks", () => {
  it("keeps a plain system prompt without a context", () => {
    expect(systemBlocks("s")).toBe("s");
  });

  it("puts the context after the system prompt and marks it for the prompt cache", () => {
    expect(systemBlocks("s", "guide")).toEqual([
      { type: "text", text: "s" },
      { type: "text", text: "guide", cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("extractTasks", () => {
  beforeEach(resetDb);

  it("drops invalid dates, empty titles and an empty description from the model answer", async () => {
    const user = await createTestUser("OWNER");
    const call: ModelCall = async () => ({
      output: {
        tasks: [
          {
            title: " Отчёт ",
            assigneeName: "",
            dueDate: "в пятницу",
            priority: null,
            project: null,
            personal: false,
            description: " ",
            steps: [{ title: "Собрать данные", dueDate: "15.10" }],
            missing: ["Когда срок?"],
          },
          {
            title: "  ",
            assigneeName: null,
            dueDate: null,
            priority: null,
            project: null,
            personal: false,
            description: null,
            steps: [],
            missing: [],
          },
        ],
      },
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(await extractTasks(user.id, "x", ctx, call)).toEqual([
      {
        title: "Отчёт",
        assigneeName: null,
        dueDate: null,
        priority: null,
        project: null,
        personal: false,
        description: null,
        steps: [{ title: "Собрать данные", dueDate: null }],
        missing: ["Когда срок?"],
      },
    ]);
  });
});
