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

  it("«Ближайшие 7 дней» with «Сегодня» are the same 7 days as the «На 7 дней» chip", () => {
    expect(bucketOf(task("d6", { dueDate: "2026-10-14" }), TODAY)).toBe("week");
    expect(bucketOf(task("d7", { dueDate: "2026-10-15" }), TODAY)).toBe("later");
    const tasks = ["2026-10-08", "2026-10-09", "2026-10-14", "2026-10-15"].map((d) =>
      task(d, { dueDate: d }),
    );
    const inGroups = tasks.filter((t) => ["today", "week"].includes(bucketOf(t, TODAY))).length;
    expect(quickCounts(tasks, TODAY).week).toBe(inGroups);
  });

  it("handed-in work is never overdue: it waits for acceptance", () => {
    const handedIn = { ...task("review", { dueDate: "2026-10-01" }), status: "IN_REVIEW" as const };
    expect(bucketOf(handedIn, TODAY)).toBe("review");
    expect(quickCounts([handedIn], TODAY).overdue).toBe(0);
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
