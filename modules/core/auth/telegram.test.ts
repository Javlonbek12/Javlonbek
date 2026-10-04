import { describe, expect, it } from "vitest";

import { signTelegramLoginData, verifyTelegramLogin } from "./telegram";

const BOT_TOKEN = "123456:TEST-TOKEN";
const now = new Date("2026-10-02T12:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);

function signed(fields: Record<string, string>) {
  return { ...fields, hash: signTelegramLoginData(fields, BOT_TOKEN) };
}

describe("verifyTelegramLogin", () => {
  const fields = {
    id: "1000001",
    first_name: "Тестовый",
    username: "test_user",
    auth_date: authDate,
  };

  it("accepts correctly signed data", () => {
    expect(verifyTelegramLogin(signed(fields), BOT_TOKEN, now)).toEqual({
      telegramId: 1000001n,
      firstName: "Тестовый",
      lastName: undefined,
      username: "test_user",
      photoUrl: undefined,
    });
  });

  it("rejects data signed with another bot token", () => {
    const data = { ...fields, hash: signTelegramLoginData(fields, "other:token") };
    expect(verifyTelegramLogin(data, BOT_TOKEN, now)).toBeNull();
  });

  it("rejects tampered data", () => {
    const data = { ...signed(fields), id: "999" };
    expect(verifyTelegramLogin(data, BOT_TOKEN, now)).toBeNull();
  });

  it("rejects data older than one day", () => {
    const old = { ...fields, auth_date: String(Math.floor(now.getTime() / 1000) - 2 * 86400) };
    expect(verifyTelegramLogin(signed(old), BOT_TOKEN, now)).toBeNull();
  });

  it("rejects data without a hash", () => {
    expect(verifyTelegramLogin(fields, BOT_TOKEN, now)).toBeNull();
  });
});
