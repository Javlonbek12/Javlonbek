import { describe, expect, it } from "vitest";

import { chartWeeks, parsePeriod, presetPeriod, previousPeriod } from "./period";

// Sunday 2026-10-04 (weeks start on Monday).
const TODAY = "2026-10-04";

describe("report periods", () => {
  it("builds the presets", () => {
    expect(presetPeriod("week", TODAY)).toEqual({ from: "2026-09-28", to: TODAY });
    expect(presetPeriod("lastWeek", TODAY)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetPeriod("month", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(presetPeriod("lastMonth", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetPeriod("quarter", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(presetPeriod("quarter", "2026-08-15")).toEqual({ from: "2026-07-01", to: "2026-08-15" });
  });

  it("takes custom dates, rejects bad ones and falls back to this week", () => {
    expect(parsePeriod({ from: "2026-09-01", to: "2026-09-15" }, TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
      preset: null,
    });
    expect(parsePeriod({ from: "2026-09-15", to: "2026-09-01" }, TODAY).preset).toBe("week");
    expect(parsePeriod({ from: "2024-01-01", to: "2026-01-01" }, TODAY).preset).toBe("week");
    expect(parsePeriod({ preset: "lastMonth" }, TODAY)).toMatchObject({
      from: "2026-09-01",
      preset: "lastMonth",
    });
    expect(parsePeriod({ preset: "nonsense" }, TODAY).preset).toBe("week");
  });

  it("compares with the period of the same length right before", () => {
    expect(previousPeriod({ from: "2026-09-28", to: "2026-10-04" })).toEqual({
      from: "2026-09-21",
      to: "2026-09-27",
    });
    expect(previousPeriod({ from: "2026-09-01", to: "2026-09-30" })).toEqual({
      from: "2026-08-02",
      to: "2026-08-31",
    });
  });

  it("shows 8 to 13 weeks ending with the period's last week", () => {
    const week = chartWeeks({ from: "2026-09-28", to: TODAY });
    expect(week).toHaveLength(8);
    expect(week.at(-1)).toBe("2026-09-28");
    expect(chartWeeks({ from: "2026-07-01", to: "2026-09-30" })).toHaveLength(13);
    expect(chartWeeks({ from: "2026-01-01", to: "2026-09-30" })).toHaveLength(13);
  });
});
