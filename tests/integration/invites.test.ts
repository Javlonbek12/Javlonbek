import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError } from "@/modules/core/errors";
import { createInvite, listActiveInvites, revokeInvite } from "@/modules/core/invites/service";
import { loginWithTelegram } from "@/modules/core/users/service";
import { createTestUser, resetDb, testProfile } from "@/tests/helpers/db";

describe("invites", () => {
  beforeEach(resetDb);

  it("MEMBER cannot create invites, MANAGER cannot invite managers", async () => {
    const member = await createTestUser("MEMBER");
    const manager = await createTestUser("MANAGER");
    await expect(createInvite(member, "MEMBER")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvite(manager, "MANAGER")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvite(manager, "MEMBER")).resolves.toMatchObject({ role: "MEMBER" });
  });

  it("logs invite creation in the activity log", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MEMBER");
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: invite.id } });
    expect(log).toMatchObject({ actorId: owner.id, action: "invite.created" });
  });

  it("an expired invite does not work", async () => {
    const owner = await createTestUser("OWNER");
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const invite = await createInvite(owner, "MEMBER", longAgo);
    const result = await loginWithTelegram(testProfile(5000001n), invite.code);
    expect(result).toEqual({ ok: false, reason: "invite_expired" });
  });

  it("a revoked invite does not work", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MEMBER");
    await revokeInvite(owner, invite.id);
    const result = await loginWithTelegram(testProfile(5000001n), invite.code);
    expect(result).toEqual({ ok: false, reason: "invite_revoked" });
  });

  it("an unknown code does not work", async () => {
    await createTestUser("OWNER");
    const result = await loginWithTelegram(testProfile(5000001n), "no-such-code");
    expect(result).toEqual({ ok: false, reason: "invite_invalid" });
  });

  it("MANAGER sees and revokes only own invites", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const ownerInvite = await createInvite(owner, "MEMBER");
    const managerInvite = await createInvite(manager, "MEMBER");

    expect((await listActiveInvites(manager)).map((i) => i.id)).toEqual([managerInvite.id]);
    expect(await listActiveInvites(owner)).toHaveLength(2);
    await expect(revokeInvite(manager, ownerInvite.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("someone a manager invites joins that manager's team", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const invite = await createInvite(manager, "MEMBER");
    const result = await loginWithTelegram(testProfile(5000002n), invite.code);
    if (!result.ok) throw new Error(result.reason);
    expect((await db.user.findUniqueOrThrow({ where: { id: result.user.id } })).managerId).toBe(
      manager.id,
    );
    // Managers have the Team section by default: the link goes to the team list.
    const notification = await db.notification.findFirstOrThrow({ where: { userId: manager.id } });
    expect(notification.link).toBe("/team");
  });

  it("the inviter gets an 'invite accepted' notification", async () => {
    const owner = await createTestUser("OWNER");
    const invite = await createInvite(owner, "MEMBER");
    await loginWithTelegram(testProfile(5000001n, "Тестовый сотрудник 9"), invite.code);
    const notification = await db.notification.findFirstOrThrow({ where: { userId: owner.id } });
    expect(notification.type).toBe("invite_accepted");
    expect(notification.body).toContain("Тестовый сотрудник 9");
  });
});
