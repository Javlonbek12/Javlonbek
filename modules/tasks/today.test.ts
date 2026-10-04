import { describe, expect, it } from "vitest";

import { classifyByDueDate, isOverdue } from "./today";

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
});
