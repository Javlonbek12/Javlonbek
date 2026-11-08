import { z } from "zod";

import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { TaskError } from "./errors";

// Task settings the owner sets (Settings → Roles): teams that approve tasks inside the team too,
// and how many days deleted tasks wait in the bin.

const KEY = "tasks.settings";

const schema = z.object({
  // Managers whose team approves its tasks inside the team (as before routing v2).
  teamApproval: z.array(z.string().max(64)).max(500).default([]),
  trashDays: z.number().int().min(1).max(365).default(30),
});

export type TaskSettings = z.output<typeof schema>;

export async function getTaskSettings(): Promise<TaskSettings> {
  const row = await db.systemState.findUnique({ where: { key: KEY } });
  try {
    const parsed = schema.safeParse(row ? JSON.parse(row.value) : {});
    if (parsed.success) return parsed.data;
  } catch {
    // A broken value falls back to the defaults below.
  }
  return schema.parse({});
}

export async function saveTaskSettings(actor: Actor, input: z.input<typeof schema>) {
  if (actor.role !== "OWNER") throw new TaskError("forbidden");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new TaskError("invalid");
  const value = JSON.stringify(parsed.data);
  await db.systemState.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  await logActivity({
    actorId: actor.id,
    action: "tasks.settings_saved",
    entityType: "SystemState",
    entityId: KEY,
  });
  return parsed.data;
}

// Who can lead a team for the «утверждать внутри команды» flags: the owner and the managers.
export async function listTeamLeads() {
  return db.user.findMany({
    where: { role: { in: ["OWNER", "MANAGER"] }, deactivatedAt: null },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: "asc" },
  });
}
