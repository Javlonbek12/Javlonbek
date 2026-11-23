import { describe, expect, it } from "vitest";

import { lineTone, targetTone, toneRank } from "./tone";

describe("the colour of a number against its norm", () => {
  it("a target: met is green, close to it amber, far below red", () => {
    expect(targetTone(95, 95)).toBe("good");
    expect(targetTone(100, 95)).toBe("good");
    // Within 15% of the target (95% → from 80.75%).
    expect(targetTone(94.9, 95)).toBe("warn");
    expect(targetTone(80.75, 95)).toBe("warn");
    expect(targetTone(80.7, 95)).toBe("bad");
    expect(targetTone(0, 95)).toBe("bad");
    // Nothing to judge.
    expect(targetTone(null, 95)).toBeNull();
    expect(targetTone(undefined, 95)).toBeNull();
  });

  it("a line not to fall under: under it is red, the lower half above it amber", () => {
    expect(lineTone(69.9, 70)).toBe("bad");
    expect(lineTone(70, 70)).toBe("warn");
    expect(lineTone(84.9, 70)).toBe("warn");
    expect(lineTone(85, 70)).toBe("good");
    expect(lineTone(null, 70)).toBeNull();
    // A line of 0% is switched off on «Нормы»: no colour at all.
    expect(lineTone(0, 0)).toBeNull();
    expect(lineTone(50, 0)).toBeNull();
  });

  it("the worst first", () => {
    expect(
      (["good", null, "bad", "warn"] as const).slice().sort((a, b) => toneRank(a) - toneRank(b)),
    ).toEqual(["bad", "warn", "good", null]);
  });
});
