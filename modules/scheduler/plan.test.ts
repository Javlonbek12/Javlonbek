import { describe, expect, it } from "vitest";

import {
  dueReminderDates,
  isDigestTime,
  localClock,
  overdueRange,
  weeklySummaryWeek,
  workdaysBetween,
} from "./plan";

// Friday 2026-10-02, 03:35 UTC.
const now = new Date("2026-10-02T03:35:00Z");

describe("localClock", () => {
  it("gives local date and time per timezone", () => {
    expect(localClock(now, "Asia/Tashkent")).toEqual({
      date: "2026-10-02",
      minutes: 8 * 60 + 35,
      weekday: 4,
    });
    expect(localClock(now, "Europe/Moscow")).toEqual({
      date: "2026-10-02",
      minutes: 6 * 60 + 35,
      weekday: 4,
    });
    // Still Thursday evening in New York.
    expect(localClock(now, "America/New_York")).toEqual({
      date: "2026-10-01",
      minutes: 23 * 60 + 35,
      weekday: 3,
    });
  });
});

describe("morning digest", () => {
  it("is due at 08:30 in Tashkent but not yet in Moscow", () => {
    expect(isDigestTime(localClock(now, "Asia/Tashkent"), 510)).toBe(true);
    expect(isDigestTime(localClock(now, "Europe/Moscow"), 510)).toBe(false);
  });

  it("respects a custom digest time and skips digests that are very late", () => {
    expect(isDigestTime({ date: "2026-10-02", minutes: 7 * 60, weekday: 4 }, 7 * 60)).toBe(true);
    expect(isDigestTime({ date: "2026-10-02", minutes: 13 * 60, weekday: 4 }, 510)).toBe(false);
  });
});

describe("reminders", () => {
  it("reminds about tomorrow's tasks from 17:00; on Friday from 16:30 for the weekend", () => {
    expect(dueReminderDates({ date: "2026-10-01", minutes: 16 * 60 + 59, weekday: 3 })).toEqual([]);
    expect(dueReminderDates({ date: "2026-10-01", minutes: 17 * 60, weekday: 3 })).toEqual([
      "2026-10-02",
    ]);
    expect(dueReminderDates({ date: "2026-10-02", minutes: 16 * 60 + 29, weekday: 4 })).toEqual([]);
    expect(dueReminderDates({ date: "2026-10-02", minutes: 16 * 60 + 30, weekday: 4 })).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(dueReminderDates({ date: "2026-10-03", minutes: 18 * 60, weekday: 5 })).toEqual([]);
  });

  it("counts working days", () => {
    // Friday → Monday: one working day; Monday → Thursday: three.
    expect(workdaysBetween("2026-10-02", "2026-10-05")).toBe(1);
    expect(workdaysBetween("2026-10-05", "2026-10-08")).toBe(3);
    expect(workdaysBetween("2026-10-05", "2026-10-05")).toBe(0);
  });

  it("reports overdue tasks from 09:00 for the last 7 days", () => {
    expect(overdueRange({ date: "2026-10-02", minutes: 8 * 60, weekday: 4 })).toBeNull();
    expect(overdueRange({ date: "2026-10-02", minutes: 9 * 60, weekday: 4 })).toEqual({
      from: "2026-09-25",
      to: "2026-10-02",
    });
  });

  it("weekly summary on Friday evening only", () => {
    expect(weeklySummaryWeek({ date: "2026-10-02", minutes: 17 * 60, weekday: 4 })).toBe(
      "2026-09-28",
    );
    expect(weeklySummaryWeek({ date: "2026-10-01", minutes: 18 * 60, weekday: 3 })).toBeNull();
  });
});
