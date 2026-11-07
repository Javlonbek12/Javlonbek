import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  createPlan,
  deletePlan,
  getPlanDetail,
  listPlansWithProgress,
  updatePlan,
} from "@/modules/tasks/plan-service";
import { changeStatus, createTask } from "@/modules/tasks/service";
import { createTestUser, resetDb } from "@/tests/helpers/db";
import { taskInput } from "@/tests/helpers/tasks";

describe("plans", () => {
  beforeEach(resetDb);

  it("year → month → week, with progress rolled up from nested plans", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const year = await createPlan(owner, {
      title: "",
      level: "YEAR",
      date: "2026-05-05",
      parentId: null,
      isPersonal: false,
    });
    const month = await createPlan(owner, {
      title: "Октябрь",
      level: "MONTH",
      date: "2026-10-15",
      parentId: year.id,
      isPersonal: false,
    });
    const week = await createPlan(owner, {
      title: "",
      level: "WEEK",
      date: "2026-10-07",
      parentId: month.id,
      isPersonal: false,
    });
    expect(year.title).toBe("2026");

    const t1 = await createTask(
      owner,
      taskInput({ assigneeId: member.id, planId: week.id }),
      "create",
    );
    await createTask(owner, taskInput({ assigneeId: member.id, planId: month.id }), "create");
    await changeStatus(member, t1.id, "IN_PROGRESS");
    await changeStatus(member, t1.id, "IN_REVIEW");
    await changeStatus(owner, t1.id, "DONE");

    const plans = await listPlansWithProgress(owner);
    const byId = Object.fromEntries(plans.map((p) => [p.id, p.progress.percent]));
    expect(byId[week.id]).toBe(100);
    expect(byId[month.id]).toBe(50);
    expect(byId[year.id]).toBe(50);

    const detail = await getPlanDetail(member, month.id);
    expect(detail?.children.map((c) => c.id)).toEqual([week.id]);
  });

  it("rejects a parent that does not contain the period", async () => {
    const owner = await createTestUser("OWNER");
    const year = await createPlan(owner, {
      title: "",
      level: "YEAR",
      date: "2025-01-01",
      parentId: null,
      isPersonal: false,
    });
    await expect(
      createPlan(owner, {
        title: "",
        level: "MONTH",
        date: "2026-10-01",
        parentId: year.id,
        isPersonal: false,
      }),
    ).rejects.toMatchObject({ code: "plan" });
  });

  it("members create only personal plans, which others do not see", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    await expect(
      createPlan(member, {
        title: "",
        level: "WEEK",
        date: "2026-10-05",
        parentId: null,
        isPersonal: false,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const own = await createPlan(member, {
      title: "Мой",
      level: "WEEK",
      date: "2026-10-05",
      parentId: null,
      isPersonal: true,
    });
    expect((await listPlansWithProgress(owner)).map((p) => p.id)).not.toContain(own.id);
  });

  it("a team task cannot go into a personal plan", async () => {
    const owner = await createTestUser("OWNER");
    const plan = await createPlan(owner, {
      title: "",
      level: "WEEK",
      date: "2026-10-05",
      parentId: null,
      isPersonal: true,
    });
    await expect(
      createTask(owner, taskInput({ assigneeId: owner.id, planId: plan.id })),
    ).rejects.toMatchObject({
      code: "plan",
    });
  });

  it("edits a plan: title, period and parent; nested plans must still fit", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const year = await createPlan(owner, {
      title: "",
      level: "YEAR",
      date: "2026-01-01",
      parentId: null,
      isPersonal: false,
    });
    const october = await createPlan(owner, {
      title: "",
      level: "MONTH",
      date: "2026-10-01",
      parentId: null,
      isPersonal: false,
    });
    const week = await createPlan(owner, {
      title: "Запуск",
      level: "WEEK",
      date: "2026-10-12",
      parentId: october.id,
      isPersonal: false,
    });

    // A title that was just the period follows the new period; the plan joins the year.
    const november = await updatePlan(owner, october.id, {
      title: october.title,
      level: "MONTH",
      date: "2026-10-20",
      parentId: year.id,
    });
    expect(november.parentId).toBe(year.id);
    expect(november.title).toBe(october.title);
    // The week of 12 Oct does not fit into November.
    await expect(
      updatePlan(owner, october.id, {
        title: october.title,
        level: "MONTH",
        date: "2026-11-03",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "planChildren" });
    // A month with weeks cannot become a week either.
    await expect(
      updatePlan(owner, october.id, {
        title: "",
        level: "WEEK",
        date: "2026-10-05",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "planChildren" });
    // The week moves within the month and keeps its own title.
    const moved = await updatePlan(owner, week.id, {
      title: "Запуск ESSE",
      level: "WEEK",
      date: "2026-10-21",
      parentId: october.id,
    });
    expect(moved.title).toBe("Запуск ESSE");
    expect(moved.periodStart.toISOString().slice(0, 10)).toBe("2026-10-19");
    // A week cannot hang under a year.
    await expect(
      updatePlan(owner, week.id, {
        title: "",
        level: "WEEK",
        date: "2026-10-21",
        parentId: year.id,
      }),
    ).rejects.toMatchObject({ code: "plan" });
    // Another manager neither edits nor deletes someone else's team plan.
    await expect(
      updatePlan(manager, week.id, {
        title: "x",
        level: "WEEK",
        date: "2026-10-21",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(deletePlan(manager, week.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await getPlanDetail(manager, week.id))?.canManage).toBe(false);
    expect((await getPlanDetail(owner, week.id))?.canManage).toBe(true);
  });

  it("the owner edits a team plan of a manager; a personal plan only its author", async () => {
    const owner = await createTestUser("OWNER");
    const manager = await createTestUser("MANAGER");
    const team = await createPlan(manager, {
      title: "Команда",
      level: "WEEK",
      date: "2026-10-05",
      parentId: null,
      isPersonal: false,
    });
    const mine = await createPlan(manager, {
      title: "Моё",
      level: "WEEK",
      date: "2026-10-05",
      parentId: null,
      isPersonal: true,
    });
    const renamed = await updatePlan(owner, team.id, {
      title: "Команда 2",
      level: "WEEK",
      date: "2026-10-05",
      parentId: null,
    });
    expect(renamed.title).toBe("Команда 2");
    // A title that was just the period follows the new period.
    const moved = await updatePlan(manager, mine.id, {
      title: "",
      level: "WEEK",
      date: "2026-10-14",
      parentId: null,
    });
    expect(moved.title).toMatch(/^Неделя 42 /);
    const again = await updatePlan(manager, mine.id, {
      title: moved.title,
      level: "WEEK",
      date: "2026-10-21",
      parentId: null,
    });
    expect(again.title).toMatch(/^Неделя 43 /);
    await expect(deletePlan(owner, mine.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await deletePlan(manager, mine.id)).tasks).toBe(0);
  });

  it("deleting a plan keeps its tasks and nested plans", async () => {
    const owner = await createTestUser("OWNER");
    const member = await createTestUser("MEMBER");
    const month = await createPlan(owner, {
      title: "",
      level: "MONTH",
      date: "2026-10-01",
      parentId: null,
      isPersonal: false,
    });
    const week = await createPlan(owner, {
      title: "",
      level: "WEEK",
      date: "2026-10-05",
      parentId: month.id,
      isPersonal: false,
    });
    const task = await createTask(
      owner,
      taskInput({ assigneeId: member.id, planId: month.id }),
      "create",
    );

    expect(await deletePlan(owner, month.id)).toEqual({ tasks: 1 });
    expect(await db.plan.findUnique({ where: { id: month.id } })).toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).planId).toBeNull();
    expect((await db.plan.findUniqueOrThrow({ where: { id: week.id } })).parentId).toBeNull();
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "plan.deleted" } });
    expect(log.details).toMatchObject({ tasks: 1 });
  });
});
