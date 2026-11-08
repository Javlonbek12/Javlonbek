import { personName } from "@/modules/core/users/display-name";
import type { Actor } from "@/modules/core/permissions";

import { listPlansWithProgress } from "./plan-service";
import { listAssignableUsers, listProjects } from "./service";

// Select options for the task form; `keep`: people already chosen (shown even if deactivated).
export async function getTaskFormOptions(actor: Actor, keep: string[] = []) {
  const [users, plans, projects] = await Promise.all([
    listAssignableUsers(keep),
    listPlansWithProgress(actor),
    listProjects(actor),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, label: personName(u) })),
    plans: plans.map((p) => ({
      id: p.id,
      label: p.title === p.period ? p.title : `${p.title} (${p.period})`,
      isPersonal: p.isPersonal,
    })),
    projects,
  };
}
