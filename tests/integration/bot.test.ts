import { beforeEach, describe, expect, it } from "vitest";

import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { db } from "@/lib/db";
import { handleStart, handleUnknownText, inviteCodeFromText } from "@/modules/bot/start";
import { createInvite } from "@/modules/core/invites/service";
import { createTestUser, resetDb, testProfile } from "@/tests/helpers/db";

describe("bot /start", () => {
  beforeEach(resetDb);

  it("registers the first user as OWNER and links the chat", async () => {
    const reply = await handleStart(testProfile(7000001n, "Тестовый владелец"), 7000001n, "");
    expect(reply.text).toContain("Владелец");
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 7000001n } });
    expect(user).toMatchObject({ role: "OWNER", botChatId: 7000001n });
  });

  it("asks for an invite when an unknown person writes", async () => {
    await createTestUser("OWNER");
    const reply = await handleStart(testProfile(7000002n), 7000002n, "");
    expect(reply.text).toContain("только по приглашению");
    expect(await db.user.count()).toBe(1);
  });

  it("registers a new user by invite code", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MEMBER");
    const reply = await handleStart(
      testProfile(7000002n, "Тестовый сотрудник 2"),
      7000002n,
      invite.code,
    );
    expect(reply.text).toContain("Сотрудник");
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 7000002n } });
    expect(user).toMatchObject({ role: "MEMBER", botChatId: 7000002n });
  });

  it("links the bot for a user who already logged in on the web", async () => {
    await createTestUser("OWNER");
    const member = await createTestUser("MEMBER", { botChatId: null });
    const reply = await handleStart(testProfile(member.telegramId), member.telegramId, "");
    expect(reply.text).toContain("Бот подключён");
    // The greeting offers the main lists to try right away.
    expect(reply.buttons?.flat().map((b) => b.data)).toEqual(["l:today", "l:pending"]);
    expect(reply.userId).toBe(member.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).botChatId).toBe(
      member.telegramId,
    );
  });
});

describe("invite codes sent to the bot", () => {
  beforeEach(resetDb);

  it("finds the code in the invite link, the bot link or on its own", () => {
    expect(inviteCodeFromText("https://site.test/invite/AbC_12-xyz09")).toBe("AbC_12-xyz09");
    expect(inviteCodeFromText("Откройте: https://t.me/some_bot?start=AbC_12-xyz09 ")).toBe(
      "AbC_12-xyz09",
    );
    expect(inviteCodeFromText("  AbC_12-xyz09 ")).toBe("AbC_12-xyz09");
    expect(inviteCodeFromText("привет")).toBeNull();
    expect(inviteCodeFromText("/today")).toBeNull();
    expect(inviteCodeFromText("Assalomu alaykum")).toBeNull();
  });

  it("/start with a whole invite link registers too; plain text without an invite does nothing", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MEMBER");
    const reply = await handleStart(
      testProfile(7000003n, "Тестовый сотрудник 3"),
      7000003n,
      `https://site.test/invite/${invite.code}`,
    );
    expect(reply.text).toContain("Добро пожаловать");
    expect(await handleUnknownText(testProfile(7000004n), 7000004n, "здравствуйте")).toBeNull();
    expect(await db.user.count()).toBe(2);
  });
});

describe("POST /api/telegram/webhook", () => {
  it("rejects requests without the right secret header", async () => {
    const response = await webhook(
      new Request("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "wrong" },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
