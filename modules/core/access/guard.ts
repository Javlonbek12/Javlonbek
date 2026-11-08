import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";

import { canUseModule } from "./actor";
import type { ConfigurableModule } from "./config";

// Where a page of a section switched off for the role sends the person: «Сегодня», which reads
// `?denied=<section>` and says that the section is not available, instead of a silent bounce.
export const DENIED_PARAM = "denied";
export const deniedHref = (module: string) => `/?${DENIED_PARAM}=${encodeURIComponent(module)}`;

// For pages and layouts: a section switched off for the role is not reachable by its link either.
export async function requireModule(...modules: ConfigurableModule[]) {
  const user = await requireUser();
  if (!modules.some((m) => canUseModule(user, m))) redirect(deniedHref(modules[0]!));
  return user;
}
