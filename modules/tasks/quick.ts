import type { TaskStatus } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

import type { TaskAccessInfo } from "./access";
import { availableTransitions } from "./status";

// The round button in a task row (and «закрой задачу» in the bot): the next allowed step towards
// closing the task. A personal task becomes «Выполнена»; the assignee of a team task hands it in
// (taking it on first if needed); whoever accepts the result accepts it. Deciding on a waiting
// task is never a quick step. Returns where the task ends up, or null when there is no such step.
export function quickTarget(actor: Actor, task: TaskAccessInfo): "DONE" | "IN_REVIEW" | null {
  let status: TaskStatus = task.status;
  for (let step = 0; step < 3; step++) {
    const options = availableTransitions(actor, { ...task, status });
    if (options.includes("DONE")) return "DONE";
    if (options.includes("IN_REVIEW")) return "IN_REVIEW";
    if (options.includes("IN_PROGRESS") && status !== "IN_REVIEW") {
      status = "IN_PROGRESS";
      continue;
    }
    return null;
  }
  return null;
}
