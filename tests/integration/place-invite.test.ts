import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { activePlaceInvites, createInvite } from "@/modules/core/invites/service";
import { loginWithTelegram } from "@/modules/core/users/service";
import { saveOrgNode } from "@/modules/org/service";
import { createTestUser, resetDb, testProfile } from "@/tests/helpers/db";

describe("invites to a place in the org chart", () => {
  beforeEach(resetDb);

  it("puts the person who joins straight into the place, with title and manager", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
    const lead = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый лидер",
      userId: owner.id,
    });
    const place = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый координатор",
      personName: "Тестовый будущий сотрудник",
      parentId: lead.id,
    });

    const invite = await createInvite(owner, "MEMBER", new Date(), place.id);
    expect((await activePlaceInvites()).get(place.id)?.id).toBe(invite.id);

    const result = await loginWithTelegram(
      testProfile(5_000_001n, "Тестовый новичок"),
      invite.code,
    );
    expect(result.ok).toBe(true);
    const joined = await db.user.findUniqueOrThrow({ where: { telegramId: 5_000_001n } });
    expect(joined).toMatchObject({
      role: "MEMBER",
      position: "Тестовый координатор",
      managerId: owner.id,
    });
    expect(await db.orgNode.findUniqueOrThrow({ where: { id: place.id } })).toMatchObject({
      userId: joined.id,
      personName: null,
    });
    expect((await activePlaceInvites()).has(place.id)).toBe(false);
  });

  it("only the owner invites into places, and only into empty ones", async () => {
    const owner = await createTestUser("OWNER");
    const boss = await createTestUser("MANAGER");
    const empty = await saveOrgNode(owner, null, { kind: "POSITION", title: "Тестовая вакансия" });
    const taken = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовое место",
      userId: boss.id,
    });
    await expect(createInvite(boss, "MEMBER", new Date(), empty.id)).rejects.toThrow();
    await expect(createInvite(owner, "MEMBER", new Date(), taken.id)).rejects.toThrow();
  });

  it("if the place was filled meanwhile, the person still joins but is not put there", async () => {
    const owner = await createTestUser("OWNER");
    const place = await saveOrgNode(owner, null, { kind: "POSITION", title: "Тестовая вакансия" });
    const invite = await createInvite(owner, "MEMBER", new Date(), place.id);
    const other = await createTestUser("MEMBER");
    await db.orgNode.update({ where: { id: place.id }, data: { userId: other.id } });

    expect((await loginWithTelegram(testProfile(5_000_002n), invite.code)).ok).toBe(true);
    expect((await db.orgNode.findUniqueOrThrow({ where: { id: place.id } })).userId).toBe(other.id);
  });
});
