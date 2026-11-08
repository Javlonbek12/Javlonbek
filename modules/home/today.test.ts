import { describe, expect, it } from "vitest";

import type { TaskView } from "@/modules/tasks/service";

import { planDay, summarizeTeam } from "./today";

const task = (id: string, over: Partial<TaskView>) =>
  ({ id, title: id, status: "APPROVED", dueDate: null, ...over }) as TaskView;

describe("«Сегодня»", () => {
  it("my day: overdue first, then due today, then in progress; handed-in work is left out", () => {
    const today = "2026-11-09";
    const { day, upcoming, handedIn } = planDay(
      [
        task("in progress, no date", { status: "IN_PROGRESS" }),
        task("today", { dueDate: today }),
        task("overdue", { dueDate: "2026-11-05" }),
        task("handed in", { status: "IN_REVIEW", dueDate: "2026-11-01" }),
        task("tomorrow", { dueDate: "2026-11-10" }),
        task("in 2 days", { dueDate: "2026-11-11" }),
        task("in progress, tomorrow", { status: "IN_PROGRESS", dueDate: "2026-11-10" }),
      ],
      today,
    );
    expect(day.map((t) => [t.id, t.when])).toEqual([
      ["overdue", "overdue"],
      ["today", "today"],
      ["in progress, tomorrow", "inProgress"],
      ["in progress, no date", "inProgress"],
    ]);
    expect(upcoming.map((t) => t.id)).toEqual(["tomorrow", "in 2 days"]);
    expect(handedIn).toBe(1);
  });

  it("my team: busiest with overdue first, idle people counted apart", () => {
    const at = (day: string) => new Date(`${day}T00:00:00Z`);
    const team = summarizeTeam(
      [
        { id: "a", name: "Анна" },
        { id: "b", name: "Борис" },
        { id: "c", name: "Вера" },
      ],
      [
        { assigneeId: "a", status: "IN_PROGRESS", dueDate: at("2026-11-12") },
        { assigneeId: "b", status: "IN_PROGRESS", dueDate: at("2026-11-02") },
        { assigneeId: "b", status: "IN_REVIEW", dueDate: at("2026-11-01") },
      ],
      "2026-11-09",
    );
    expect(team.rows).toEqual([
      { id: "b", name: "Борис", open: 2, inProgress: 1, overdue: 1, inReview: 1 },
      { id: "a", name: "Анна", open: 1, inProgress: 1, overdue: 0, inReview: 0 },
    ]);
    expect(team).toMatchObject({ idle: 1, more: 0, overdue: 1 });
  });
});
