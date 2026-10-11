import type { Role } from "@/lib/generated/prisma/enums";

// `access` (role settings) is attached at the entry points; without it the role's full rights apply.
export type Actor = {
  id: string;
  role: Role;
  access?: { taskScope: "all" | "team" | "own"; teamIds: string[]; modules: string[] };
};

// Roles that `actorRole` is allowed to invite. There is only one OWNER.
export function invitableRoles(actorRole: Role): Role[] {
  if (actorRole === "OWNER") return ["MANAGER", "MEMBER", "LAWYER"];
  if (actorRole === "MANAGER") return ["MEMBER"];
  return [];
}

export function canInvite(actorRole: Role, inviteRole: Role): boolean {
  return invitableRoles(actorRole).includes(inviteRole);
}

// Only the OWNER changes roles, never their own and never to/from OWNER.
export function canChangeRole(actor: Actor, target: Actor, newRole: Role): boolean {
  return (
    actor.role === "OWNER" &&
    actor.id !== target.id &&
    target.role !== "OWNER" &&
    newRole !== "OWNER"
  );
}

export function canRevokeInvite(actor: Actor, invite: { createdById: string }): boolean {
  if (actor.role === "OWNER") return true;
  return actor.role === "MANAGER" && invite.createdById === actor.id;
}

export function canSendTestNotification(actor: Actor, targetUserId: string): boolean {
  return actor.id === targetUserId || actor.role === "OWNER" || actor.role === "MANAGER";
}
