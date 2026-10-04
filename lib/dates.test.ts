import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  daysBetween,
  formatMonth,
  isDateString,
  isoWeekNumber,
  monthGrid,
  startOfWeek,
  todayInTimezone,
} from "./dates";

describe("dates", () => {
  it("validates date strings", () => {
    expect(isDateString("2026-10-02")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("02.10.2026")).toBe(false);
  });

  it("computes today in the user's timezone", () => {
    // 20:00 UTC is already the next day in Tashkent (UTC+5).
    const now = new Date("2026-10-02T20:00:00Z");
    expect(todayInTimezone("Asia/Tashkent", now)).toBe("2026-10-03");
    expect(todayInTimezone("UTC", now)).toBe("2026-10-02");
  });

  it("adds days and months across boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-10-04")).toBe("2026-09-28"); // Sunday -> previous Monday
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05"); // Monday
  });

  it("builds a month grid of full weeks", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid.at(-1)?.at(-1)).toBe("2026-11-01");
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it("computes ISO week numbers", () => {
    expect(isoWeekNumber("2026-10-02")).toBe(40);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
  });

  it("formats a month in Russian", () => {
    expect(formatMonth("2026-10-01")).toBe("Октябрь 2026");
  });
});
