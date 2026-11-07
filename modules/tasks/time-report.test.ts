import { describe, expect, it } from "vitest";

import { entryDay, groupTimeReport, type TimeReportEntry } from "./time-report";

const entry = (over: Partial<TimeReportEntry>): TimeReportEntry => ({
  userId: "u1",
  userName: "Анна",
  taskId: "t1",
  taskTitle: "Отчёт",
  taskStatus: "IN_PROGRESS",
  estimateMinutes: null,
  minutes: 30,
  startedAt: new Date("2026-11-03T10:00:00Z"),
  manual: false,
  ...over,
});

describe("time report", () => {
  it("a timer counts for the day it started in the viewer's zone; a hand entry for its date", () => {
    // 21:30 UTC on 2 Nov is already 3 Nov in Tashkent (UTC+5).
    const late = new Date("2026-11-02T21:30:00Z");
    expect(entryDay({ startedAt: late, manual: false }, "Asia/Tashkent")).toBe("2026-11-03");
    expect(entryDay({ startedAt: late, manual: false }, "UTC")).toBe("2026-11-02");
    const day = new Date("2026-11-02T00:00:00Z");
    expect(entryDay({ startedAt: day, manual: true }, "America/New_York")).toBe("2026-11-02");
  });

  it("sums by person and task, most time first (then by name), only inside the period", () => {
    const report = groupTimeReport(
      [
        entry({ minutes: 30 }),
        entry({ minutes: 45, taskId: "t2", taskTitle: "Планограмма", estimateMinutes: 60 }),
        entry({ minutes: 15 }),
        entry({ userId: "u2", userName: "Борис", minutes: 200 }),
        // Outside the period (4 Nov in Tashkent) and an empty entry.
        entry({ userId: "u3", userName: "Вера", startedAt: new Date("2026-11-03T20:00:00Z") }),
        entry({ userId: "u3", userName: "Вера", minutes: 0 }),
      ],
      { from: "2026-11-02", to: "2026-11-03" },
      "Asia/Tashkent",
    );
    expect(report.totalMinutes).toBe(290);
    expect(report.taskCount).toBe(2);
    expect(report.people.map((p) => [p.name, p.minutes])).toEqual([
      ["Борис", 200],
      ["Анна", 90],
    ]);
    expect(report.people[1]!.tasks).toEqual([
      { id: "t1", title: "Отчёт", status: "IN_PROGRESS", estimateMinutes: null, minutes: 45 },
      { id: "t2", title: "Планограмма", status: "IN_PROGRESS", estimateMinutes: 60, minutes: 45 },
    ]);
  });
});
