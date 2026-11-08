// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/search/route";
import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import { createSessionToken, SESSION_COOKIE } from "@/modules/core/auth/session";
import { search } from "@/modules/search/service";
import type { SearchGroup } from "@/modules/search/types";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const SECRET = "test-session-secret-test-session-secret";
const TZ = "Asia/Tashkent";

const titles = (groups: SearchGroup[], key: SearchGroup["key"]) =>
  groups.find((group) => group.key === key)?.hits.map((hit) => hit.title) ?? [];

async function people() {
  const owner = await createTestUser("OWNER", { firstName: "Владелец (тест)" });
  const member = await createTestUser("MEMBER", { firstName: "Сотрудник (тест)" });
  const other = await createTestUser("MEMBER", { firstName: "Другой сотрудник (тест)" });
  return { owner, member, other };
}

describe("global search", () => {
  beforeEach(resetDb);

  it("finds only the tasks and meetings the person may open", async () => {
    const { owner, member, other } = await people();
    const task = (title: string, data: Record<string, unknown>) =>
      db.task.create({ data: { title, creatorId: owner.id, assigneeId: owner.id, ...data } });
    await task("Тест: отчёт сотрудника", {
      assigneeId: member.id,
      status: "APPROVED",
      approvedAt: new Date(),
    });
    await task("Тест: отчёт другого", {
      assigneeId: other.id,
      status: "APPROVED",
      approvedAt: new Date(),
    });
    await task("Тест: отчёт личный", {
      isPersonal: true,
      creatorId: other.id,
      assigneeId: other.id,
    });
    const meeting = (title: string, participants: string[]) =>
      db.meeting.create({
        data: {
          title,
          startsAt: new Date("2026-11-10T05:00:00Z"),
          createdById: owner.id,
          participants: { create: participants.map((userId) => ({ userId })) },
        },
      });
    await meeting("Тест: отчётная встреча", [member.id]);
    await meeting("Тест: отчёт без сотрудника", [other.id]);

    const found = await search(await withAccess(member), "отчёт", TZ);
    expect(titles(found, "tasks")).toEqual(["Тест: отчёт сотрудника"]);
    expect(titles(found, "meetings")).toEqual(["Тест: отчётная встреча"]);

    // The owner sees every team task, but not someone's personal one.
    const all = await search(await withAccess(owner), "отчёт", TZ);
    expect(titles(all, "tasks").sort()).toEqual(["Тест: отчёт другого", "Тест: отчёт сотрудника"]);
    expect(titles(all, "meetings")).toHaveLength(2);
  });

  it("finds people, sections and actions within the role's rights", async () => {
    const { owner, member } = await people();
    await db.user.update({ where: { id: member.id }, data: { position: "Мерчендайзер" } });

    const asOwner = await search(await withAccess(owner), "сотрудник", TZ);
    expect(titles(asOwner, "people").sort()).toEqual([
      "Другой сотрудник (тест)",
      "Сотрудник (тест)",
    ]);
    expect(titles(asOwner, "navigation")).toContain("Пригласить сотрудника");
    const card = asOwner.find((g) => g.key === "people")!.hits.find((h) => h.title.startsWith("С"));
    expect(card).toMatchObject({ href: `/team/${member.id}`, subtitle: "Мерчендайзер" });

    // By default an employee has the team list but can't invite.
    const asMember = await search(await withAccess(member), "сотрудник", TZ);
    expect(titles(asMember, "people")).toEqual(["Другой сотрудник (тест)", "Сотрудник (тест)"]);
    expect(titles(asMember, "navigation")).toEqual([]);
    // With «Команда» turned off for employees, people aren't found.
    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: { ...DEFAULT_ROLE_CONFIG.MEMBER, modules: ["meetings", "planograms", "content"] },
    });
    const withoutTeam = await search(await withAccess(member), "сотрудник", TZ);
    expect(titles(withoutTeam, "people")).toEqual([]);

    const sections = await search(await withAccess(member), "задач", TZ);
    expect(titles(sections, "navigation")).toEqual(["Задачи", "Новая задача"]);
  });

  it("finds content posts and projects", async () => {
    const { owner, member } = await people();
    await db.contentPost.create({
      data: {
        title: "Тест: новые цены",
        publishDate: new Date("2026-11-12"),
        createdById: owner.id,
      },
    });
    await db.project.create({ data: { name: "Тест: новый запуск", createdById: owner.id } });

    const asMember = await search(await withAccess(member), "тест: нов", TZ);
    expect(titles(asMember, "content")).toEqual(["Тест: новые цены"]);
    // Projects are not switched on for employees by default.
    expect(titles(asMember, "projects")).toEqual([]);

    const asOwner = await search(await withAccess(owner), "тест: нов", TZ);
    expect(titles(asOwner, "projects")).toEqual(["Тест: новый запуск"]);
  });

  it("answers over HTTP for a signed-in person only", async () => {
    const { member } = await people();
    const url = "http://localhost:3000/api/search?q=%D0%B7%D0%B0%D0%B4%D0%B0%D1%87";
    expect((await GET(new Request(url))).status).toBe(401);

    const response = await GET(
      new Request(url, {
        headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(member.id, SECRET)}` },
      }),
    );
    expect(response.status).toBe(200);
    const { groups } = (await response.json()) as { groups: SearchGroup[] };
    expect(titles(groups, "navigation")).toContain("Задачи");
  });

  it("ignores queries shorter than two letters", async () => {
    const { owner } = await people();
    expect(await search(await withAccess(owner), " з ", TZ)).toEqual([]);
  });
});
