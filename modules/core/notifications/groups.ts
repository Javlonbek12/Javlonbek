import type { Role } from "@/lib/generated/prisma/enums";
import { canUseModule } from "@/modules/core/access/actor";
import type { ConfigurableModule } from "@/modules/core/access/config";

import type { NotificationType } from "./types";

// The notification switches in Settings, grouped so a person sees only what concerns them: a
// section's group only with the section, the manager's group for owners and managers, the lawyer's
// for lawyers. Every optional type is in exactly one group (checked by a test).
export const NOTIFICATION_GROUPS: {
  id: "tasks" | "meetings" | "content" | "planograms" | "manager" | "lawyer";
  types: NotificationType[];
  module?: ConfigurableModule;
  roles?: Role[];
}[] = [
  {
    id: "tasks",
    types: [
      "task_assigned",
      "task_status",
      "task_comment",
      "due_reminder",
      "overdue",
      "task_waiting",
      "digest",
      "role_changed",
    ],
  },
  { id: "meetings", types: ["meeting_invite", "meeting_reminder"], module: "meetings" },
  {
    id: "content",
    types: ["content_assigned", "content_review", "content_feedback", "content_approved"],
    module: "content",
  },
  { id: "planograms", types: ["planogram"], module: "planograms" },
  {
    id: "manager",
    types: [
      "task_pending_approval",
      "task_team",
      "task_delete_request",
      "weekly_summary",
      "invite_accepted",
    ],
    roles: ["OWNER", "MANAGER"],
  },
  { id: "lawyer", types: ["content_legal"], roles: ["LAWYER"] },
];

export function notificationGroupsFor(actor: Parameters<typeof canUseModule>[0]) {
  return NOTIFICATION_GROUPS.filter(
    (g) =>
      (!g.module || canUseModule(actor, g.module)) && (!g.roles || g.roles.includes(actor.role)),
  );
}
