import { describe, expect, it } from "vitest";

import { calendarRange, parseCalendarParams, shiftCalendar } from "./calendar";

describe("calendar", () => {
  it("month view covers full weeks around the month", () => {
    const range = calendarRange("month", "2026-10-15");
    expect(range.from).toBe("2026-09-28");
    expect(range.to).toBe("2026-11-02");
    expect(range.days).toHaveLength(35);
  });

  it("week view starts on Monday", () => {
    expect(calendarRange("week", "2026-10-02")).toMatchObject({
      from: "2026-09-28",
      to: "2026-10-05",
    });
  });

  it("moves by a month, a week or a day", () => {
    expect(shiftCalendar("month", "2026-10-15", 1)).toBe("2026-11-01");
    expect(shiftCalendar("week", "2026-10-02", -1)).toBe("2026-09-21");
    expect(shiftCalendar("day", "2026-10-31", 1)).toBe("2026-11-01");
  });

  it("falls back to today and month view on bad input", () => {
    expect(parseCalendarParams({ mode: "year", date: "bad" }, "2026-10-02")).toEqual({
      mode: "month",
      date: "2026-10-02",
    });
  });
});
