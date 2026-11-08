import { db } from "@/lib/db";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";
import { syncPeople } from "@/modules/org/service";
import {
  handOverTasks,
  leaveCoAssignedTasks,
  releaseDecisions,
  stopTimersOf,
} from "@/modules/tasks/deactivated";

import { TeamError } from "./service";

// Deactivating an employee instead of deleting them (BACKLOG item 13, owner's decision): the person
// can no longer use the app — no sign-in, no bot, no messages, gone from every people picker — and
// everything they did stays, shown by name. Only the owner does it (not to themselves, not to the
// last owner) and can turn the person back on. Full deletion stays a GitHub action (team-fix).

export const canDeactivate = (actor: Actor, target: { id: string }) =>
  actor.role === "OWNER" && actor.id !== target.id;

export type DeactivateResult = { moved: number; notMoved: number };

// Marks the person deactivated: not twice, and never the last owner who can still sign in. The
// owners' rows are locked first, so two owners switching each other off at once take turns and
// the second sees the first one gone.
async function switchOff(target: { id: string; role: string }, actorId: string, now: Date) {
  return db.$transaction(async (tx) => {
    if (target.role === "OWNER") {
      await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;
      const others = await tx.user.count({
        where: { role: "OWNER", deactivatedAt: null, id: { not: target.id } },
      });
      if (others === 0) return "lastOwner" as const;
    }
    const { count } = await tx.user.updateMany({
      where: { id: target.id, deactivatedAt: null },
      data: { deactivatedAt: now, deactivatedById: actorId },
    });
    return count ? ("ok" as const) : ("state" as const);
  });
}

export async function deactivateUser(
  actor: Actor,
  userId: string,
  options: { handOverTo?: string | null } = {},
  now = new Date(),
): Promise<DeactivateResult> {
  if (actor.role !== "OWNER") throw new TeamError("forbidden");
  if (actor.id === userId) throw new TeamError("self");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new TeamError("forbidden");
  if (target.deactivatedAt) throw new TeamError("state");
  const handOverTo = options.handOverTo || null;
  const heir = handOverTo ? await db.user.findUnique({ where: { id: handOverTo } }) : null;
  if (handOverTo && (!heir || heir.deactivatedAt || heir.id === userId))
    throw new TeamError("handOver");

  const outcome = await switchOff(target, actor.id, now);
  if (outcome !== "ok") throw new TeamError(outcome);

  // Their invitations can't be used any more; their timers and repeating tasks stop.
  const invites = await db.invite.updateMany({
    where: { createdById: userId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await stopTimersOf(userId, now);
  const series = await db.taskSeries.updateMany({
    where: { creatorId: userId, nextDate: { not: null } },
    data: { nextDate: null },
  });
  const handed = heir ? await handOverTasks(actor, userId, heir.id) : { moved: 0, failed: [] };
  const coAssigned = await leaveCoAssignedTasks(actor, userId);
  const decisions = await releaseDecisions(actor, userId);
  // People under them in the chart get the next manager up.
  await syncPeople();

  await logActivity({
    actorId: actor.id,
    action: "user.deactivated",
    entityType: "User",
    entityId: userId,
    details: {
      name: displayName(target),
      handedOverTo: heir ? displayName(heir) : null,
      moved: handed.moved,
      notMoved: handed.failed,
      coAssigned,
      decisions,
      invitesRevoked: invites.count,
      repeatsStopped: series.count,
    },
  });
  return { moved: handed.moved, notMoved: handed.failed.length };
}

// Back on: they can sign in and hear things again. Tasks handed over stay where they went; their
// repeating tasks stay stopped (they set them up again if needed).
export async function reactivateUser(actor: Actor, userId: string) {
  if (actor.role !== "OWNER") throw new TeamError("forbidden");
  const { count } = await db.user.updateMany({
    where: { id: userId, deactivatedAt: { not: null } },
    data: { deactivatedAt: null, deactivatedById: null },
  });
  if (!count) throw new TeamError("state");
  // Their people in the chart are theirs again.
  await syncPeople();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await logActivity({
    actorId: actor.id,
    action: "user.reactivated",
    entityType: "User",
    entityId: userId,
    details: { name: displayName(user) },
  });
}
