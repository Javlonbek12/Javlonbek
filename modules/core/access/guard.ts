import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";

import { canUseModule } from "./actor";
import type { ConfigurableModule } from "./config";

// For pages and layouts: a section switched off for the role is not reachable by its link either.
export async function requireModule(...modules: ConfigurableModule[]) {
  const user = await requireUser();
  if (!modules.some((m) => canUseModule(user, m))) redirect("/");
  return user;
}
