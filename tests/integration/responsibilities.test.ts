// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { answerHelpQuestion } from "@/modules/ai/help";
import type { ModelCall } from "@/modules/ai/run";
import { withAccess } from "@/modules/core/access/actor";
import { DEFAULT_ROLE_CONFIG, saveRoleConfig } from "@/modules/core/access/config";
import { saveOrgNode } from "@/modules/org/service";
import { search } from "@/modules/search/service";
import type { SearchGroup } from "@/modules/search/types";
import {
  confirmDuty,
  deleteDuty,
  dutiesOfPerson,
  KEEP_PLACE,
  listDuties,
  ownerText,
  saveDuty,
} from "@/modules/team/responsibilities";
import { suggestResponsibilities, suggestSummary } from "@/modules/team/responsibility-suggest";
import { createTestUser, resetDb } from "@/tests/helpers/db";

// «Команда» → «Обязанности»: rights, the tie to the org chart position, the search, the AI help
// and the suggestions from the data. All people and texts are synthetic.

const TZ = "Asia/Tashkent";

async function team() {
  const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
  const boss = await createTestUser("MANAGER", { firstName: "Тестовый руководитель" });
  const otherBoss = await createTestUser("MANAGER", { firstName: "Тестовый руководитель Б" });
  const member = await createTestUser("MEMBER", { firstName: "Тестовый сотрудник" });
  const stranger = await createTestUser("MEMBER", { firstName: "Тестовый сотрудник Б" });
  await db.user.update({ where: { id: member.id }, data: { managerId: boss.id } });
  await db.user.update({ where: { id: stranger.id }, data: { managerId: otherBoss.id } });
  return {
    owner: await withAccess(owner),
    boss: await withAccess(boss),
    otherBoss: await withAccess(otherBoss),
    member: await withAccess(member),
    stranger: await withAccess(stranger),
  };
}

const duty = (title: string, responsible: string, extra: Record<string, string> = {}) => ({
  title,
  description: "",
  responsible,
  deputyId: "",
  module: "",
  ...extra,
});

const titlesOf = (list: Awaited<ReturnType<typeof listDuties>>) =>
  list.groups.flatMap((g) => g.duties.map((d) => d.title)).sort();

