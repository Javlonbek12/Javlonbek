import { z } from "zod";

import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

// What each role sees, set by the owner in Settings → Roles. The owner always sees everything.

// Sections that can be switched on or off. "Today", own tasks, notifications and settings are always there.
export const CONFIGURABLE_MODULES = [
  "meetings",
  "team",
  "structure",
  "planograms",
  "reports",
] as const;
export type ConfigurableModule = (typeof CONFIGURABLE_MODULES)[number];

// Which team tasks a manager sees (and approves): all, their people's (subordinates at any level), or own only.
export const TASK_SCOPES = ["all", "team", "own"] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

const roleSchema = z.object({
  modules: z.array(z.enum(CONFIGURABLE_MODULES)),
  taskScope: z.enum(TASK_SCOPES),
});
const configSchema = z.object({ MANAGER: roleSchema, MEMBER: roleSchema });
export type RoleConfig = z.infer<typeof configSchema>;

// Default: only the owner sees everything; others see their tasks and meetings.
export const DEFAULT_ROLE_CONFIG: RoleConfig = {
  MANAGER: { modules: ["meetings"], taskScope: "team" },
  MEMBER: { modules: ["meetings"], taskScope: "own" },
};

const KEY = "roles.config";

export async function getRoleConfig(): Promise<RoleConfig> {
  const row = await db.systemState.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_ROLE_CONFIG;
  try {
    const parsed = configSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_ROLE_CONFIG;
  } catch {
    return DEFAULT_ROLE_CONFIG;
  }
}

export class RoleConfigError extends Error {
  constructor(public readonly code: "forbidden" | "invalid") {
    super(code);
    this.name = "RoleConfigError";
  }
}

export async function saveRoleConfig(actor: Actor, input: unknown) {
  if (actor.role !== "OWNER") throw new RoleConfigError("forbidden");
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new RoleConfigError("invalid");
  // Employees only ever see their own tasks.
  const config = { ...parsed.data, MEMBER: { ...parsed.data.MEMBER, taskScope: "own" as const } };
  const value = JSON.stringify(config);
  await db.systemState.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  await logActivity({
    actorId: actor.id,
    action: "roles.saved",
    entityType: "SystemState",
    entityId: KEY,
    details: config,
  });
  return config;
}

export function roleModules(role: Role, config: RoleConfig): ConfigurableModule[] {
  return role === "OWNER" ? [...CONFIGURABLE_MODULES] : config[role].modules;
}

export function roleTaskScope(role: Role, config: RoleConfig): TaskScope {
  return role === "OWNER" ? "all" : config[role].taskScope;
}
