import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError } from "@/modules/core/errors";
import { changeRole } from "@/modules/core/users/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

describe("changeRole", () => {
  beforeEach(resetDb);

  it("OWNER promotes a member; it is logged and the member is notified", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await changeRole(owner, member.id, "MANAGER");

    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("MANAGER");
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "user.role_changed" } });
    expect(log.details).toEqual({ from: "MEMBER", to: "MANAGER" });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: member.id } });
    expect(notification.type).toBe("role_changed");
  });

  it("MANAGER cannot change roles", async () => {
    await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    await expect(changeRole(manager, member.id, "MANAGER")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nobody can take the OWNER role away or give it", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await expect(changeRole(owner, owner.id, "MEMBER")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeRole(owner, member.id, "OWNER")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
