import { describe, expect, it } from "vitest";

import { layoutBars, timelineStart } from "./timeline";

describe("layoutBars", () => {
  const from = "2026-10-05";

  it("places a bar from start date to due date", () => {
    expect(layoutBars([{ id: "a", startDate: "2026-10-06", dueDate: "2026-10-08" }], from)).toEqual(
      [{ id: "a", startCol: 1, span: 3, clippedStart: false, clippedEnd: false }],
    );
  });

  it("a task without a start date is a one-day bar on its due date", () => {
    expect(
      layoutBars([{ id: "a", startDate: null, dueDate: "2026-10-05" }], from)[0],
    ).toMatchObject({
      startCol: 0,
      span: 1,
    });
  });

  it("clips bars that go outside the window", () => {
    expect(
      layoutBars([{ id: "a", startDate: "2026-09-01", dueDate: "2026-12-01" }], from, 28)[0],
    ).toEqual({
      id: "a",
      startCol: 0,
      span: 28,
      clippedStart: true,
      clippedEnd: true,
    });
  });
});

describe("timelineStart", () => {
  it("starts on the Monday a week before today by default", () => {
    expect(timelineStart({}, "2026-10-02")).toBe("2026-09-21");
    expect(timelineStart({ from: "2026-10-08" }, "2026-10-02")).toBe("2026-10-05");
  });
});
