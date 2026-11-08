import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";

import { safeNextPath } from "./next-path";
import { sessionProxy } from "./proxy";
import {
  createSessionToken,
  readSessionToken,
  renewedSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./session";

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

  it("is renewed once more than half of its life has passed", () => {
    const day = 86_400_000;
    const token = createSessionToken("user-1", SECRET, 0);
    expect(renewedSessionToken(token, SECRET, 10 * day)).toBeNull();
    const renewed = renewedSessionToken(token, SECRET, 20 * day)!;
    // Valid for another 30 days from now, when the old one would have run out.
    expect(readSessionToken(renewed, SECRET, 45 * day)).toBe("user-1");
    expect(readSessionToken(token, SECRET, 45 * day)).toBeNull();
    expect(renewedSessionToken("bad", SECRET)).toBeNull();
  });
});

describe("after signing in: back to the page", () => {
  it("accepts only paths inside the app", () => {
    expect(safeNextPath("/meetings/abc?x=1")).toBe("/meetings/abc?x=1");
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/login?next=/x",
      "/api/auth/logout",
      "/a\nb",
      "/",
      null,
      42,
    ])
      expect(safeNextPath(bad)).toBeNull();
  });

  it("the proxy sends a signed-out visit to sign-in with the way back and renews old sessions", () => {
    const secret = "test-session-secret-test-session-secret";
    const out = sessionProxy(new NextRequest("http://localhost:3000/meetings/abc?x=1"));
    expect(out.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fmeetings%2Fabc%3Fx%3D1",
    );
    // A form post (server action) is left to the page.
    const post = sessionProxy(new NextRequest("http://localhost:3000/tasks", { method: "POST" }));
    expect(post.headers.get("location")).toBeNull();

    const now = Date.now();
    const visit = (issued: number) =>
      sessionProxy(
        new NextRequest("http://localhost:3000/tasks", {
          headers: { cookie: `${SESSION_COOKIE}=${createSessionToken("user-1", secret, issued)}` },
        }),
        now,
      );
    expect(visit(now - 86_400_000).cookies.get(SESSION_COOKIE)).toBeUndefined();
    const renewed = visit(now - 20 * 86_400_000).cookies.get(SESSION_COOKIE);
    expect(readSessionToken(renewed!.value, secret, now)).toBe("user-1");
  });
});
