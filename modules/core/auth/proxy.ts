import { NextResponse, type NextRequest } from "next/server";

import { getEnv } from "@/lib/env";

import { loginHref, safeNextPath } from "./next-path";
import {
  readSessionToken,
  renewedSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "./session";

// Runs before the app's pages (see proxy.ts at the root):
// - signed out: a page link (say, from a Telegram notification) goes to sign-in with
//   ?next=<that page>, so after signing in the person lands where the link pointed;
// - signed in for more than half of the session's life: the cookie is renewed.
// Pages still check the session themselves (requireUser); this only adds the way back.
export function sessionProxy(request: NextRequest, now = Date.now()) {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? readSessionToken(token, secret, now) : null;

  if (!userId) {
    // Only plain page visits; server actions and other requests get the page's own answer.
    if (request.method !== "GET") return NextResponse.next();
    const { pathname, search } = request.nextUrl;
    const next = safeNextPath(`${pathname}${search}`);
    return NextResponse.redirect(new URL(loginHref(next), request.url));
  }

  const response = NextResponse.next();
  const renewed = renewedSessionToken(token!, secret, now);
  if (renewed)
    response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions(getEnv().APP_URL));
  return response;
}
