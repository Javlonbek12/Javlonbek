import { describe, expect, it } from "vitest";

import { canEditMeeting, canViewMeeting } from "./access";
import { MAX_OCCURRENCES, weeklyOccurrences } from "./recurrence";

describe("weeklyOccurrences", () => {
  it("repeats every 7 days at the same local time until the end date", () => {
    expect(weeklyOccurrences("2026-10-05T10:00", "2026-10-26")).toEqual([
      "2026-10-05T10:00",
      "2026-10-12T10:00",
      "2026-10-19T10:00",
      "2026-10-26T10:00",
    ]);
  });

  it("a one-off meeting has one occurrence", () => {
    expect(weeklyOccurrences("2026-10-05T10:00", null)).toEqual(["2026-10-05T10:00"]);
  });

  it("is capped at one year", () => {
    expect(weeklyOccurrences("2026-01-05T10:00", "2030-01-01")).toHaveLength(MAX_OCCURRENCES);
  });
});

describe("meeting access", () => {
  const meeting = { createdById: "creator", participantIds: ["p1"] };
  it("creator, participants and OWNER see it; others do not", () => {
    expect(canViewMeeting({ id: "p1", role: "MEMBER" }, meeting)).toBe(true);
    expect(canViewMeeting({ id: "x", role: "OWNER" }, meeting)).toBe(true);
    expect(canViewMeeting({ id: "x", role: "MANAGER" }, meeting)).toBe(false);
  });
  it("only the creator and OWNER edit it", () => {
    expect(canEditMeeting({ id: "p1", role: "MEMBER" }, meeting)).toBe(false);
    expect(canEditMeeting({ id: "creator", role: "MEMBER" }, meeting)).toBe(true);
  });
});
