import { beforeEach, describe, expect, it } from "vitest";

import { POST as devLogin } from "@/app/api/auth/dev-login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as telegramCallback } from "@/app/api/auth/telegram/route";
import { db } from "@/lib/db";
import { readSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { signTelegramLoginData } from "@/modules/core/auth/telegram";
import { createInvite } from "@/modules/core/invites/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const BOT_TOKEN = "123456:TEST-TOKEN";
const SECRET = "test-session-secret-test-session-secret";
let ip = 0;

// Builds the request Telegram's widget would send to /api/auth/telegram.
function widgetRequest(telegramId: string, firstName: string, invite?: string, badHash = false) {
  const fields = {
    id: telegramId,
    first_name: firstName,
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const hash = badHash ? "0".repeat(64) : signTelegramLoginData(fields, BOT_TOKEN);
  const params = new URLSearchParams({ ...fields, hash, ...(invite ? { invite } : {}) });
  return new Request(`http://localhost:3000/api/auth/telegram?${params}`, {
    headers: { "x-forwarded-for": `10.0.0.${++ip}` },
  });
}

function sessionUserId(response: Response) {
  const cookie = response.headers.get("set-cookie") ?? "";
  const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1];
  return token ? readSessionToken(token, SECRET) : null;
}

describe("GET /api/auth/telegram", () => {
  beforeEach(resetDb);

  it("makes the very first user OWNER and sets an httpOnly session cookie", async () => {
    const response = await telegramCallback(widgetRequest("2000001", "Тестовый владелец"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 2000001n } });
    expect(user.role).toBe("OWNER");
    expect(sessionUserId(response)).toBe(user.id);
  });

  it("returns to the page the person came for, only inside the app", async () => {
    const back = (next: string) => {
      const request = widgetRequest("2000001", "Тестовый владелец");
      const url = new URL(request.url);
      url.searchParams.set("next", next);
      return telegramCallback(new Request(url, { headers: request.headers }));
    };
    expect((await back("/meetings/abc?x=1")).headers.get("location")).toBe(
      "http://localhost:3000/meetings/abc?x=1",
    );
    for (const evil of ["//evil.example/x", "https://evil.example", "/\\evil.example"])
      expect((await back(evil)).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("rejects data with a wrong signature", async () => {
    const response = await telegramCallback(widgetRequest("2000001", "Взломщик", undefined, true));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=invalid_signature",
    );
    expect(await db.user.count()).toBe(0);
  });

  it("does not let a second person in without an invite", async () => {
    await createTestUser("OWNER");
    const response = await telegramCallback(widgetRequest("2000002", "Тестовый сотрудник 2"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=invite_required",
    );
    expect(await db.user.count()).toBe(1);
  });

  it("registers a user by invite with the invite's role, only once", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MANAGER");

    const response = await telegramCallback(
      widgetRequest("2000002", "Тестовый руководитель", invite.code),
    );
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 2000002n } });
    expect(user.role).toBe("MANAGER");
    expect(user.invitedById).toBe(owner.id);
    expect(sessionUserId(response)).toBe(user.id);

    const again = await telegramCallback(
      widgetRequest("2000003", "Тестовый сотрудник 3", invite.code),
    );
    expect(again.headers.get("location")).toBe(
      `http://localhost:3000/invite/${invite.code}?error=invite_used`,
    );
  });

  it("logs in an existing user without an invite", async () => {
    await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const response = await telegramCallback(widgetRequest(String(member.telegramId), "Новое имя"));
    expect(sessionUserId(response)).toBe(member.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).firstName).toBe(
      "Новое имя",
    );
  });
});

describe("POST /api/auth/dev-login and /api/auth/logout", () => {
  beforeEach(resetDb);

  it("logs in a fake user in dev mode", async () => {
    const form = new FormData();
    form.set("telegramId", "3000001");
    form.set("firstName", "Тестовый сотрудник 1");
    const response = await devLogin(
      new Request("http://localhost:3000/api/auth/dev-login", {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": "10.1.0.1" },
      }),
    );
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: 3000001n } });
    expect(sessionUserId(response)).toBe(user.id);
  });

  it("logout clears the session cookie", async () => {
    const response = await logout();
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });
});
