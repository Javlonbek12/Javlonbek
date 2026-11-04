import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { withAccess } from "@/modules/core/access/actor";
import { saveRoleConfig } from "@/modules/core/access/config";
import { importProject, type ProjectImport } from "@/modules/projects/import";
import {
  canOpenProjects,
  getProject,
  listProjectCards,
  ProjectError,
  setTaskRisk,
  updateProject,
} from "@/modules/projects/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const TZ = "Asia/Tashkent";
const TODAY = "2026-10-07";

// A plan loaded with its history: what is «Готово» there is done already.
const plan = (): ProjectImport => ({
  historical: true,
  name: "Тестовый проект",
  team: "Тестовая команда",
  lead: "Тестовый руководитель",
  phases: [
    { title: "Тестовая подготовка", due: "2026-10-05" },
    { title: "Тестовый запуск", due: "2026-10-19" },
  ],
  tasks: [
    {
      code: "T01",
      phase: 1,
      title: "Тестовое решение",
      responsible: "Тестовый директор",
      start: "2026-10-01",
      due: "2026-10-05",
      status: "Готово",
      priority: "Высокий",
      result: "Тестовый результат",
    },
    {
      code: "T02",
      phase: 1,
      title: "Тестовая настройка",
      start: "2026-10-01",
      due: "2026-10-06",
      status: "В работе",
      dependsOn: ["T01"],
    },
    {
      code: "T03",
      phase: 2,
      title: "Тестовый запуск для всех",
      due: "2026-10-19",
      status: "Риск",
      milestone: true,
      dependsOn: ["T02"],
    },
    { code: "T04", phase: 2, title: "Тестовая поддержка", start: "2026-10-19", due: "2026-10-31" },
  ],
});

