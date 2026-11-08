import { db } from "@/lib/db";
import type { Actor } from "@/modules/core/permissions";
import { personName } from "@/modules/core/users/display-name";

import { distinctNames } from "./names";
import { listPlansWithProgress } from "./plan-service";
import { listAssignableUsers, listProjects } from "./service";

// Select options for the task form; `keep`: people already chosen (shown even if deactivated).
// Projects are chosen from the list (a typo no longer leaves a task outside its project), each with
// its phases; names only met on tasks (older free text) are offered too, without phases.
export async function getTaskFormOptions(actor: Actor, keep: string[] = []) {
  const [users, plans, onTasks, projects] = await Promise.all([
    listAssignableUsers(keep),
    listPlansWithProgress(actor),
    listProjects(actor),
    db.project.findMany({
      where: { archived: false, finishedAt: null },
      select: {
        name: true,
        phases: { select: { id: true, title: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const names = distinctNames(users);
  const known = new Set(projects.map((p) => p.name));
  return {
    users: users.map((u) => ({
      id: u.id,
      label: u.deactivatedAt ? personName(u) : names.get(u.id)!,
    })),
    plans: plans.map((p) => ({
      id: p.id,
      label: p.title === p.period ? p.title : `${p.title} (${p.period})`,
      isPersonal: p.isPersonal,
    })),
    projects: [
      ...projects,
      ...onTasks.filter((name) => !known.has(name)).map((name) => ({ name, phases: [] })),
    ],
  };
}

export type ProjectOption = Awaited<ReturnType<typeof getTaskFormOptions>>["projects"][number];
