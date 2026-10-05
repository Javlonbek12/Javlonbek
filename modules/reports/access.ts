import type { Role } from "@/lib/generated/prisma/enums";
import { canUseModule, type Access } from "@/modules/core/access/actor";

// The management report shows the whole team's work: owner, and managers if the role settings allow.
export const canSeeReports = (user: { role: Role; access?: Access }) =>
  (user.role === "OWNER" || user.role === "MANAGER") && canUseModule(user, "reports");