describe("responsibilities: rights", () => {
  beforeEach(resetDb);

  it("the owner edits all, a manager own and team's, an employee nobody's", async () => {
    const { owner, boss, member, stranger } = await team();

    const forMember = await saveDuty(boss, null, duty("Тестовые отчёты", member.id));
    expect(forMember.duty).toMatchObject({ status: "CONFIRMED", canEdit: true });
    await saveDuty(boss, null, duty("Тестовое планирование", boss.id));
    await expect(saveDuty(boss, null, duty("Чужое", stranger.id))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(saveDuty(member, null, duty("Своё", member.id))).rejects.toMatchObject({
      code: "forbidden",
    });
    const strangers = await saveDuty(owner, null, duty("Тестовая доставка", stranger.id));
    await expect(deleteDuty(boss, strangers.duty.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      saveDuty(boss, strangers.duty.id, duty("Переименовано", stranger.id)),
    ).rejects.toMatchObject({ code: "forbidden" });
    // The stand-in can't be the responsible themselves.
    await expect(
      saveDuty(owner, null, duty("Тест", member.id, { deputyId: member.id })),
    ).rejects.toMatchObject({ code: "invalid" });

    // Everyone with «Команда» reads every confirmed item; only editors get the buttons.
    const asMember = await listDuties(member);
    expect(titlesOf(asMember)).toEqual([
      "Тестовая доставка",
      "Тестовое планирование",
      "Тестовые отчёты",
    ]);
    expect(asMember.groups.every((g) => g.duties.every((d) => !d.canEdit))).toBe(true);

    await deleteDuty(boss, forMember.duty.id);
    expect(await db.responsibility.count()).toBe(2);
    expect(
      (await db.activityLog.findMany({ where: { entityType: "Responsibility" } })).map(
        (a) => a.action,
      ),
    ).toEqual(expect.arrayContaining(["responsibility.created", "responsibility.deleted"]));
  });

  it("shows a suggestion only to those who may confirm it", async () => {
    const { owner, boss, otherBoss, member, stranger } = await team();
    const suggestion = await db.responsibility.create({
      data: {
        title: "Предложение по данным (тест)",
        userId: member.id,
        status: "SUGGESTED",
        source: "По данным за тест",
      },
    });
    const sees = async (actor: typeof owner) =>
      titlesOf(await listDuties(actor)).includes("Предложение по данным (тест)");
    expect(await sees(owner)).toBe(true);
    expect(await sees(boss)).toBe(true);
    expect(await sees(otherBoss)).toBe(false);
    expect(await sees(member)).toBe(false);
    expect(await sees(stranger)).toBe(false);
    expect((await dutiesOfPerson(member, member.id)).own).toEqual([]);

    await expect(confirmDuty(otherBoss, suggestion.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await confirmDuty(boss, suggestion.id);
    expect(await sees(member)).toBe(true);
    expect((await dutiesOfPerson(member, member.id)).own.map((d) => d.status)).toEqual([
      "CONFIRMED",
    ]);
  });
});

describe("responsibilities: tied to the org chart position", () => {
  beforeEach(resetDb);

  it("follows the position when people change, and stays as a vacancy", async () => {
    const { owner, member, stranger } = await team();
    const place = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый координатор",
      userId: member.id,
    });
    const { duty: saved } = await saveDuty(
      owner,
      null,
      duty("Отправка тестовых материалов", member.id, { deputyId: stranger.id }),
    );
    const row = await db.responsibility.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row).toMatchObject({ positionId: place.id, userId: member.id });
    // Without a position: the person only.
    const loose = await saveDuty(owner, null, duty("Без места", stranger.id));
    expect(
      await db.responsibility.findUniqueOrThrow({ where: { id: loose.duty.id } }),
    ).toMatchObject({ positionId: null, userId: stranger.id });

    // Another person takes the place: the item is theirs now.
    const newcomer = await withAccess(
      await createTestUser("MEMBER", { firstName: "Тестовый новичок" }),
    );
    await saveOrgNode(owner, place.id, {
      kind: "POSITION",
      title: "Тестовый координатор",
      userId: newcomer.id,
    });
    expect((await dutiesOfPerson(owner, newcomer.id)).own.map((d) => d.title)).toEqual([
      "Отправка тестовых материалов",
    ]);
    expect((await dutiesOfPerson(owner, member.id)).own).toEqual([]);
    // The stand-in sees whom they replace.
    expect((await dutiesOfPerson(owner, stranger.id)).deputyFor.map((d) => d.title)).toEqual([
      "Отправка тестовых материалов",
    ]);

    // The place becomes vacant: the item stays, shown as a vacancy.
    await saveOrgNode(owner, place.id, { kind: "POSITION", title: "Тестовый координатор" });
    const vacant = (await listDuties(owner)).groups.find((g) => g.owner.kind === "place")!;
    expect(vacant.duties.map((d) => d.title)).toEqual(["Отправка тестовых материалов"]);
    expect(ownerText(vacant.owner)).toBe("Вакансия · Тестовый координатор");
    // Editing it keeps it on the place.
    await saveDuty(
      owner,
      saved.id,
      duty("Отправка тестовых материалов", KEEP_PLACE, { description: "Тест" }),
    );
    expect(await db.responsibility.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      positionId: place.id,
      description: "Тест",
    });
  });
});

