import type { Role } from "@/lib/generated/prisma/enums";

// The management report shows the whole team's work: owner and managers only.
export const canSeeReports = (role: Role) => role === "OWNER" || role === "MANAGER";
