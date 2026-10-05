// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { GET as exportPlanogram } from "@/app/api/planograms/[id]/export/route";
import { GET as reportDownload } from "@/app/api/reports/[format]/route";
import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, getRoleConfig, saveRoleConfig } from "@/modules/core/access/config";
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
