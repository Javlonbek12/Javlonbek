import { describe, expect, it } from "vitest";

import { collapseSeries, dayHeading, seriesStep } from "./days";

const at = (day: string) => new Date(`${day}T05:00:00Z`);

describe("meetings by day", () => {
  it("names today and tomorrow and adds the year only for another year", () => {
    expect(dayHeading("2026-11-08", "2026-11-08")).toBe("Сегодня · воскресенье, 8 ноября");
    expect(dayHeading("2026-11-09", "2026-11-08")).toBe("Завтра · понедельник, 9 ноября");
    expect(dayHeading("2027-01-04", "2026-11-08")).toBe("понедельник, 4 января 2027 г.");
  });

  it("shows a series once, with how often, how many follow and until when", () => {
    const rows = collapseSeries([
      { id: "a", seriesId: "s", startsAt: at("2026-11-10") },
      { id: "x", seriesId: null, startsAt: at("2026-11-11") },
      { id: "b", seriesId: "s", startsAt: at("2026-11-17") },
      { id: "c", seriesId: "s", startsAt: at("2026-11-24") },
    ]);
    expect(rows.map((r) => [r.meeting.id, r.step, r.more])).toEqual([
      ["a", "week", 2],
      ["x", null, 0],
    ]);
    expect(rows[0]!.last).toEqual(at("2026-11-24"));
    expect(seriesStep(at("2026-11-10"), at("2026-11-24"))).toBe("twoWeeks");
    expect(seriesStep(at("2026-11-10"), at("2026-12-10"))).toBe("month");
  });
});
