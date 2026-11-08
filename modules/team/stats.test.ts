import { describe, expect, it } from "vitest";

import {
  averageDurationDays,
  countActive,
  countOverdue,
  onTimeRate,
  weeklyLoad,
  type StatTask,
} from "./stats";

const TODAY = "2026-10-02"; // Friday; week starts 2026-09-28

const task = (overrides: Partial<StatTask>): StatTask => ({
  status: "IN_PROGRESS",
  dueDate: null,
  assignedAt: "2026-09-01",
  completedAt: null,
  estimateMinutes: null,
  ...overrides,
});

const tasks: StatTask[] = [
  task({ status: "IN_PROGRESS", dueDate: "2026-09-30" }), // overdue
  task({ status: "APPROVED", dueDate: "2026-10-05", estimateMinutes: 120 }), // next week
  task({ status: "IN_REVIEW", dueDate: null }),
  task({
    status: "DONE",
    dueDate: "2026-09-25",
    assignedAt: "2026-09-20",
    completedAt: "2026-09-24",
  }), // on time, 4 days
  task({
    status: "DONE",
    dueDate: "2026-09-25",
    assignedAt: "2026-09-20",
    completedAt: "2026-09-27",
  }), // late, 7 days
  task({
    status: "DONE",
    dueDate: "2026-07-10",
    assignedAt: "2026-07-01",
    completedAt: "2026-07-10",
  }), // on time, 70+ days ago
  task({ status: "DONE", dueDate: null, assignedAt: "2026-09-29", completedAt: "2026-09-30" }), // no due date, 1 day
  task({ status: "CANCELLED", dueDate: "2026-09-29" }),
];

describe("employee statistics", () => {
  it("counts active and overdue tasks", () => {
    expect(countActive(tasks)).toBe(3);
    expect(countOverdue(tasks, TODAY)).toBe(1);
  });

  it("doesn't count work on review as overdue, like the task list", () => {
    const handedIn = task({ status: "IN_REVIEW", dueDate: "2026-09-29" });
    expect(countActive([handedIn])).toBe(1);
    expect(countOverdue([handedIn], TODAY)).toBe(0);
  });

  it("computes the on-time share for 30 and 90 days (only tasks with a due date)", () => {
    expect(onTimeRate(tasks, TODAY, 30)).toEqual({ onTime: 1, total: 2, percent: 50 });
    expect(onTimeRate(tasks, TODAY, 90)).toEqual({ onTime: 2, total: 3, percent: 67 });
  });

  it("returns no percentage when nothing was completed", () => {
    expect(onTimeRate([], TODAY, 30)).toEqual({ onTime: 0, total: 0, percent: null });
  });

  it("averages days from hand-over to completion", () => {
    // (4 + 7 + 9 + 1) / 4 = 5.25 → 5.3
    expect(averageDurationDays(tasks, TODAY, 90)).toBe(5.3);
    expect(averageDurationDays([], TODAY)).toBeNull();
  });

  it("builds weekly load around the current week", () => {
    const load = weeklyLoad(tasks, TODAY, 1, 1);
    expect(load).toEqual([
      { weekStart: "2026-09-21", tasks: 2, hours: 0, current: false },
      { weekStart: "2026-09-28", tasks: 1, hours: 0, current: true },
      { weekStart: "2026-10-05", tasks: 1, hours: 2, current: false },
    ]);
  });
});
