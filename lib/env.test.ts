import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("applies defaults when only DATABASE_URL is set", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://test@localhost/test" });
    expect(env.DEFAULT_TIMEZONE).toBe("Asia/Tashkent");
    expect(env.CLAUDE_MODEL).toBe("claude-haiku-4-5");
    expect(env.AI_DAILY_LIMIT).toBe(200);
    expect(env.APP_URL).toBe("http://localhost:3000");
  });

  it("converts AI_DAILY_LIMIT from string to number", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://x", AI_DAILY_LIMIT: "50" });
    expect(env.AI_DAILY_LIMIT).toBe(50);
  });

  it("fails with a readable message when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an unknown STT provider", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgresql://x", STT_PROVIDER: "google" })).toThrow(
      /STT_PROVIDER/,
    );
  });
});

describe("parseEnv: stage 1 variables", () => {
  const base = { DATABASE_URL: "postgresql://x" };

  it("treats empty strings as not set", () => {
    const env = parseEnv({ ...base, TELEGRAM_BOT_TOKEN: "", SESSION_SECRET: "" });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("parses ALLOW_DEV_LOGIN as a boolean", () => {
    expect(parseEnv({ ...base, ALLOW_DEV_LOGIN: "true" }).ALLOW_DEV_LOGIN).toBe(true);
    expect(parseEnv(base).ALLOW_DEV_LOGIN).toBe(false);
  });
});
