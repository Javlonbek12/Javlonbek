import { NextResponse } from "next/server";

import { getEnv, requireSessionSecret } from "@/lib/env";
import { createRateLimiter } from "@/lib/rate-limit";
import type { LoginResult } from "@/modules/core/users/service";

import { safeNextPath } from "./next-path";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "./session";

const allowLoginAttempt = createRateLimiter({ limit: 10, windowMs: 60_000 });

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function isLoginRateLimited(request: Request): boolean {
  return !allowLoginAttempt(clientIp(request));
}

// Where to go after a failed login: back to the invite page or the login page (keeping the way
// back, `next`).
export function loginErrorRedirect(error: string, inviteCode?: string, next?: unknown) {
  const path = inviteCode ? `/invite/${encodeURIComponent(inviteCode)}` : "/login";
  const back = safeNextPath(next);
  const query = new URLSearchParams({ error, ...(back && !inviteCode ? { next: back } : {}) });
  return NextResponse.redirect(new URL(`${path}?${query}`, getEnv().APP_URL), 303);
}

// Signed in: to the page the person came for (`next`, only a path inside the app), else home.
export function loginResultResponse(result: LoginResult, inviteCode?: string, next?: unknown) {
  if (!result.ok) return loginErrorRedirect(result.reason, inviteCode, next);
  const { APP_URL } = getEnv();
  const response = NextResponse.redirect(new URL(safeNextPath(next) ?? "/", APP_URL), 303);
  response.cookies.set(
    SESSION_COOKIE,
    createSessionToken(result.user.id, requireSessionSecret()),
    sessionCookieOptions(APP_URL),
  );
  return response;
}
