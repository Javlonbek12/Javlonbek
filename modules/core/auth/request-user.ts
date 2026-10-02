import { db } from "@/lib/db";
import { requireSessionSecret } from "@/lib/env";

import { readSessionToken, SESSION_COOKIE } from "./session";

// For API route handlers: reads the session cookie straight from the request.
export async function getUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const userId = readSessionToken(decodeURIComponent(token), requireSessionSecret());
  if (!userId) return null;
  return db.user.findUnique({ where: { id: userId } });
}
