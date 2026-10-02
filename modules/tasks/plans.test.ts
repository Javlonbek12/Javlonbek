import { describe, expect, it } from "vitest";

import {
  canBeParent,
  normalizePeriodStart,
  periodEnd,
  periodLabel,
  planProgress,
  planSubtreeIds,
} from "./plans";

describe("plan periods", () => {
  it("normalizes the start of a period", () => {
    expect(normalizePeriodStart("YEAR", "2026-10-02")).toBe("2026-01-01");
    expect(normalizePeriodStart("MONTH", "2026-10-02")).toBe("2026-10-01");
    expect(normalizePeriodStart("WEEK", "2026-10-02")).toBe("2026-09-28");
  });

  it("computes the end of a period", () => {
    expect(periodEnd("YEAR", "2026-01-01")).toBe("2027-01-01");
    expect(periodEnd("MONTH", "2026-12-01")).toBe("2027-01-01");
    expect(periodEnd("WEEK", "2026-09-28")).toBe("2026-10-05");
  });

  it("checks the year → month → week hierarchy", () => {
    const year = { level: "YEAR" as const, periodStart: "2026-01-01" };
    const october = { level: "MONTH" as const, periodStart: "2026-10-01" };
    const week = { level: "WEEK" as const, periodStart: "2026-10-05" };
    expect(canBeParent(year, october)).toBe(true);
    expect(canBeParent(october, week)).toBe(true);
    expect(canBeParent(year, week)).toBe(false);
    expect(canBeParent({ level: "YEAR", periodStart: "2025-01-01" }, october)).toBe(false);
    expect(canBeParent({ level: "MONTH", periodStart: "2026-09-01" }, week)).toBe(false);
  });

  it("makes readable labels", () => {
    expect(periodLabel("YEAR", "2026-01-01")).toBe("2026");
    expect(periodLabel("MONTH", "2026-10-01")).toBe("Октябрь 2026");
    expect(periodLabel("WEEK", "2026-10-05")).toMatch(/^Неделя 41 · 5 окт/);
  });
});

describe("planProgress", () => {
  it("counts DONE among not-cancelled tasks", () => {
    expect(planProgress(["DONE", "IN_PROGRESS", "CANCELLED", "DONE"])).toEqual({
      done: 2,
      total: 3,
      percent: 67,
    });
    expect(planProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("planSubtreeIds", () => {
  it("collects nested plans", () => {
    const plans = [
      { id: "y", parentId: null },
      { id: "m", parentId: "y" },
      { id: "w", parentId: "m" },
      { id: "x", parentId: null },
    ];
    expect(planSubtreeIds(plans, "y")).toEqual(["y", "m", "w"]);
  });
});
