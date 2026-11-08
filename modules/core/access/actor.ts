import { db } from "@/lib/db";
import type { User } from "@/lib/generated/prisma/client";
import type { Role } from "@/lib/generated/prisma/enums";

import {
  getRoleConfig,
  roleModules,
  roleTaskScope,
  type ConfigurableModule,
  type RoleConfig,
  type TaskScope,
} from "./config";

export type Access = {
  modules: ConfigurableModule[];
  taskScope: TaskScope;
  // People below this person in the reporting lines (any depth).
  teamIds: string[];
};

// Everyone below `id` through "manager" links.
export function subordinatesOf(
  id: string,
  links: { id: string; managerId: string | null }[],
): string[] {
  const result = new Set<string>();
  const walk = (manager: string) => {
    for (const link of links) {
      if (link.managerId !== manager || result.has(link.id) || link.id === id) continue;
      result.add(link.id);
      walk(link.id);
    }
  };
  walk(id);
  return [...result];
}

export async function accessFor(
  user: { id: string; role: Role },
  config?: RoleConfig,
): Promise<Access> {
  const cfg = config ?? (await getRoleConfig());
  const taskScope = roleTaskScope(user.role, cfg);
  const teamIds =
    taskScope === "team"
      ? subordinatesOf(user.id, await db.user.findMany({ select: { id: true, managerId: true } }))
      : [];
  return { modules: roleModules(user.role, cfg), taskScope, teamIds };
}

// The user as an actor with their access rules attached. Every entry point (web, API, bot,
// scheduler) loads users this way, so lists, approvals and menus follow the role settings.
export async function withAccess<T extends User>(
  user: T,
  config?: RoleConfig,
): Promise<T & { access: Access }> {
  return { ...user, access: await accessFor(user, config) };
}

export { canUseModule } from "./paths";
