import { db } from "@/lib/db";
import { syncPeople } from "@/modules/org/service";
import type { Role } from "@/lib/generated/prisma/client";
import { t } from "@/lib/i18n";
import { logActivity } from "@/modules/core/activity/service";
import type { TelegramProfile } from "@/modules/core/auth/telegram";
import { ForbiddenError } from "@/modules/core/errors";
import { getInviteStatus, type InviteStatus } from "@/modules/core/invites/service";
import { notify } from "@/modules/core/notifications/service";
import { canChangeRole, type Actor } from "@/modules/core/permissions";

import { displayName } from "./display-name";

export type LoginFailure = Exclude<InviteStatus, "valid"> | "invite_required";

export type LoginResult =
  | { ok: true; user: { id: string; role: Role; firstName: string }; created: boolean }
  | { ok: false; reason: LoginFailure };

// One entry point for web login and bot /start:
// - known Telegram user -> refresh profile and log in;
// - nobody in the system yet -> the first user becomes OWNER;
// - otherwise a valid invite is required; it is used up atomically.
export async function loginWithTelegram(
  profile: TelegramProfile,
  inviteCode?: string,
  now = new Date(),
): Promise<LoginResult> {
  const profileData = {
    firstName: profile.firstName,
    lastName: profile.lastName ?? null,
    telegramUsername: profile.username ?? null,
    photoUrl: profile.photoUrl ?? null,
  };

  const result = await db.$transaction(
    async (tx): Promise<LoginResult & { inviterId?: string }> => {
      const existing = await tx.user.findUnique({ where: { telegramId: profile.telegramId } });
      if (existing) {
        const user = await tx.user.update({ where: { id: existing.id }, data: profileData });
        return { ok: true, user, created: false };
      }

      if ((await tx.user.count()) === 0) {
        const user = await tx.user.create({
          data: { ...profileData, telegramId: profile.telegramId, role: "OWNER" },
        });
        await logActivity(
          {
            actorId: user.id,
            action: "user.joined",
            entityType: "User",
            entityId: user.id,
            details: { role: "OWNER", firstUser: true },
          },
          tx,
        );
        return { ok: true, user, created: true };
      }

      if (!inviteCode) return { ok: false, reason: "invite_required" };
      const invite = await tx.invite.findUnique({ where: { code: inviteCode } });
      const status = getInviteStatus(invite, now);
      if (!invite || status !== "valid") {
        return { ok: false, reason: status === "valid" ? "invite_invalid" : status };
      }

      // Claim the invite only if nobody else did in the meantime.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return { ok: false, reason: "invite_used" };

      const user = await tx.user.create({
        data: {
          ...profileData,
          telegramId: profile.telegramId,
          role: invite.role,
          invitedById: invite.createdById,
        },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { usedById: user.id } });
      // An invite to a place in the org chart: the new person takes it (if still free).
      if (invite.orgNodeId) {
        await tx.orgNode.updateMany({
          where: { id: invite.orgNodeId, userId: null },
          data: { userId: user.id, personName: null },
        });
      }
      await logActivity(
        {
          actorId: user.id,
          action: "user.joined",
          entityType: "User",
          entityId: user.id,
          details: { role: invite.role, inviteId: invite.id },
        },
        tx,
      );
      return { ok: true, user, created: true, inviterId: invite.createdById };
    },
    { isolationLevel: "Serializable" },
  );

  // Job title and manager follow the chart once the person is in it.
  if (result.ok && result.created) await syncPeople();
  if (result.ok && result.inviterId) {
    await notify(result.inviterId, {
      type: "invite_accepted",
      title: t("notifications.events.inviteAcceptedTitle"),
      body: t("notifications.events.inviteAcceptedBody", { name: displayName(result.user) }),
      link: "/team",
    });
  }
  if (!result.ok) return result;
  return { ok: true, user: result.user, created: result.created };
}

export async function linkBotChat(userId: string, chatId: bigint) {
  await db.user.update({ where: { id: userId }, data: { botChatId: chatId } });
}

export async function listUsers() {
  return db.user.findMany({ orderBy: [{ createdAt: "asc" }] });
}

export async function changeRole(actor: Actor, targetUserId: string, newRole: Role) {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target || !canChangeRole(actor, target, newRole)) throw new ForbiddenError();
  if (target.role === newRole) return;

  await db.user.update({ where: { id: target.id }, data: { role: newRole } });
  await logActivity({
    actorId: actor.id,
    action: "user.role_changed",
    entityType: "User",
    entityId: target.id,
    details: { from: target.role, to: newRole },
  });
  await notify(target.id, {
    type: "role_changed",
    title: t("notifications.events.roleChangedTitle"),
    body: t("notifications.events.roleChangedBody", { role: t(`roles.${newRole}`) }),
  });
}
