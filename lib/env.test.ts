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
