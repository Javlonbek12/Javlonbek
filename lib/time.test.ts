import { describe, expect, it } from "vitest";

import {
  formatTimeOfDay,
  isValidTimezone,
  minutesOfDayInTimezone,
  parseTimeOfDay,
  utcToZonedLocal,
  zonedLocalToUtc,
} from "./time";

describe("minutesOfDayInTimezone", () => {
  it("converts UTC to Tashkent time (UTC+5)", () => {
    const date = new Date("2026-10-02T20:30:00Z");
    expect(minutesOfDayInTimezone(date, "Asia/Tashkent")).toBe(1 * 60 + 30);
    expect(minutesOfDayInTimezone(date, "UTC")).toBe(20 * 60 + 30);
  });
});

describe("parseTimeOfDay / formatTimeOfDay", () => {
  it("parses valid times", () => {
    expect(parseTimeOfDay("22:00")).toBe(1320);
    expect(parseTimeOfDay("7:05")).toBe(425);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("abc")).toBeNull();
  });

  it("formats minutes as HH:MM", () => {
    expect(formatTimeOfDay(425)).toBe("07:05");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects garbage", () => {
    expect(isValidTimezone("Asia/Tashkent")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });
});

describe("zonedLocalToUtc / utcToZonedLocal", () => {
  it("converts Tashkent local time to UTC and back", () => {
    const utc = zonedLocalToUtc("2026-10-05T10:00", "Asia/Tashkent");
    expect(utc?.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    expect(utcToZonedLocal(utc!, "Asia/Tashkent")).toBe("2026-10-05T10:00");
  });

  it("handles daylight saving time (Berlin, summer vs winter)", () => {
    expect(zonedLocalToUtc("2026-07-01T12:00", "Europe/Berlin")?.toISOString()).toBe(
      "2026-07-01T10:00:00.000Z",
    );
    expect(zonedLocalToUtc("2026-12-01T12:00", "Europe/Berlin")?.toISOString()).toBe(
      "2026-12-01T11:00:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(zonedLocalToUtc("05.10.2026 10:00", "Asia/Tashkent")).toBeNull();
  });
});
