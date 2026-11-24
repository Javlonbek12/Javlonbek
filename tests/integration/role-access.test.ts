// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { GET as exportPlanogram } from "@/app/api/planograms/[id]/export/route";
import { GET as reportDownload } from "@/app/api/reports/[format]/route";
import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, getRoleConfig, saveRoleConfig } from "@/modules/core/access/config";
import { leadScope } from "@/modules/connect/report";
import {
  canLeadConnect,
  canSeeConnect,
  canSetConnectRules,
  importConnectFiles,
} from "@/modules/connect/service";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { listTasks } from "@/modules/tasks/service";
import { parseTaskFilters } from "@/modules/tasks/filters";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const SECRET = "test-session-secret-test-session-secret";
const request = (url: string, userId: string) =>
  new Request(url, {
    headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(userId, SECRET)}` },
  });

describe("roles and access", () => {
  beforeEach(resetDb);

  it("by default a manager sees their people's tasks only; 'all' opens the whole team", async () => {
    const owner = await createTestUser("OWNER");
    const boss = await createTestUser("MANAGER");
    const mine = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    await db.user.update({ where: { id: mine.id }, data: { managerId: boss.id } });
    const make = (title: string, assigneeId: string) =>
      db.task.create({
        data: {
          title,
          creatorId: owner.id,
          assigneeId,
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });
    await make("Задача моего сотрудника", mine.id);
    await make("Чужая задача", other.id);

    const titles = async () =>
      (
        await listTasks(await withAccess(boss), parseTaskFilters({ scope: "team" }), "2026-10-05")
      ).map((t) => t.title);
    expect(await titles()).toEqual(["Задача моего сотрудника"]);

    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MANAGER: { modules: [], taskScope: "all" },
    });
    expect((await titles()).sort()).toEqual(["Задача моего сотрудника", "Чужая задача"]);

    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MANAGER: { modules: [], taskScope: "own" },
    });
    expect(await titles()).toEqual([]);
  });

  it("only the owner changes roles; employees always see only their own tasks", async () => {
    const owner = await createTestUser("OWNER");
    const boss = await createTestUser("MANAGER");
    await expect(saveRoleConfig(boss, DEFAULT_ROLE_CONFIG)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      saveRoleConfig(owner, { MANAGER: { modules: ["nope"], taskScope: "all" } }),
    ).rejects.toMatchObject({ code: "invalid" });
    await saveRoleConfig(owner, {
      MANAGER: { modules: ["planograms"], taskScope: "all" },
      MEMBER: { modules: ["team"], taskScope: "all" },
    });
    expect((await getRoleConfig()).MEMBER.taskScope).toBe("own");
  });

  it("gives the people the owner named the whole of Connect, whatever their role has", async () => {
    const owner = await createTestUser("OWNER");
    const boss = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    const other = await createTestUser("MEMBER");
    // By default an employee has no Connect at all; a manager leads it for their own TSMs only.
    expect(canSeeConnect(await withAccess(member))).toBe(false);
    expect(canLeadConnect(await withAccess(boss))).toBe(true);
    expect(leadScope(await withAccess(boss), {})).toEqual(new Set());

    // The owner (who has it anyway), a stranger and a repeat are not kept.
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      connectLeads: [member.id, owner.id, "no-such-user", member.id],
    });
    expect((await getRoleConfig()).connectLeads).toEqual([member.id]);
    const lead = await withAccess(member);
    expect(lead.access).toMatchObject({ connectLead: true, taskScope: "own" });
    expect(lead.access.modules).toEqual([...DEFAULT_ROLE_CONFIG.MEMBER.modules, "connect"]);
    expect(canSeeConnect(lead)).toBe(true);
    expect(canLeadConnect(lead)).toBe(true);
    // Every zone, like the owner; the norms stay the owner's.
    expect(leadScope(lead, {})).toBeNull();
    expect(canSetConnectRules(lead)).toBe(false);
    // Uploading is theirs too: the call gets past the access check.
    await expect(importConnectFiles(lead, [])).rejects.toMatchObject({ code: "empty" });
    await expect(importConnectFiles(await withAccess(other), [])).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await withAccess(other)).access.connectLead).toBeUndefined();
    expect((await withAccess(owner)).access.connectLead).toBeUndefined();

    // Saving the roles alone keeps the people; the section off for a role does not take it away.
    await saveRoleConfig(owner, {
      MANAGER: { modules: [], taskScope: "team" },
      MEMBER: { modules: [], taskScope: "own" },
    });
    expect((await getRoleConfig()).connectLeads).toEqual([member.id]);
    expect(canSeeConnect(await withAccess(boss))).toBe(false);
    expect(canLeadConnect(await withAccess(member))).toBe(true);
    // A named manager sees every zone too.
    await saveRoleConfig(owner, { ...DEFAULT_ROLE_CONFIG, connectLeads: [boss.id] });
    expect(leadScope(await withAccess(boss), {})).toBeNull();
    // Unticked: back to what the role has.
    expect(canSeeConnect(await withAccess(member))).toBe(false);
    await expect(
      saveRoleConfig(owner, { ...DEFAULT_ROLE_CONFIG, connectLeads: "everyone" }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("closes switched-off sections for direct links and downloads too", async () => {
    const owner = await createTestUser("OWNER");
    const boss = await createTestUser("MANAGER");
    const report = "http://localhost/api/reports/pdf?preset=week";
    const params = { params: Promise.resolve({ format: "pdf" }) };
    // Reports are off for managers by default.
    expect((await reportDownload(request(report, boss.id), params)).status).toBe(403);
    expect((await reportDownload(request(report, owner.id), params)).status).toBe(200);
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MANAGER: { modules: ["reports"], taskScope: "team" },
    });
    expect((await reportDownload(request(report, boss.id), params)).status).toBe(200);

    // Planograms are off by default: the export API answers 401 as for a stranger.
    const url = "http://localhost/api/planograms/x/export?format=png";
    const ctx = { params: Promise.resolve({ id: "x" }) };
    expect((await exportPlanogram(request(url, boss.id), ctx)).status).toBe(401);
  });
});
