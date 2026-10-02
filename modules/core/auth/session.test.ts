import { describe, expect, it } from "vitest";

import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from "./session";

const SECRET = "test-secret-test-secret-test-secret-1234";

describe("session token", () => {
  it("round-trips the user id", () => {
    const token = createSessionToken("user-1", SECRET, 0);
    expect(readSessionToken(token, SECRET, 1000)).toBe("user-1");
  });

  it("rejects a token signed with another secret", () => {
    const token = createSessionToken("user-1", "another-secret-another-secret-12345", 0);
    expect(readSessionToken(token, SECRET, 1000)).toBeNull();
  });

  it("rejects a token whose payload was changed", () => {
    const token = createSessionToken("user-1", SECRET, 0);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "owner", expiresAt: 9e15 })).toString(
      "base64url",
    );
    expect(readSessionToken(`${forged}.${signature}`, SECRET, 1000)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createSessionToken("user-1", SECRET, 0);
    expect(readSessionToken(token, SECRET, SESSION_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(readSessionToken("not-a-token", SECRET)).toBeNull();
  });
});
