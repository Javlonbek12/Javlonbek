import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { db } from "@/lib/db";
import { createTestUser, resetDb } from "@/tests/helpers/db";

import { extractTasks } from "./prompts";
import { AiError, runStructured, type ModelCall } from "./run";

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

describe("extractTasks", () => {
  beforeEach(resetDb);

  it("drops invalid dates and empty titles from the model answer", async () => {
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
          },
          { title: "  ", assigneeName: null, dueDate: null, priority: null, project: null },
        ],
      },
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(await extractTasks(user.id, "x", ctx, call)).toEqual([
      { title: "Отчёт", assigneeName: null, dueDate: null, priority: null, project: null },
    ]);
  });
});
