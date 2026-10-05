import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { toDateString } from "@/lib/dates";
import { withAccess } from "@/modules/core/access/actor";
import {
  deletePhase,
  savePhase,
  savePlanSections,
  saveProjectTask,
  shiftProject,
} from "@/modules/projects/plan";
import { createProject, ProjectError } from "@/modules/projects/service";
import { TEMPLATES, templateByKey } from "@/modules/projects/templates";
import { createTestUser, resetDb } from "@/tests/helpers/db";

const day = (d: Date | null) => (d ? toDateString(d) : null);

describe("project templates and plan editing", () => {
  beforeEach(resetDb);

  it("the launch template is consistent: unique codes, known dependencies, start before due", () => {
    const launch = templateByKey("launch")!;
    const tasks = launch.phases.flatMap((p) => p.tasks);
    const codes = new Set(tasks.map((t) => t.code));
    expect(codes.size).toBe(tasks.length);
    for (const task of tasks) {
      expect(task.start).toBeLessThanOrEqual(task.due);
      for (const dep of task.dependsOn ?? []) expect(codes.has(dep)).toBe(true);
    }
    expect(launch.sections).toHaveLength(11);
    expect(TEMPLATES.map((t) => t.key)).toEqual(["blank", "launch"]);
  });

  it("creates a launch project with phases, dated tasks, links and the lead as assignee", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const lead = await createTestUser("MANAGER");
    await expect(
      createProject(owner, { name: "Тестовый запуск", template: "launch" }),
    ).rejects.toBeInstanceOf(ProjectError);

    const project = await createProject(owner, {
      name: "Тестовый запуск",
      template: "launch",
      anchorDate: "2026-12-07",
      leadId: lead.id,
    });
    expect(project).toMatchObject({ template: "launch" });
    expect(day(project.anchorDate)).toBe("2026-12-07");
    const phases = await db.projectPhase.findMany({ where: { projectId: project.id } });
    expect(phases).toHaveLength(4);
    const tasks = await db.task.findMany({ where: { project: "Тестовый запуск" } });
    expect(tasks).toHaveLength(21);
    expect(tasks.every((t) => t.assigneeId === lead.id && t.status === "APPROVED")).toBe(true);
    const start = tasks.find((t) => t.code === "L13")!;
    expect([day(start.startDate), day(start.dueDate), start.isMilestone]).toEqual([
      "2026-12-07",
      "2026-12-07",
      true,
    ]);
    expect(day(tasks.find((t) => t.code === "L01")!.startDate)).toBe("2026-09-14"); // T−12 weeks
    expect(await db.taskDependency.count()).toBeGreaterThan(15);

    // A blank project has nothing.
    const blank = await createProject(owner, { name: "Тестовый пустой", template: "blank" });
    expect(await db.projectPhase.count({ where: { projectId: blank.id } })).toBe(0);
  });

  it("moves open tasks and phase deadlines with the anchor day; closed tasks stay", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const project = await createProject(owner, {
      name: "Тестовый запуск",
      template: "launch",
      anchorDate: "2026-12-07",
    });
    await db.task.updateMany({ where: { code: "L01" }, data: { status: "DONE" } });
    expect(await shiftProject(owner, project.id, "2026-12-14")).toBe(7);
    const tasks = await db.task.findMany();
    expect(day(tasks.find((t) => t.code === "L13")!.dueDate)).toBe("2026-12-14");
    expect(day(tasks.find((t) => t.code === "L01")!.dueDate)).toBe("2026-10-12"); // T−8 weeks, not moved
    const phase = await db.projectPhase.findFirstOrThrow({ where: { sortOrder: 2 } });
    expect(day(phase.dueDate)).toBe("2026-12-21");
    expect(
      day((await db.project.findUniqueOrThrow({ where: { id: project.id } })).anchorDate),
    ).toBe("2026-12-14");
  });

  it("edits phases and tasks; only the owner and the lead may", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const lead = await withAccess(await createTestUser("MANAGER"));
    const member = await withAccess(await createTestUser("MEMBER"));
    const project = await createProject(owner, { name: "Тестовый проект", leadId: lead.id });

    await savePhase(lead, project.id, null, { title: "Тестовая фаза", dueDate: "2026-11-01" });
    const phase = await db.projectPhase.findFirstOrThrow();
    const taskId = await saveProjectTask(lead, project.id, null, {
      title: "Тестовая задача",
      phaseId: phase.id,
      responsible: "Тестовая группа",
      startDate: "2026-10-10",
      dueDate: "2026-10-20",
      isMilestone: true,
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      project: "Тестовый проект",
      phaseId: phase.id,
      assigneeId: lead.id,
      status: "APPROVED",
      isMilestone: true,
    });
    await saveProjectTask(owner, project.id, taskId, {
      title: "Тестовая задача Б",
      dueDate: "2026-10-25",
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
      title: "Тестовая задача Б",
      phaseId: null,
      startDate: null,
    });
    await expect(
      saveProjectTask(owner, project.id, null, {
        title: "x",
        startDate: "2026-10-30",
        dueDate: "2026-10-01",
      }),
    ).rejects.toBeInstanceOf(ProjectError);
    await expect(savePhase(member, project.id, null, { title: "Чужая" })).rejects.toBeInstanceOf(
      ProjectError,
    );

    await deletePhase(owner, project.id, phase.id);
    expect(await db.projectPhase.count()).toBe(0);
  });

  it("keeps the written plan's sections only for templates that have them", async () => {
    const owner = await withAccess(await createTestUser("OWNER"));
    const launch = await createProject(owner, {
      name: "Тестовый запуск",
      template: "launch",
      anchorDate: "2026-12-07",
    });
    await savePlanSections(owner, launch.id, { product: " 3 тестовых SKU ", unknown: "x" });
    const saved = (await db.project.findUniqueOrThrow({ where: { id: launch.id } }))
      .planSections as Record<string, string>;
    expect(saved.product).toBe("3 тестовых SKU");
    expect(saved.unknown).toBeUndefined();
    expect(Object.keys(saved)).toHaveLength(11);
    const blank = await createProject(owner, { name: "Тестовый пустой" });
    await expect(savePlanSections(owner, blank.id, { product: "x" })).rejects.toBeInstanceOf(
      ProjectError,
    );
  });
});
