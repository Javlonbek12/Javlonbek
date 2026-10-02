import { displayName } from "@/modules/core/users/display-name";
import type { Actor } from "@/modules/core/permissions";

import { listPlansWithProgress } from "./plan-service";
import { listAssignableUsers, listProjects } from "./service";

// Select options for the task form.
export async function getTaskFormOptions(actor: Actor) {
  const [users, plans, projects] = await Promise.all([
    listAssignableUsers(),
    listPlansWithProgress(actor),
    listProjects(actor),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, label: displayName(u) })),
    plans: plans.map((p) => ({
      id: p.id,
      label: p.title === p.period ? p.title : `${p.title} (${p.period})`,
      isPersonal: p.isPersonal,
    })),
    projects,
  };
}
