// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { answerHelpQuestion, HELP_SYSTEM } from "@/modules/ai/help";
import type { ModelCall } from "@/modules/ai/run";
import { withAccess } from "@/modules/core/access/actor";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const question = {
  question: "Как поставить задачу?",
  history: [{ role: "user" as const, text: "Привет" }],
  path: "/tasks",
};

const answer = (output: unknown): ModelCall =>
  vi.fn<ModelCall>().mockResolvedValue({ output, inputTokens: 9000, outputTokens: 150 });

async function employee() {
  return withAccess(await createTestUser("MEMBER", { firstName: "Сотрудник (тест)" }));
}

describe("AI help: answerHelpQuestion", () => {
  beforeEach(resetDb);

  it("answers from the guide, keeps only the person's pages and logs the call as «help»", async () => {
    const user = await employee();
    const call = answer({
      answer: "1. Откройте [«Задачи»](/tasks) → «Новая задача».\n2. Нажмите «Создать».",
      links: ["/tasks/new", "/settings/roles", "/no-such-page", "/tasks/new", "https://evil.test"],
      covered: true,
    });

    const result = await answerHelpQuestion(user, question, { call, locale: "ru" });

    expect(result).toEqual({
      answer: "1. Откройте «Задачи» → «Новая задача».\n2. Нажмите «Создать».",
      links: [{ href: "/tasks/new", label: "Новая задача" }],
      covered: true,
    });
    const request = vi.mocked(call).mock.calls[0]![0];
    expect(request.system).toBe(HELP_SYSTEM);
    // The whole guide goes in the cached block, the question and the person after it.
    expect(request.context).toMatch(/^<user_guide>\n# Assistant/);
    expect(request.context).toContain("## Задачи");
    expect(request.prompt).toContain("Как поставить задачу?");
    expect(request.prompt).toContain("Employee: Привет");
    expect(request.prompt).toContain("Role: Сотрудник (MEMBER)");
    expect(await db.aiUsage.findMany()).toMatchObject([
      { userId: user.id, function: "help", inputTokens: 9000, outputTokens: 150, ok: true },
    ]);
  });

  it("stops at the daily limit without calling the model", async () => {
    const user = await employee();
    await db.aiUsage.createMany({
      data: Array.from({ length: 200 }, () => ({
        userId: user.id,
        function: "help",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
      })),
    });
    const call = answer({ answer: "x", links: [], covered: true });
    await expect(
      answerHelpQuestion(user, question, { call, today: "2026-11-08", locale: "ru" }),
    ).rejects.toMatchObject({ code: "limit" });
    expect(call).not.toHaveBeenCalled();
  });

  it("gives the «invalid» error after two unusable answers, each logged as failed", async () => {
    const user = await employee();
    const call = answer({ text: "не по схеме" });
    await expect(
      answerHelpQuestion(user, question, { call, today: "2026-11-08", locale: "ru" }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await db.aiUsage.count({ where: { function: "help", ok: false } })).toBe(2);
  });

  it("says AI is not configured when there is no key", async () => {
    const user = await employee();
    await expect(
      answerHelpQuestion(user, question, { today: "2026-11-08", locale: "ru", guide: "g" }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });
});
