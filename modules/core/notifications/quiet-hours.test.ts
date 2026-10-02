import { describe, expect, it } from "vitest";

import { isInQuietHours } from "./quiet-hours";

const TZ = "Asia/Tashkent"; // UTC+5
const at = (tashkentTime: string) => new Date(`2026-10-02T${tashkentTime}:00+05:00`);

describe("isInQuietHours", () => {
  it("is off when not configured", () => {
    expect(isInQuietHours(at("23:00"), TZ, null, null)).toBe(false);
  });

  it("handles a range that crosses midnight (22:00–08:00)", () => {
    const start = 22 * 60;
    const end = 8 * 60;
    expect(isInQuietHours(at("23:30"), TZ, start, end)).toBe(true);
    expect(isInQuietHours(at("03:00"), TZ, start, end)).toBe(true);
    expect(isInQuietHours(at("08:00"), TZ, start, end)).toBe(false);
    expect(isInQuietHours(at("12:00"), TZ, start, end)).toBe(false);
  });

  it("handles a daytime range (13:00–14:00)", () => {
    expect(isInQuietHours(at("13:30"), TZ, 780, 840)).toBe(true);
    expect(isInQuietHours(at("14:00"), TZ, 780, 840)).toBe(false);
  });

  it("uses the user's timezone, not UTC", () => {
    // 23:30 in Tashkent is 18:30 UTC.
    expect(isInQuietHours(at("23:30"), "UTC", 22 * 60, 8 * 60)).toBe(false);
  });
});
