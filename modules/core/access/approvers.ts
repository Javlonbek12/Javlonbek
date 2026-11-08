import { db } from "@/lib/db";
import { oversees } from "@/modules/tasks/access";

import { accessFor } from "./actor";
import { getRoleConfig } from "./config";

// Owners and managers who oversee this task under the role settings (they get approval notices).
export async function approverIdsFor(task: {
  creatorId: string;
  assigneeId: string;
}): Promise<string[]> {
  const [people, config] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["OWNER", "MANAGER"] }, deactivatedAt: null },
      select: { id: true, role: true },
    }),
    getRoleConfig(),
  ]);
  const result: string[] = [];
  for (const person of people) {
    if (oversees({ ...person, access: await accessFor(person, config) }, task))
      result.push(person.id);
  }
  return result;
}
