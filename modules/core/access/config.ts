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
  "projects",
  "content",
  "reports",
  "connect",
  "distribution",
] as const;
export type ConfigurableModule = (typeof CONFIGURABLE_MODULES)[number];

// Which team tasks a manager sees (and approves): all, their people's (subordinates at any level), or own only.
export const TASK_SCOPES = ["all", "team", "own"] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

const roleSchema = z.object({
  modules: z.array(z.enum(CONFIGURABLE_MODULES)),
  taskScope: z.enum(TASK_SCOPES),
});
const LAWYER_DEFAULT = {
  modules: ["meetings", "planograms", "content"],
  taskScope: "own",
} satisfies z.infer<typeof roleSchema>;
// The lawyer's settings were added later: configs saved before get the default.
const configSchema = z.object({
  MANAGER: roleSchema,
  MEMBER: roleSchema,
  LAWYER: roleSchema.default(LAWYER_DEFAULT),
  // People (user ids) with the whole of «Аналитика Connect», whatever their role has: every
  // level, every zone, uploading the exports. Added later: configs saved before have nobody.
  connectLeads: z.array(z.string().min(1).max(64)).max(500).default([]),
});
export type RoleConfig = z.infer<typeof configSchema>;

// Default: the owner sees everything; the others get the modules listed here (the owner changes
// it in Settings → Roles and access).
export const DEFAULT_ROLE_CONFIG: RoleConfig = {
  MANAGER: {
    modules: ["team", "meetings", "planograms", "projects", "content", "connect", "distribution"],
    taskScope: "team",
  },
  MEMBER: { modules: ["team", "meetings", "planograms", "content"], taskScope: "own" },
  LAWYER: LAWYER_DEFAULT,
  connectLeads: [],
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

// `connectLeads` left out of the input keeps the people saved before (the roles alone are saved).
export async function saveRoleConfig(actor: Actor, input: unknown) {
  if (actor.role !== "OWNER") throw new RoleConfigError("forbidden");
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new RoleConfigError("invalid");
  const given = typeof input === "object" && input !== null && "connectLeads" in input;
  // Only people who are in the app and are not the owner (who has it all anyway).
  const connectLeads = given
    ? (
        await db.user.findMany({
          where: { id: { in: parsed.data.connectLeads }, role: { not: "OWNER" } },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map((u) => u.id)
    : (await getRoleConfig()).connectLeads;
  // Employees and the lawyer only ever see their own tasks; the lawyer always has the content plan.
  const lawyerModules = parsed.data.LAWYER.modules.filter((m) => m !== "reports");
  const config = {
    ...parsed.data,
    MEMBER: { ...parsed.data.MEMBER, taskScope: "own" as const },
    LAWYER: {
      modules: lawyerModules.includes("content")
        ? lawyerModules
        : [...lawyerModules, "content" as const],
      taskScope: "own" as const,
    },
    connectLeads,
  };
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
  if (role === "OWNER") return [...CONFIGURABLE_MODULES];
  // The lawyer checks every post, so the content plan is always on.
  if (role === "LAWYER") return [...new Set([...config.LAWYER.modules, "content" as const])];
  return config[role].modules;
}

export function roleTaskScope(role: Role, config: RoleConfig): TaskScope {
  if (role === "OWNER") return "all";
  return role === "MANAGER" ? config.MANAGER.taskScope : "own";
}
