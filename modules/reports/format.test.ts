import { describe, expect, it } from "vitest";

import { formatDecimal, formatRange, plural } from "./format";

describe("report formatting", () => {
  it("writes decimals with a comma in Russian and a point in English", () => {
    expect(formatDecimal(7.25)).toBe("7,3");
    expect(formatDecimal(7.25, 1, "en")).toBe("7.3");
    expect(formatDecimal(4)).toBe("4");
  });

  it("makes plurals agree", () => {
    const posts = (n: number) => plural("content.analytics.postsCount", n);
    expect([1, 2, 5, 11, 21, 22, 25].map(posts)).toEqual([
      "1 пост",
      "2 поста",
      "5 постов",
      "11 постов",
      "21 пост",
      "22 поста",
      "25 постов",
    ]);
    expect(plural("content.analytics.postsCount", 1, "en")).toBe("1 post");
    expect(plural("content.analytics.postsCount", 3, "en")).toBe("3 posts");
  });

  it("writes periods short, with the year only when it isn't this one", () => {
    expect(formatRange("2026-11-01", "2026-11-07", "2026-11-08")).toBe("1–7 нояб.");
    expect(formatRange("2026-09-01", "2026-11-08", "2026-11-08")).toBe("1 сент. – 8 нояб.");
    expect(formatRange("2025-12-01", "2026-01-08", "2026-11-08")).toMatch(/2025.*2026/);
  });
});
