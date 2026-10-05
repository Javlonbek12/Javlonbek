import { describe, expect, it } from "vitest";

import {
  attention,
  burnUp,
  byResponsible,
  milestones,
  phaseProgress,
  problemsByPriority,
  projectRange,
  projectStats,
  type ProjectTask,
} from "./progress";

const TODAY = "2026-10-07"; // Wednesday

let n = 0;
const task = (over: Partial<ProjectTask>): ProjectTask => ({
  id: `t${++n}`,
  title: `Тестовая задача ${n}`,
  code: null,
  status: "APPROVED",
  priority: "MEDIUM",
  startDate: null,
  dueDate: null,
  completedOn: null,
  phaseId: null,
  responsible: null,
  assigneeName: "Тестовый руководитель",
  isMilestone: false,
  atRisk: false,
  openBlockers: 0,
  ...over,
});

describe("project progress", () => {
  it("counts done, overdue, risk and the planned share; cancelled tasks don't count", () => {
    const tasks = [
      task({ status: "DONE", dueDate: "2026-10-05" }),
      task({ status: "IN_PROGRESS", dueDate: "2026-10-06" }), // overdue
      task({ dueDate: "2026-10-20", atRisk: true }),
      task({ dueDate: "2026-11-01" }),
      task({ status: "CANCELLED", dueDate: "2026-10-01" }),
    ];
    expect(projectStats(tasks, TODAY)).toEqual({
      total: 4,
      done: 1,
      inProgress: 1,
      notStarted: 2,
      overdue: 1,
      atRisk: 1,
      percent: 25,
      plannedDone: 2,
      plannedPercent: 50,
      health: "late",
    });
    expect(projectStats(tasks.slice(2), TODAY).health).toBe("risk");
    expect(projectStats([tasks[0]!], TODAY).health).toBe("done");
    expect(projectStats([], TODAY).health).toBe("empty");
    expect(projectStats([task({ dueDate: "2026-10-30" })], TODAY).health).toBe("onTrack");
  });

  it("gives each phase its state and dates; tasks without a phase get their own group", () => {
    const phases = [
      { id: "p1", title: "Тестовая фаза 1", dueDate: "2026-10-05" },
      { id: "p2", title: "Тестовая фаза 2", dueDate: null },
      { id: "p3", title: "Тестовая фаза 3", dueDate: null },
      { id: "p4", title: "Тестовая фаза 4", dueDate: null },
    ];
    const tasks = [
      task({ phaseId: "p1", status: "DONE", startDate: "2026-10-01", dueDate: "2026-10-05" }),
      task({ phaseId: "p2", startDate: "2026-10-05", dueDate: "2026-10-12" }),
      task({ phaseId: "p3", startDate: "2026-10-20", dueDate: "2026-10-25" }),
      task({ phaseId: "p3", dueDate: "2026-10-28" }),
      task({ dueDate: "2026-10-01" }),
    ];
    const rows = phaseProgress(phases, tasks, TODAY);
    expect(rows.map((r) => r.state)).toEqual(["done", "active", "upcoming", "empty", "late"]);
    expect(rows[2]).toMatchObject({ from: "2026-10-20", to: "2026-10-28", dueDate: "2026-10-28" });
    expect(rows[0]).toMatchObject({ dueDate: "2026-10-05", percent: 100 });
    expect(rows[4]).toMatchObject({ id: null, overdue: 1 });
  });

  it("builds plan vs fact by week, with no fact for future weeks", () => {
    const tasks = [
      task({
        status: "DONE",
        startDate: "2026-09-30",
        dueDate: "2026-10-02",
        completedOn: "2026-10-02",
      }),
      task({ status: "DONE", dueDate: "2026-10-04", completedOn: "2026-10-06" }),
      task({ dueDate: "2026-10-09" }),
      task({ dueDate: "2026-10-16" }),
    ];
    expect(projectRange(tasks)).toEqual({ from: "2026-09-30", to: "2026-10-16" });
    expect(burnUp(tasks, TODAY)).toEqual({
      total: 4,
      weeks: [
        { start: "2026-09-28", planned: 2, actual: 1 },
        { start: "2026-10-05", planned: 3, actual: 2 },
        { start: "2026-10-12", planned: 4, actual: null },
      ],
    });
  });

  it("lists milestones by date and finds the next one", () => {
    const tasks = [
      task({ isMilestone: true, title: "Тестовый запуск", dueDate: "2026-10-19" }),
      task({ isMilestone: true, status: "DONE", dueDate: "2026-10-05" }),
      task({ dueDate: "2026-10-08" }),
    ];
    const result = milestones(tasks, TODAY);
    expect(result.list.map((m) => m.date)).toEqual(["2026-10-05", "2026-10-19"]);
    expect(result.next).toMatchObject({ title: "Тестовый запуск", daysLeft: 12 });
  });

  it("puts each open task in one attention group only", () => {
    const late = task({ dueDate: "2026-10-06", atRisk: true });
    const risky = task({ dueDate: "2026-10-30", atRisk: true });
    const waiting = task({ startDate: "2026-10-06", dueDate: "2026-10-09", openBlockers: 1 });
    const notYet = task({ startDate: "2026-10-12", dueDate: "2026-10-30", openBlockers: 1 });
    const soon = task({ dueDate: "2026-10-14" });
    const later = task({ dueDate: "2026-10-15" });
    const result = attention([late, risky, waiting, notYet, soon, later], TODAY);
    expect(result.overdue).toEqual([late]);
    expect(result.atRisk).toEqual([risky]);
    expect(result.blocked).toEqual([waiting]);
    expect(result.dueSoon).toEqual([soon]);
  });

  it("groups by the responsible from the plan, falling back to the assignee", () => {
    const tasks = [
      task({ responsible: "Тестовая группа", status: "DONE" }),
      task({ responsible: "Тестовая группа", dueDate: "2026-10-01" }),
      task({}),
    ];
    expect(byResponsible(tasks, TODAY)).toEqual([
      { name: "Тестовая группа", total: 2, done: 1, overdue: 1 },
      { name: "Тестовый руководитель", total: 1, done: 0, overdue: 0 },
    ]);
  });

  it("counts problems (overdue or at risk) by priority", () => {
    const tasks = [
      task({ priority: "HIGH", dueDate: "2026-10-01" }),
      task({ priority: "HIGH", atRisk: true, dueDate: "2026-10-30" }),
      task({ priority: "LOW", atRisk: true }),
      task({ priority: "URGENT", dueDate: "2026-10-30" }),
      task({ priority: "MEDIUM", status: "DONE", atRisk: true }),
    ];
    expect(problemsByPriority(tasks, TODAY)).toEqual([
      { priority: "URGENT", count: 0 },
      { priority: "HIGH", count: 2 },
      { priority: "MEDIUM", count: 0 },
      { priority: "LOW", count: 1 },
    ]);
  });
});
