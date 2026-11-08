import { describe, expect, it } from "vitest";

import { clockText, durationText, isForgottenTimer } from "./time-format";

describe("time texts", () => {
  it("says hours and minutes, leaving out a zero part", () => {
    expect(durationText(135)).toEqual({ key: "tasks.time.hm", values: { h: 2, m: 15 } });
    expect(durationText(120)).toEqual({ key: "tasks.time.h", values: { h: 2 } });
    expect(durationText(45)).toEqual({ key: "tasks.time.m", values: { m: 45 } });
    expect(durationText(0)).toEqual({ key: "tasks.time.m", values: { m: 0 } });
  });

  it("shows a running timer as h:mm:ss", () => {
    expect(clockText(0)).toBe("0:00:00");
    expect(clockText((3600 + 12 * 60 + 34) * 1000 + 900)).toBe("1:12:34");
    expect(clockText(-5)).toBe("0:00:00");
  });

  it("calls a timer forgotten after 10 hours or once the day has changed where the person is", () => {
    const tz = "Asia/Tashkent"; // UTC+5
    // Started 09:00 local, now 18:59 local: an ordinary long day.
    expect(isForgottenTimer("2026-11-08T04:00:00Z", new Date("2026-11-08T13:59:00Z"), tz)).toBe(
      false,
    );
    // Ten hours and a minute.
    expect(isForgottenTimer("2026-11-08T04:00:00Z", new Date("2026-11-08T14:01:00Z"), tz)).toBe(
      true,
    );
    // Started 23:30 local, now 00:10 local the next day: the day changed.
    expect(isForgottenTimer("2026-11-08T18:30:00Z", new Date("2026-11-08T19:10:00Z"), tz)).toBe(
      true,
    );
  });
});
