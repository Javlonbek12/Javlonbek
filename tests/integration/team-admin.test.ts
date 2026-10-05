import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createInvite } from "@/modules/core/invites/service";
import { loginWithTelegram } from "@/modules/core/users/service";
import { saveOrgNode } from "@/modules/org/service";
import { importProject } from "@/modules/projects/import";
import { teamFix, teamReport } from "@/modules/team/admin";
import { createTestUser, resetDb, testProfile } from "@/tests/helpers/db";

describe("team places and fixes", () => {
  beforeEach(resetDb);

  async function chart(ownerId: string) {
    const owner = { id: ownerId, role: "OWNER" as const };
    const lead = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый лидер",
      personName: "Тестовый Владелец",
    });
    const sub = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый лидер группы",
      personName: "Тестовый Нодир",
      parentId: lead.id,
    });
    const junior = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый ассистент",
      personName: "Тестовый Мурод",
      parentId: sub.id,
    });
    return { lead, sub, junior };
  }

  it("a person joining with a plain invite takes the place written with their name", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый Владелец" });
    const { sub } = await chart(owner.id);
    const invite = await createInvite(owner, "MEMBER");
    await loginWithTelegram(testProfile(5_100_001n, "Тестовый Нодир"), invite.code);
    const joined = await db.user.findUniqueOrThrow({ where: { telegramId: 5_100_001n } });
    expect(await db.orgNode.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      userId: joined.id,
      personName: null,
    });
    // The owner's own place got linked too, so the manager is set.
    expect(joined).toMatchObject({ position: "Тестовый лидер группы", managerId: owner.id });
  });

  it("fixes a role, a place and a project lead; managers follow the role", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Владелец" });
    const nodir = await createTestUser("MEMBER", { firstName: "Тестовый Нодир" });
    const murod = await createTestUser("MEMBER", { firstName: "Тестовый Мурод" });
    const { lead } = await chart(owner.id);
    await importProject({
      name: "Тестовый проект",
      phases: [],
      tasks: [{ title: "Тестовая задача", due: "2026-10-20" }],
    });

    const log = await teamFix({
      roles: [{ user: "Тестовый Нодир", role: "MANAGER" }],
      places: [{ place: "Тестовый Владелец", user: "Владелец" }],
      leads: [{ project: "Тестовый проект", user: "Тестовый Нодир" }],
    });
    expect(log).toEqual([
      "role: Тестовый Нодир → MANAGER",
      "place: Тестовый Владелец → Владелец",
      "linked by name: 2",
      "lead: Тестовый проект → Тестовый Нодир (open tasks moved)",
    ]);
    expect((await db.orgNode.findUniqueOrThrow({ where: { id: lead.id } })).userId).toBe(owner.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: nodir.id } })).toMatchObject({
      role: "MANAGER",
      managerId: owner.id,
    });
    // Murod's nearest manager above is Nodir now that Nodir is a manager.
    expect((await db.user.findUniqueOrThrow({ where: { id: murod.id } })).managerId).toBe(nodir.id);
    expect((await db.task.findFirstOrThrow()).assigneeId).toBe(nodir.id);
    expect(await teamReport()).toContain("Тестовый проект: lead Тестовый Нодир");

    await expect(teamFix({ roles: [{ user: "Никто", role: "MEMBER" }] })).rejects.toThrow(/Никто/);
  });
});
