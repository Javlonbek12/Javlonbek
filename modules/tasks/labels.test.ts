import { describe, expect, it } from "vitest";

import { MAX_LABELS, parseLabels } from "./labels";

describe("parseLabels", () => {
  it("trims, collapses spaces and drops repeats regardless of case", () => {
    expect(parseLabels(" выставка ,срочно   для HO, Выставка,, ")).toEqual([
      "выставка",
      "срочно для HO",
    ]);
    expect(parseLabels("")).toEqual([]);
  });

  it("keeps labels short and few", () => {
    expect(parseLabels("x".repeat(50))).toEqual(["x".repeat(30)]);
    const many = Array.from({ length: 15 }, (_, i) => `m${i}`).join(",");
    expect(parseLabels(many)).toHaveLength(MAX_LABELS);
  });
});
