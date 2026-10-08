import { describe, expect, it } from "vitest";

import { bucketOf, quickCounts, smartSort } from "./sort";

const TODAY = "2026-10-08";
const task = (
  name: string,
  over: Partial<{
    status: "APPROVED" | "DONE";
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate: string | null;
    createdAt: Date;
  }>,
) => ({
  name,
  status: "APPROVED" as const,
  priority: "MEDIUM" as const,
  dueDate: null as string | null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});

describe("smart sort", () => {
  it("puts overdue first, then today, the week, later, no date, closed; important first inside", () => {
    const tasks = [
      task("done", { status: "DONE", dueDate: "2026-10-01" }),
      task("noDue", {}),
      task("later", { dueDate: "2026-11-01" }),
      task("weekLow", { dueDate: "2026-10-10", priority: "LOW" }),
      task("weekUrgent", { dueDate: "2026-10-12", priority: "URGENT" }),
      task("today", { dueDate: TODAY }),
      task("overdueOld", { dueDate: "2026-10-01" }),
      task("overdueHigh", { dueDate: "2026-10-05", priority: "HIGH" }),
    ];
    expect(smartSort(tasks, TODAY).map((t) => t.name)).toEqual([
      "overdueHigh",
      "overdueOld",
      "today",
      "weekUrgent",
      "weekLow",
      "later",
      "noDue",
      "done",
    ]);
    expect(bucketOf(tasks[0]!, TODAY)).toBe("closed");
  });

  it("counts the quick filters", () => {
    const tasks = [
      task("a", { dueDate: "2026-10-01", priority: "HIGH" }),
      task("b", { dueDate: TODAY }),
      task("c", { dueDate: "2026-10-10", priority: "URGENT" }),
      task("d", {}),
    ];
    expect(quickCounts(tasks, TODAY)).toEqual({
      all: 4,
      overdue: 1,
      today: 1,
      week: 2,
      important: 2,
      noDue: 1,
    });
  });
});
