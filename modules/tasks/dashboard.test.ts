import { describe, expect, it } from "vitest";

import { weeklyDone } from "./dashboard";

describe("weekly done", () => {
  it("counts done tasks per week, oldest first, ending with the current week", () => {
    const weeks = weeklyDone(
      ["2026-10-05", "2026-10-07", "2026-10-02", "2026-09-01"],
      "2026-10-07",
      3,
    );
    expect(weeks).toEqual([
      { start: "2026-09-21", count: 0 },
      { start: "2026-09-28", count: 1 },
      { start: "2026-10-05", count: 2 },
    ]);
  });
});
