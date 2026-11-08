import { describe, expect, it } from "vitest";

import {
  analyticsPeriod,
  brandsByMonth,
  planVsFact,
  squarify,
  storylines,
  topicByBot,
  topicShares,
  DEFAULT_TARGETS,
  type AnalyticsPost,
} from "./analytics";
import { BUILT_IN_SECTIONS, tagByKeywords } from "./tagging";

const topics = BUILT_IN_SECTIONS;

let n = 0;
const post = (over: Partial<AnalyticsPost>): AnalyticsPost => ({
  id: `p${++n}`,
  title: "Тестовый пост",
  publishDate: "2026-10-05",
  publishTime: null,
  channels: ["PARTNER"],
  topic: "PRICES",
  brand: "ESSE",
  status: "SENT",
  ...over,
});

describe("content tagging by keywords", () => {
  it("finds the brand and the topic", () => {
    expect(
      tagByKeywords({ title: "Новые цены ESSE", brief: null, textRu: "RSP/DSP", textUz: null }),
    ).toEqual({
      topic: "PRICES",
      brand: "ESSE",
    });
    expect(
      tagByKeywords({ title: "Акция 10+1 на PINE", brief: null, textRu: null, textUz: null }),
    ).toEqual({
      topic: "PROMO",
      brand: "PINE",
    });
    // Several brands → general; nothing matched → company news.
    expect(
      tagByKeywords({ title: "ESSE и PINE", brief: null, textRu: null, textUz: null }).brand,
    ).toBe("GENERAL");
    expect(tagByKeywords({ title: "Тест", brief: null, textRu: null, textUz: null }).topic).toBe(
      "COMPANY_NEWS",
    );
  });

  it("matches a team's own section by the words of its name", () => {
    const sections = [
      ...BUILT_IN_SECTIONS.map((id) => ({ id, name: id, description: null })),
      { id: "own", name: "Мерчандайзинг", description: null },
    ];
    expect(
      tagByKeywords(
        { title: "Правила мерчандайзинга", brief: null, textRu: null, textUz: null },
        sections,
      ).topic,
    ).toBe("own");
  });
});

describe("content analytics", () => {
  it("builds the period: months and weeks", () => {
    const p = analyticsPeriod("2026-10-09", 3);
    expect([p.from, p.to]).toEqual(["2026-08-01", "2026-10-31"]);
    expect(p.months).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(p.weeks[0]).toBe("2026-07-27");
  });

  it("storylines, shares, topic × bot, brands, plan vs fact", () => {
    const weeks = ["2026-09-28", "2026-10-05", "2026-10-12"];
    const posts = [
      post({ publishDate: "2026-09-29" }),
      post({ publishDate: "2026-10-06", channels: ["PARTNER", "CONNECT"] }),
      post({ topic: "TRAINING", brand: "PINE", publishDate: "2026-09-30", channels: ["CONNECT"] }),
      post({ topic: null, brand: null }),
    ];
    const lines = storylines(posts, weeks, topics);
    const prices = lines.find((l) => l.topic === "PRICES")!;
    expect(prices.weeks.map((w) => w.length)).toEqual([1, 1, 0]);
    expect(prices.silentWeeks).toBe(1);
    expect(lines.find((l) => l.topic === "PROMO")!.silentWeeks).toBe(3);
    // Weeks still ahead are not silence: on 2026-10-07 only two weeks have begun.
    const midway = storylines(posts, weeks, topics, "2026-10-07");
    expect(midway.find((l) => l.topic === "PRICES")!.silentWeeks).toBe(0);
    expect(midway.find((l) => l.topic === "PROMO")!.silentWeeks).toBe(2);

    expect(topicShares(posts, topics).slice(0, 2)).toEqual([
      { topic: "PRICES", count: 2, percent: 67 },
      { topic: "TRAINING", count: 1, percent: 33 },
    ]);
    expect(topicByBot(posts, topics).find((r) => r.topic === "PRICES")!.bots).toEqual({
      PARTNER: 2,
      CONNECT: 1,
      RESEARCH: 0,
    });
    const brands = brandsByMonth(posts, ["2026-09-01", "2026-10-01"]);
    expect(brands.totals).toMatchObject({ ESSE: 2, PINE: 1 });
    expect(brands.months[1]!.brands.ESSE).toBe(1);
    const gaps = planVsFact(posts, DEFAULT_TARGETS, topics);
    expect(gaps.find((g) => g.topic === "PRICES")).toEqual({
      topic: "PRICES",
      target: 15,
      actual: 67,
      gap: 52,
    });
  });

  it("lays a treemap out inside the box with areas by value", () => {
    const rects = squarify(
      [
        { name: "a", value: 6 },
        { name: "b", value: 3 },
        { name: "c", value: 1 },
        { name: "z", value: 0 },
      ],
      100,
      50,
    );
    expect(rects.map((r) => r.name)).toEqual(["a", "b", "c"]);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y + r.h).toBeLessThanOrEqual(50.001);
      expect(r.x + r.w).toBeLessThanOrEqual(100.001);
    }
    expect(Math.round(rects[0]!.w * rects[0]!.h)).toBe(3000);
  });
});
