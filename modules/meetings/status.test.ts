import { describe, expect, it } from "vitest";

import { canJoin, meetingPhase, minutesUntil, needsNotes } from "./status";

const at = (time: string) => new Date(`2026-11-09T${time}:00Z`);
const meeting = { startsAt: at("10:00"), durationMinutes: 60, link: "https://example.test/call" };

describe("meeting status", () => {
  it("is upcoming, soon (15 minutes before), live and then past", () => {
    expect(meetingPhase(meeting, at("09:20"))).toBe("upcoming");
    expect(minutesUntil(meeting, at("09:20"))).toBe(40);
    expect(meetingPhase(meeting, at("09:45"))).toBe("soon");
    expect(meetingPhase(meeting, at("10:30"))).toBe("live");
    expect(meetingPhase(meeting, at("11:00"))).toBe("past");
  });

  it("offers «Подключиться» from 15 minutes before until the end, with a link only", () => {
    expect(canJoin(meeting, at("09:40"))).toBe(false);
    expect(canJoin(meeting, at("09:46"))).toBe(true);
    expect(canJoin(meeting, at("10:59"))).toBe(true);
    expect(canJoin(meeting, at("11:01"))).toBe(false);
    expect(canJoin({ ...meeting, link: null }, at("10:10"))).toBe(false);
  });

  it("asks for the outcome once the meeting is over and nothing is written", () => {
    expect(needsNotes({ ...meeting, notes: null }, at("10:30"))).toBe(false);
    expect(needsNotes({ ...meeting, notes: null }, at("11:30"))).toBe(true);
    expect(needsNotes({ ...meeting, notes: { updatedAt: at("11:10") } }, at("11:30"))).toBe(false);
  });
});
