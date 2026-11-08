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

  it("my team: due today, overdue, handed in to me and not started; overdue first", () => {
    const today = "2026-11-09";
    const row = (assigneeId: string, status: TaskView["status"], dueDate: string | null) => ({
      assigneeId,
      status,
      dueDate,
      toMe: true,
    });
    const team = summarizeTeam(
      [
        { id: "a", name: "Тест А" },
        { id: "b", name: "Тест Б" },
        { id: "c", name: "Тест В" },
        { id: "d", name: "Тест Г" },
      ],
      [
        // A: due today and three not started — no longer «0 в работе · 0 просрочено».
        row("a", "APPROVED", today),
        row("a", "APPROVED", "2026-11-20"),
        row("a", "APPROVED", null),
        row("a", "APPROVED", "2026-11-12"),
        row("b", "IN_PROGRESS", "2026-11-02"),
        row("b", "IN_REVIEW", "2026-11-01"),
        { ...row("b", "IN_REVIEW", null), toMe: false },
        row("c", "IN_PROGRESS", "2026-11-12"),
      ],
      today,
    );
    expect(team.rows).toEqual([
      { id: "b", name: "Тест Б", open: 3, dueToday: 0, overdue: 1, handedIn: 1, notStarted: 0 },
      { id: "a", name: "Тест А", open: 4, dueToday: 1, overdue: 0, handedIn: 0, notStarted: 4 },
      { id: "c", name: "Тест В", open: 1, dueToday: 0, overdue: 0, handedIn: 0, notStarted: 0 },
    ]);
    expect(team).toMatchObject({ idle: 1, more: 0, overdue: 1 });
  });
});
