import { describe, expect, it } from "vitest";

import { classifyByDueDate, countTaskStates, isLateWork, isOverdue, taskState } from "./today";

describe("classifyByDueDate", () => {
  const tasks = [
    { id: 1, status: "IN_PROGRESS" as const, dueDate: "2026-10-02" },
    { id: 2, status: "APPROVED" as const, dueDate: "2026-10-01" },
    { id: 3, status: "DONE" as const, dueDate: "2026-09-01" },
    { id: 4, status: "DRAFT" as const, dueDate: null },
    { id: 5, status: "IN_REVIEW" as const, dueDate: "2026-10-05" },
  ];

  it("splits open tasks into due today and overdue", () => {
    const { dueToday, overdue } = classifyByDueDate(tasks, "2026-10-02");
    expect(dueToday.map((t) => t.id)).toEqual([1]);
    expect(overdue.map((t) => t.id)).toEqual([2]);
  });

  it("closed tasks are never overdue", () => {
    expect(isOverdue(tasks[2], "2026-10-02")).toBe(false);
  });

  it("in task lists, handed-in work is not late", () => {
    const handedIn = { status: "IN_REVIEW" as const, dueDate: "2026-10-01" };
    expect(isOverdue(handedIn, "2026-10-02")).toBe(true);
    expect(isLateWork(handedIn, "2026-10-02")).toBe(false);
    expect(isLateWork(tasks[1], "2026-10-02")).toBe(true);
  });
});

describe("taskState and countTaskStates", () => {
  const today = "2026-10-02";

  it("puts each task in one state; handed-in work is never late", () => {
    expect(taskState({ status: "IN_REVIEW", dueDate: "2026-09-01" }, today)).toBe("inReview");
    expect(taskState({ status: "IN_PROGRESS", dueDate: "2026-09-01" }, today)).toBe("late");
    expect(taskState({ status: "IN_PROGRESS", dueDate: today }, today)).toBe("inWork");
    expect(taskState({ status: "APPROVED", dueDate: null }, today)).toBe("notStarted");
    expect(taskState({ status: "PENDING_APPROVAL", dueDate: "2026-09-01" }, today)).toBe("late");
    expect(taskState({ status: "DONE", dueDate: "2026-09-01" }, today)).toBe("done");
  });

  it("counts add up to the total, cancelled ones left out", () => {
    const counts = countTaskStates(
      [
        { status: "IN_PROGRESS", dueDate: today },
        { status: "APPROVED", dueDate: today },
        { status: "APPROVED", dueDate: "2026-10-09" },
        { status: "IN_PROGRESS", dueDate: "2026-09-30" },
        { status: "IN_REVIEW", dueDate: "2026-09-30" },
        { status: "DONE", dueDate: "2026-09-30" },
        { status: "CANCELLED", dueDate: "2026-09-30" },
      ],
      today,
    );
    expect(counts).toEqual({
      total: 6,
      done: 1,
      late: 1,
      inReview: 1,
      inWork: 1,
      notStarted: 2,
      dueToday: 2,
    });
  });
});
