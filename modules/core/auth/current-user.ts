import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { requireSessionSecret } from "@/lib/env";

import { readSessionToken, SESSION_COOKIE } from "./session";

// Cached per request, so layout and page share one DB query.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = readSessionToken(token, requireSessionSecret());
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  // With the role settings attached: menus, lists and approvals follow them.
  return user ? withAccess(user) : null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
