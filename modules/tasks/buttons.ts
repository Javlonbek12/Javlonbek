import type { TaskStatus } from "@/lib/generated/prisma/enums";
import type { TranslationKey } from "@/lib/i18n";
import type { Actor } from "@/modules/core/permissions";

import type { TaskAccessInfo } from "./access";
import { needsReason } from "./status";

// How each allowed status change shows on the task card (routing v2): its words, whether it asks
// for a reason, and how loud the button is. The same change reads differently depending on who
// makes it: from «На утверждении» back to a draft is «Отозвать» for the author and «Отклонить»
// (with a reason) for whoever decides.

export type TaskButton = {
  to: TaskStatus;
  label: TranslationKey;
  reason: "required" | "optional" | null;
  variant: "default" | "outline" | "ghost";
  // After the change, open the edit form (the author took the task back to change it).
  then?: "edit";
};

export function taskButtons(
  actor: Actor,
  task: TaskAccessInfo,
  transitions: TaskStatus[],
): TaskButton[] {
  return transitions.map((to): TaskButton => {
    const required = needsReason(actor, task, to);
    if (task.isPersonal)
      return { to, label: `tasks.action.${to}`, reason: null, variant: "default" };
    switch (`${task.status}>${to}`) {
      case "DRAFT>PENDING_APPROVAL":
        return { to, label: "tasks.action.send", reason: null, variant: "default" };
      case "PENDING_APPROVAL>APPROVED":
        // The assignee who decides on a request takes it on; anyone else approves it.
        return {
          to,
          label: task.assigneeId === actor.id ? "tasks.action.accept" : "tasks.action.APPROVED",
          reason: null,
          variant: "default",
        };
      case "PENDING_APPROVAL>DRAFT":
        return required
          ? { to, label: "tasks.action.reject", reason: "required", variant: "outline" }
          : {
              to,
              label: "tasks.withdraw.approval",
              reason: null,
              variant: "outline",
              then: "edit",
            };
      case "IN_PROGRESS>DONE":
        return { to, label: "tasks.action.finish", reason: null, variant: "default" };
      case "IN_REVIEW>IN_PROGRESS":
        return required
          ? { to, label: "tasks.action.rework", reason: "required", variant: "outline" }
          : { to, label: "tasks.withdraw.review", reason: null, variant: "outline" };
    }
    if (to === "CANCELLED")
      return { to, label: "tasks.action.CANCELLED", reason: "optional", variant: "ghost" };
    if (to === "DRAFT") return { to, label: "tasks.action.DRAFT", reason: null, variant: "ghost" };
    return { to, label: `tasks.action.${to}`, reason: null, variant: "default" };
  });
}