describe("responsibilities: search and AI help", () => {
  beforeEach(resetDb);

  const hits = (groups: SearchGroup[]) =>
    groups.find((g) => g.key === "responsibilities")?.hits ?? [];

  it("finds responsibilities by title or description within «Команда»", async () => {
    const { owner, member } = await team();
    await saveDuty(
      owner,
      null,
      duty("Отправка POSM-материалов (тест)", member.id, { description: "Склад и регионы" }),
    );
    await db.responsibility.create({
      data: { title: "POSM-предложение (тест)", userId: member.id, status: "SUGGESTED" },
    });

    const found = hits(await search(member, "posm", TZ));
    expect(found).toEqual([
      expect.objectContaining({
        title: "Отправка POSM-материалов (тест)",
        subtitle: "Тестовый сотрудник",
        href: `/team/${member.id}?tab=profile#responsibilities`,
        kind: "responsibility",
      }),
    ]);
    expect(hits(await search(member, "склад", TZ)).map((h) => h.title)).toEqual([
      "Отправка POSM-материалов (тест)",
    ]);
    expect(hits(await search(owner, "posm", TZ))).toHaveLength(2);

    await saveRoleConfig(owner, {
      ...DEFAULT_ROLE_CONFIG,
      MEMBER: { ...DEFAULT_ROLE_CONFIG.MEMBER, modules: ["meetings"] },
    });
    expect(hits(await search(await withAccess(member), "posm", TZ))).toEqual([]);
  });

  it("gives the AI help the confirmed items, not the suggestions", async () => {
    const { owner, member } = await team();
    await saveDuty(owner, null, duty("Отправка POSM-материалов (тест)", member.id));
    await db.responsibility.create({
      data: { title: "Скрытое предложение (тест)", userId: member.id, status: "SUGGESTED" },
    });
    const call = vi.fn<ModelCall>().mockResolvedValue({
      output: { answer: "Тестовый сотрудник.", links: [], covered: true },
      inputTokens: 1,
      outputTokens: 1,
    });

    for (const asker of [member, owner]) {
      await answerHelpQuestion(
        asker,
        { question: "Кто отвечает за POSM?", history: [], path: "/" },
        { call, locale: "ru", guide: "# Тестовое руководство" },
      );
    }
    for (const [request] of vi.mocked(call).mock.calls) {
      expect(request.prompt).toContain(
        "<responsibilities>\n- Отправка POSM-материалов (тест) → Тестовый сотрудник",
      );
      expect(request.prompt).not.toContain("Скрытое предложение");
      // The guide stays the cached block.
      expect(request.context).toBe("<user_guide>\n# Тестовое руководство\n</user_guide>");
    }
  });
});

