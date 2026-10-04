import type { Role } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";

export type EmployeeInfo = { id: string; managerId: string | null };

// Private notes ("Сильные стороны", "Зоны роста", 1:1, goals): only the OWNER and
// the employee's direct manager. The employee never sees notes about themselves.
export function canSeePrivateNotes(viewer: Actor, employee: EmployeeInfo): boolean {
  if (viewer.id === employee.id) return false;
  return viewer.role === "OWNER" || employee.managerId === viewer.id;
}

// Task statistics: the employee, the OWNER and managers (who approve team tasks).
export function canSeeStats(viewer: Actor, employee: EmployeeInfo): boolean {
  return viewer.id === employee.id || viewer.role === "OWNER" || viewer.role === "MANAGER";
}

export type ProfileField =
  "position" | "responsibility" | "phone" | "email" | "startedAt" | "managerId";

// OWNER edits everything; the direct manager edits position and area; everyone edits own contacts.
export function editableProfileFields(viewer: Actor, employee: EmployeeInfo): ProfileField[] {
  if (viewer.role === "OWNER")
    return ["position", "responsibility", "phone", "email", "startedAt", "managerId"];
  const fields: ProfileField[] = [];
  if (employee.managerId === viewer.id) fields.push("position", "responsibility");
  if (viewer.id === employee.id) fields.push("phone", "email");
  return fields;
}

// A manager must be an OWNER or MANAGER, not the person themselves, and not one of
// the people who (directly or indirectly) report to them.
export function isValidManager(
  employeeId: string,
  manager: { id: string; role: Role } | null,
  managerOf: Map<string, string | null>,
): boolean {
  if (!manager) return true;
  if (manager.id === employeeId || (manager.role !== "OWNER" && manager.role !== "MANAGER"))
    return false;
  const seen = new Set<string>();
  for (let current: string | null = manager.id; current; current = managerOf.get(current) ?? null) {
    if (current === employeeId || seen.has(current)) return false;
    seen.add(current);
  }
  return true;
}
