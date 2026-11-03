import { describe, expect, it } from "vitest";

import { nextOccurrence, weekdayOf, type RepeatRule } from "./repeat";

const rule = (r: Partial<RepeatRule>): RepeatRule => ({
  frequency: "DAILY",
  interval: 1,
  weekdays: [],
  monthDay: null,
  until: null,
  anchor: "2026-11-02", // a Monday
  ...r,
});

// Next dates one after another, starting from the anchor.
function series(r: RepeatRule, count: number) {
  const dates: string[] = [];
  let at: string | null = r.anchor;
  while (dates.length < count && (at = nextOccurrence(r, at))) dates.push(at);
  return dates;
}

describe("repeating tasks: next due date", () => {
  it("knows the weekday", () => {
    expect(weekdayOf("2026-11-02")).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(7);
  });

  it("every day and every 3 days", () => {
    expect(series(rule({}), 3)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(series(rule({ interval: 3 }), 2)).toEqual(["2026-11-05", "2026-11-08"]);
  });

  it("every week on the anchor's weekday, or on chosen days", () => {
    expect(series(rule({ frequency: "WEEKLY" }), 2)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(series(rule({ frequency: "WEEKLY", weekdays: [3, 5] }), 4)).toEqual([
      "2026-11-04",
      "2026-11-06",
      "2026-11-11",
      "2026-11-13",
    ]);
  });

  it("every second week keeps to the weeks counted from the first", () => {
    expect(series(rule({ frequency: "WEEKLY", interval: 2, weekdays: [1, 5] }), 4)).toEqual([
      "2026-11-06",
      "2026-11-16",
      "2026-11-20",
      "2026-11-30",
    ]);
  });

  it("every month on a day, the last day in shorter months", () => {
    expect(series(rule({ frequency: "MONTHLY", monthDay: 5 }), 2)).toEqual([
      "2026-11-05",
      "2026-12-05",
    ]);
    expect(series(rule({ frequency: "MONTHLY", monthDay: 31, anchor: "2027-01-31" }), 3)).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
    // Without a day: the anchor's own.
    expect(series(rule({ frequency: "MONTHLY", interval: 3 }), 2)).toEqual([
      "2027-02-02",
      "2027-05-02",
    ]);
  });

  it("every year, 29 February on 28 February in other years", () => {
    expect(series(rule({ frequency: "YEARLY", anchor: "2028-02-29" }), 2)).toEqual([
      "2029-02-28",
      "2030-02-28",
    ]);
  });

  it("stops after the until date", () => {
    expect(series(rule({ frequency: "WEEKLY", until: "2026-11-20" }), 5)).toEqual([
      "2026-11-09",
      "2026-11-16",
    ]);
  });

  it("starts from any date after the anchor", () => {
    expect(nextOccurrence(rule({ frequency: "WEEKLY", weekdays: [5] }), "2026-11-25")).toBe(
      "2026-11-27",
    );
  });
});
