import type { Role } from "@/lib/generated/prisma/enums";

// Everyone builds and changes planograms and the library (equipment, SKUs, POSM, price lists)
// and sends them for approval.
export function canManagePlanograms(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "MEMBER" || role === "LAWYER";
}

// Only OWNER and MANAGER approve, return to draft, archive, and apply price lists (that makes
// approved versions straight away).
export function canApprovePlanograms(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER";
}
