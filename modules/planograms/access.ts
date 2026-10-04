import type { Role } from "@/lib/generated/prisma/enums";

// OWNER and MANAGER build, change and approve planograms; everyone can look at them.
export function canManagePlanograms(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER";
}
