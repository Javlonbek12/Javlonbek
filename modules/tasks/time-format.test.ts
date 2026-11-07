import { describe, expect, it } from "vitest";

import { clockText, durationText } from "./time-format";

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
});
