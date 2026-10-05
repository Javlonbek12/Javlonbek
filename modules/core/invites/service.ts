import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import type { Invite, Role } from "@/lib/generated/prisma/client";
import { logActivity } from "@/modules/core/activity/service";
import { ForbiddenError } from "@/modules/core/errors";
import { canInvite, canRevokeInvite, type Actor } from "@/modules/core/permissions";

export const INVITE_TTL_DAYS = 7;

export type InviteStatus =
  "valid" | "invite_invalid" | "invite_used" | "invite_revoked" | "invite_expired";

export function getInviteStatus(
  invite: Pick<Invite, "usedAt" | "revokedAt" | "expiresAt"> | null,
  now = new Date(),
): InviteStatus {
  if (!invite) return "invite_invalid";
  if (invite.usedAt) return "invite_used";
  if (invite.revokedAt) return "invite_revoked";
  if (invite.expiresAt <= now) return "invite_expired";
  return "valid";
}

// URL-safe, also valid as a Telegram /start payload (A-Z a-z 0-9 _ -).
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

// `orgNodeId`: an invite to a specific place in the org chart (owner only) — whoever joins
// with it takes that place: job title and manager come from the chart.
export async function createInvite(actor: Actor, role: Role, now = new Date(), orgNodeId?: string) {
  if (!canInvite(actor.role, role)) throw new ForbiddenError();
  if (orgNodeId) {
    if (actor.role !== "OWNER") throw new ForbiddenError();
    const node = await db.orgNode.findUnique({ where: { id: orgNodeId } });
    if (!node || node.kind !== "POSITION" || node.userId) throw new ForbiddenError();
  }
  const invite = await db.invite.create({
    data: {
      code: generateInviteCode(),
      role,
      createdById: actor.id,
      orgNodeId: orgNodeId ?? null,
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await logActivity({
    actorId: actor.id,
    action: "invite.created",
    entityType: "Invite",
    entityId: invite.id,
    details: { role, orgNodeId: orgNodeId ?? null },
  });
  return invite;
}

// Active invites to places in the org chart, by place.
export async function activePlaceInvites(now = new Date()) {
  const invites = await db.invite.findMany({
    where: { orgNodeId: { not: null }, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  const byNode = new Map<string, (typeof invites)[number]>();
  for (const invite of invites)
    if (!byNode.has(invite.orgNodeId!)) byNode.set(invite.orgNodeId!, invite);
  return byNode;
}

export async function revokeInvite(actor: Actor, inviteId: string, now = new Date()) {
  const invite = await db.invite.findUnique({ where: { id: inviteId } });
  if (!invite || !canRevokeInvite(actor, invite)) throw new ForbiddenError();
  await db.invite.updateMany({
    where: { id: inviteId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await logActivity({
    actorId: actor.id,
    action: "invite.revoked",
    entityType: "Invite",
    entityId: inviteId,
  });
}

// Active invites the actor may see: OWNER sees all, MANAGER own, MEMBER none.
export async function listActiveInvites(actor: Actor, now = new Date()) {
  if (actor.role === "MEMBER") return [];
  return db.invite.findMany({
    where: {
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(actor.role === "MANAGER" ? { createdById: actor.id } : {}),
    },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function findInviteByCode(code: string) {
  return db.invite.findUnique({ where: { code } });
}
