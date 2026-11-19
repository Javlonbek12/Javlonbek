import type { Role } from "@/lib/generated/prisma/enums";
import { subordinatesOf } from "@/modules/core/access/actor";
import type { Actor } from "@/modules/core/permissions";

// Who may change the responsibilities («Команда» → «Обязанности») of whom. Everyone with the
// section reads the confirmed ones; suggestions are seen only by those who may confirm them.

// The person a manager changes items for: themselves and everyone below them in the reporting
// lines (the same people as `access.teamIds`, whatever the «which tasks» setting says).
export function dutiesTeam(actor: Actor, links: { id: string; managerId: string | null }[]) {
  if (actor.access?.taskScope === "team") return actor.access.teamIds;
  return subordinatesOf(actor.id, links);
}

// `subject`: whose item it is for the rights (see subjectOfPlace for a place nobody holds).
// The owner changes everything; a manager the items of themselves and of their team; an
// employee nobody's, not even their own.
export function canEditDutiesOf(
  actor: Pick<Actor, "id" | "role">,
  subject: string | null,
  team: readonly string[],
): boolean {
  if (actor.role === "OWNER") return true;
  if (actor.role !== "MANAGER" || !subject) return false;
  return subject === actor.id || team.includes(subject);
}

export type ChartPlace = {
  id: string;
  parentId: string | null;
  user: { id: string; role: Role; deactivatedAt: Date | null } | null;
};

// For an item on a place that has no app user (a vacancy, or someone not in the app): whoever
// would manage a person there — the nearest active owner or manager above it in the chart, the
// same rule as syncPeople. Null: nobody above, so only the owner changes it.
export function subjectOfPlace(placeId: string, places: Map<string, ChartPlace>): string | null {
  const place = places.get(placeId);
  const seen = new Set<string>();
  for (
    let up = place?.parentId ? places.get(place.parentId) : undefined;
    up && !seen.has(up.id);
    up = up.parentId ? places.get(up.parentId) : undefined
  ) {
    seen.add(up.id);
    const user = up.user;
    if (user && !user.deactivatedAt && (user.role === "OWNER" || user.role === "MANAGER"))
      return user.id;
  }
  return null;
}
