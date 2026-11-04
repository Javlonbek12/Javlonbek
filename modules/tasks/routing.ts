import { db } from "@/lib/db";
import type { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { getRoleConfig, type TaskScope } from "@/modules/core/access/config";

import { getTaskSettings } from "./settings";

// The route of a team task (docs: «Маршрут задачи v2: утверждение по исключению»). Approval is the
// exception: a task waits for a decision only when its author disposes of someone else's time.
// Inside one's own team a task starts right away and the manager follows it afterwards.

export type Person = { id: string; role: Role; managerId: string | null };

export type RouteSettings = {
  // The managers' zone (Settings → Roles): with «Только свои» they decide nothing.
  managerScope: TaskScope;
  // Managers whose team asked to approve tasks inside the team too (the v1 way).
  teamApproval: string[];
};

export type RouteKind = "self" | "down" | "up" | "team" | "foreign" | "flag";

export type Route = {
  kind: RouteKind;
  status: Extract<TaskStatus, "APPROVED" | "PENDING_APPROVAL">;
  // Who decides while it waits (the owner always may as well).
  deciderIds: string[];
  // Who accepts the result: the author, or for one's own task the nearest manager; null for the
  // owner's own task (handing it in closes it).
  reviewerId: string | null;
  // Started right away: the assignee's nearest manager hears «Новая задача в команде».
  teamNoticeId: string | null;
};

const isBoss = (p: Person | undefined) => p?.role === "OWNER" || p?.role === "MANAGER";

// The first manager or owner above the person; without one, the owner.
export function nearestManager(people: Person[], id: string): string | null {
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>([id]);
  for (let up = byId.get(id)?.managerId; up && !seen.has(up); up = byId.get(up)?.managerId) {
    seen.add(up);
    if (isBoss(byId.get(up))) return up;
  }
  return people.find((p) => p.role === "OWNER" && p.id !== id)?.id ?? null;
}

// `who` stands below `of` in the reporting lines (any depth). Everyone is below the owner.
export function isSubordinate(people: Person[], of: string, who: string): boolean {
  if (of === who) return false;
  const byId = new Map(people.map((p) => [p.id, p]));
  if (byId.get(of)?.role === "OWNER") return true;
  const seen = new Set<string>();
  for (let up = byId.get(who)?.managerId; up && !seen.has(up); up = byId.get(up)?.managerId) {
    if (up === of) return true;
    seen.add(up);
  }
  return false;
}

// One team: the same nearest manager, or one is the other's nearest manager.
export function sameTeam(people: Person[], a: string, b: string): boolean {
  const ma = nearestManager(people, a);
  const mb = nearestManager(people, b);
  return (ma !== null && ma === mb) || ma === b || mb === a;
}

// Who decides for the people of this manager: the manager, unless their zone is «Только свои»
// (then the owner).
function decidersFor(people: Person[], settings: RouteSettings, managerId: string | null) {
  const manager = people.find((p) => p.id === managerId);
  if (manager?.role === "OWNER" || (manager?.role === "MANAGER" && settings.managerScope !== "own"))
    return [manager.id];
  return people.filter((p) => p.role === "OWNER").map((p) => p.id);
}

export function resolveRoute(
  people: Person[],
  settings: RouteSettings,
  authorId: string,
  assigneeId: string,
  needsApproval = false,
): Route {
  const byId = new Map(people.map((p) => [p.id, p]));
  const author = byId.get(authorId);
  const assignee = byId.get(assigneeId);
  const ownerAuthor = author?.role === "OWNER";
  const reviewerId =
    authorId !== assigneeId ? authorId : ownerAuthor ? null : nearestManager(people, assigneeId);
  const assigneeManager = nearestManager(people, assigneeId);
  const sees = (id: string | null) => id !== null && decidersFor(people, settings, id).includes(id);
  const pending = (kind: RouteKind, deciderIds: string[]): Route => ({
    kind,
    status: "PENDING_APPROVAL",
    deciderIds,
    reviewerId,
    teamNoticeId: null,
  });
  const started = (kind: RouteKind): Route => ({
    kind,
    status: "APPROVED",
    deciderIds: [],
    reviewerId,
    teamNoticeId: assigneeManager !== authorId && sees(assigneeManager) ? assigneeManager : null,
  });
  // A team that approves its own tasks too: «сразу» becomes a decision of its manager.
  const teamGate = (kind: RouteKind, manager: string | null) => {
    if (needsApproval && !ownerAuthor)
      return pending("flag", decidersFor(people, settings, nearestManager(people, authorId)));
    if (manager && settings.teamApproval.includes(manager))
      return pending(kind, decidersFor(people, settings, manager));
    return started(kind);
  };

  // 1. One's own task.
  if (authorId === assigneeId) return teamGate("self", nearestManager(people, authorId));
  // 2. Down the reporting lines (the owner's tasks go to anyone).
  if (ownerAuthor || isSubordinate(people, authorId, assigneeId)) {
    if (needsApproval && !ownerAuthor)
      return pending("flag", decidersFor(people, settings, nearestManager(people, authorId)));
    return started("down");
  }
  // 4. Up or sideways to a manager or the owner: a request they accept or decline themselves.
  if (isBoss(assignee)) return pending("up", [assigneeId]);
  // 3. A colleague in one's team.
  if (sameTeam(people, authorId, assigneeId)) return teamGate("team", assigneeManager);
  // 5. Someone in another team: their nearest manager decides.
  return pending("foreign", decidersFor(people, settings, assigneeManager));
}

export async function loadRouting(): Promise<{ people: Person[]; settings: RouteSettings }> {
  const [people, roles, task] = await Promise.all([
    db.user.findMany({ select: { id: true, role: true, managerId: true } }),
    getRoleConfig(),
    getTaskSettings(),
  ]);
  return {
    people,
    settings: { managerScope: roles.MANAGER.taskScope, teamApproval: task.teamApproval },
  };
}