describe("responsibilities: suggestions from the data", () => {
  beforeEach(resetDb);

  const areas = (list: { title: string; module?: string | null }[]): ModelCall =>
    vi.fn<ModelCall>().mockResolvedValue({
      output: {
        areas: list.map((a) => ({
          title: a.title,
          description: "Тестовое описание по данным.",
          module: a.module ?? null,
        })),
      },
      inputTokens: 10,
      outputTokens: 10,
    });

  async function data() {
    const { owner, member, stranger } = await team();
    const place = await saveOrgNode(owner, null, {
      kind: "POSITION",
      title: "Тестовый координатор",
      userId: member.id,
    });
    const task = (title: string, extra: Record<string, unknown> = {}) =>
      db.task.create({
        data: { title, creatorId: member.id, assigneeId: member.id, status: "DONE", ...extra },
      });
    await task("Командная задача А (тест)");
    await task("Командная задача Б (тест)", { status: "IN_PROGRESS", project: "Тест-проект" });
    await task("Личная задача (секрет)", { isPersonal: true });
    await db.meeting.create({
      data: { title: "Тестовая планёрка", startsAt: new Date(), createdById: member.id },
    });
    await db.employeeNote.create({
      data: { employeeId: member.id, authorId: owner.id, kind: "GROWTH", text: "Заметка (секрет)" },
    });
    // One task is too little to say anything.
    await db.task.create({
      data: { title: "Одна задача (тест)", creatorId: stranger.id, assigneeId: stranger.id },
    });
    const confirmed = await db.responsibility.create({
      data: { title: "Тестовые отчёты", userId: member.id, positionId: place.id },
    });
    await db.responsibility.create({
      data: { title: "Старое предложение", userId: member.id, status: "SUGGESTED" },
    });
    return { owner, member, stranger, place, confirmed };
  }

  it("suggests from team work only, replaces old suggestions, keeps confirmed ones", async () => {
    const { member, place, confirmed } = await data();
    const call = areas([
      { title: "тестовые  отчёты" },
      { title: "Планёрки команды", module: "meetings" },
      { title: "Командные задачи", module: "no-such-section" },
    ]);

    const result = await suggestResponsibilities({ call, days: 30 });
    expect(result).toMatchObject({
      analysed: 1,
      suggestions: 2,
      skipped: 4,
      errors: 0,
      stoppedAtLimit: false,
    });
    expect(call).toHaveBeenCalledTimes(1);
    const { prompt, system } = vi.mocked(call).mock.calls[0]![0];
    expect(prompt).toContain("Командная задача А (тест)");
    expect(prompt).toContain("Тест-проект (1)");
    expect(prompt).toContain("Тестовая планёрка");
    expect(prompt).toContain("Position: Тестовый координатор");
    expect(prompt).not.toContain("Личная задача");
    expect(prompt).not.toContain("секрет");
    expect(prompt).not.toContain("Тестовый сотрудник");
    expect(system).toContain("Base everything only on the given data");

    const rows = await db.responsibility.findMany({ orderBy: { sortOrder: "asc" } });
    expect(rows.find((r) => r.id === confirmed.id)).toMatchObject({
      title: "Тестовые отчёты",
      status: "CONFIRMED",
    });
    const suggested = rows.filter((r) => r.status === "SUGGESTED");
    expect(suggested).toEqual([
      expect.objectContaining({
        title: "Планёрки команды",
        module: "meetings",
        userId: member.id,
        positionId: place.id,
        createdById: null,
      }),
      expect.objectContaining({ title: "Командные задачи", module: null }),
    ]);
    expect(suggested[0]!.source).toMatch(
      /^По данным за \d\d\.\d\d–\d\d\.\d\d: 2 задачи, 1 встреча$/,
    );
    expect(await db.aiUsage.findFirst()).toMatchObject({ function: "responsibilitiesSuggest" });

    // Run again: the person's suggestions are replaced; the confirmed one stays.
    await suggestResponsibilities({ call: areas([{ title: "Новое направление" }]), days: 30 });
    const after = await db.responsibility.findMany({ select: { title: true, status: true } });
    expect(after).toHaveLength(2);
    expect(after).toEqual(
      expect.arrayContaining([
        { title: "Тестовые отчёты", status: "CONFIRMED" },
        { title: "Новое направление", status: "SUGGESTED" },
      ]),
    );
  });

  it("prints counts only, and keeps old suggestions when the AI fails", async () => {
    await data();
    const failing = vi.fn<ModelCall>().mockRejectedValue(new Error("boom"));
    const result = await suggestResponsibilities({ call: failing, days: 30 });
    expect(result).toMatchObject({ analysed: 1, suggestions: 0, errors: 1 });
    expect(await db.responsibility.count({ where: { title: "Старое предложение" } })).toBe(1);

    const text = suggestSummary(result);
    expect(text).toContain("People analysed: 1, suggestions: 0");
    expect(text).not.toMatch(/Тестов|задача|предложение|координатор/i);
  });

  it("stops at the daily AI limit and writes nothing without an AI key", async () => {
    const { owner } = await data();
    await expect(suggestResponsibilities({ days: 30 })).rejects.toMatchObject({
      code: "not_configured",
    });
    expect(await db.responsibility.count({ where: { status: "SUGGESTED" } })).toBe(1);

    await db.aiUsage.createMany({
      data: Array.from({ length: 200 }, () => ({
        userId: owner.id,
        function: "help",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
      })),
    });
    const call = areas([{ title: "Не будет" }]);
    const result = await suggestResponsibilities({ call, days: 30 });
    expect(result).toMatchObject({ analysed: 0, stoppedAtLimit: true });
    expect(call).not.toHaveBeenCalled();
    expect(suggestSummary(result)).toContain("daily AI limit");
  });
});
