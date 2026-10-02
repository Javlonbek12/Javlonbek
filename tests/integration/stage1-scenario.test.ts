import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { handleStart } from "@/modules/bot/start";
import { createInvite } from "@/modules/core/invites/service";
import { countUnread, sendTestNotification } from "@/modules/core/notifications/service";
import { loginWithTelegram } from "@/modules/core/users/service";
import { resetDb, testProfile } from "@/tests/helpers/db";
import { telegramMock } from "@/tests/helpers/telegram";

// The stage 1 "done" scenario: owner logs in, invites a second user,
// both receive a test notification in Telegram and in the app.
describe("stage 1 scenario", () => {
  beforeEach(async () => {
    await resetDb();
    telegramMock.mockClear();
  });

  it("works end to end", async () => {
    const ownerLogin = await loginWithTelegram(testProfile(8000001n, "Тестовый владелец"));
    if (!ownerLogin.ok) throw new Error("owner login failed");
    await handleStart(testProfile(8000001n, "Тестовый владелец"), 8000001n, "");
    const owner = await db.user.findUniqueOrThrow({ where: { id: ownerLogin.user.id } });
    expect(owner.role).toBe("OWNER");

    const invite = await createInvite(owner, "MEMBER");
    await handleStart(testProfile(8000002n, "Тестовый сотрудник 1"), 8000002n, invite.code);
    const member = await db.user.findUniqueOrThrow({ where: { telegramId: 8000002n } });

    telegramMock.mockClear();
    await sendTestNotification(owner, owner.id);
    await sendTestNotification(owner, member.id);

    expect(telegramMock).toHaveBeenCalledTimes(2);
    expect(telegramMock.mock.calls.map(([chatId]) => chatId).sort()).toEqual([8000001n, 8000002n]);
    expect(await countUnread(member.id)).toBe(1);
    // Owner: "invite accepted" + test notification.
    expect(await countUnread(owner.id)).toBe(2);
  });
});
