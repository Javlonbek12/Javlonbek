import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { SESSION_COOKIE } from "@/modules/core/auth/session";

export async function POST() {
  const response = NextResponse.redirect(new URL("/login", getEnv().APP_URL), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
