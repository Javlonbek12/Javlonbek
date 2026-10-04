import { beforeEach, describe, expect, it } from "vitest";

import { createPlan, getPlanDetail, listPlansWithProgress } from "@/modules/tasks/plan-service";
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
      "approve",
    );
    await createTask(owner, taskInput({ assigneeId: member.id, planId: month.id }), "approve");
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
});