describe("projects", () => {
  beforeEach(resetDb);

  it("loads a plan: phases, statuses, risk, milestones, links; tasks go to the lead", async () => {
    const owner = await createTestUser("OWNER", { firstName: "Тестовый владелец" });
    const lead = await createTestUser("MANAGER", { firstName: "Тестовый руководитель" });
    expect(await importProject(plan())).toMatchObject({
      phases: 2,
      tasks: 4,
      links: 2,
      leadLinked: true,
      replaced: false,
    });
    const tasks = await db.task.findMany({ orderBy: { code: "asc" } });
    expect(tasks.map((t) => [t.code, t.status, t.atRisk, t.isMilestone])).toEqual([
      ["T01", "DONE", false, false],
      ["T02", "IN_PROGRESS", false, false],
      ["T03", "IN_PROGRESS", true, true],
      ["T04", "APPROVED", false, false],
    ]);
    expect(tasks.every((t) => t.assigneeId === lead.id && t.creatorId === owner.id)).toBe(true);
    expect(tasks[0]!.historical).toBe(true);
    // The lead hears about the plan's tasks once, not task by task.
    expect(await db.notification.count({ where: { userId: lead.id } })).toBe(1);
    expect(tasks.every((t) => t.project === "Тестовый проект" && t.approvedAt)).toBe(true);
    expect(tasks[0]).toMatchObject({
      priority: "HIGH",
      responsible: "Тестовый директор",
      description: "Результат: Тестовый результат",
    });

    const view = await getProject(
      await withAccess(owner),
      (await db.project.findFirstOrThrow()).id,
      TZ,
    );
    expect(view?.phases.map((p) => p.title)).toEqual(["Тестовая подготовка", "Тестовый запуск"]);
    expect(view?.tasks.find((t) => t.code === "T03")?.openBlockers).toBe(1);
    const [card] = await listProjectCards(await withAccess(owner), TODAY, TZ);
    expect(card).toMatchObject({
      name: "Тестовый проект",
      lead: "Тестовый руководитель",
      stats: { total: 4, done: 1, overdue: 1, atRisk: 1, health: "late" },
      next: { title: "Тестовый запуск для всех", daysLeft: 12 },
    });

    await expect(importProject(plan())).rejects.toThrow(/already exists/);
    expect(await importProject({ ...plan(), replace: true })).toMatchObject({ replaced: true });
    expect(await db.task.count()).toBe(4);
    expect(await db.project.count()).toBe(1);

    // A new plan (not history): «Готово» waits for the author to accept, «Отложено» is a label.
    const fresh = plan();
    fresh.historical = false;
    fresh.tasks[3]!.status = "Отложено";
    await importProject({ ...fresh, replace: true });
    const again = await db.task.findMany({ orderBy: { code: "asc" } });
    expect(again[0]).toMatchObject({
      status: "IN_REVIEW",
      reviewerId: owner.id,
      historical: false,
    });
    expect(again[3]).toMatchObject({ status: "APPROVED", labels: ["отложено"] });
  });

  it("without a matching lead assigns tasks to the owner; rejects bad plans", async () => {
    const owner = await createTestUser("OWNER");
    expect(await importProject({ ...plan(), lead: "Никто" })).toMatchObject({ leadLinked: false });
    expect((await db.task.findMany()).every((t) => t.assigneeId === owner.id)).toBe(true);
    const bad = plan();
    bad.tasks[1]!.dependsOn = ["T99"];
    await expect(importProject({ ...bad, name: "Тестовый проект 2" })).rejects.toThrow(/T99/);
    expect(await db.project.count()).toBe(1);
    await expect(
      importProject({ ...plan(), name: "Тестовый проект 3", tasks: [{ title: "x", phase: 5 }] }),
    ).rejects.toThrow(/phase 5/);
  });

  it("shows projects to the owner, the lead and people with tasks in it (if switched on)", async () => {
    const owner = await createTestUser("OWNER");
    const lead = await createTestUser("MANAGER", { firstName: "Тестовый руководитель" });
    const outsider = await createTestUser("MEMBER");
    await importProject(plan());
    const id = (await db.project.findFirstOrThrow()).id;

    expect(await getProject(await withAccess(lead), id, TZ)).not.toBeNull();
    expect(await canOpenProjects(await withAccess(lead))).toBe(true);
    expect(await getProject(await withAccess(outsider), id, TZ)).toBeNull();
    expect(await canOpenProjects(await withAccess(outsider))).toBe(false);

    // A task of the project for the outsider: visible once "Projects" is on for employees.
    await db.task.updateMany({ where: { code: "T04" }, data: { assigneeId: outsider.id } });
    expect(await getProject(await withAccess(outsider), id, TZ)).toBeNull();
    await saveRoleConfig(owner, {
      MANAGER: { modules: ["projects"], taskScope: "team" },
      MEMBER: { modules: ["projects"], taskScope: "own" },
    });
    expect(await getProject(await withAccess(outsider), id, TZ)).not.toBeNull();
    expect(await listProjectCards(await withAccess(outsider), TODAY, TZ)).toHaveLength(1);
  });

  it("renames with its tasks, hands open tasks to a new lead, marks risk by rights", async () => {
    const owner = await createTestUser("OWNER");
    const lead = await createTestUser("MANAGER", { firstName: "Тестовый руководитель" });
    const next = await createTestUser("MANAGER");
    const member = await createTestUser("MEMBER");
    await importProject(plan());
    const project = await db.project.findFirstOrThrow();

    await expect(
      updateProject(await withAccess(member), project.id, { name: "Чужой" }),
    ).rejects.toBeInstanceOf(ProjectError);
    // The lead renames but cannot change the lead.
    await updateProject(await withAccess(lead), project.id, {
      name: "Тестовый проект Б",
      leadId: next.id,
    });
    expect(await db.project.findFirstOrThrow()).toMatchObject({
      name: "Тестовый проект Б",
      leadId: lead.id,
    });
    expect(await db.task.count({ where: { project: "Тестовый проект Б" } })).toBe(4);

    await updateProject(
      await withAccess(owner),
      project.id,
      { name: "Тестовый проект Б", leadId: next.id },
      { moveTasks: true },
    );
    const tasks = await db.task.findMany({ orderBy: { code: "asc" } });
    // The done task stays with the previous lead.
    expect(tasks.map((t) => t.assigneeId)).toEqual([lead.id, next.id, next.id, next.id]);

    const t04 = tasks[3]!;
    await expect(setTaskRisk(await withAccess(member), t04.id, true)).rejects.toBeInstanceOf(
      ProjectError,
    );
    await setTaskRisk(await withAccess(next), t04.id, true);
    expect((await db.task.findUniqueOrThrow({ where: { id: t04.id } })).atRisk).toBe(true);
  });
});
