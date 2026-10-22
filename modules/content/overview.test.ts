import { describe, expect, it } from "vitest";

import type { AnalyticsPost } from "./analytics";
import { contentOverview, NO_TOPIC, overviewPeriod } from "./overview";

let n = 0;
const post = (over: Partial<AnalyticsPost>): AnalyticsPost => ({
  id: `p${++n}`,
  title: `Тестовый пост ${n}`,
  publishDate: "2026-10-05",
  publishTime: null,
  channels: ["PARTNER"],
  topic: "PRICES",
  brand: "ESSE",
  status: "PLANNED",
  ...over,
});

describe("content overview", () => {
  it("takes this month and the next ones", () => {
    expect(overviewPeriod("2026-10-14", 3)).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
      months: ["2026-10-01", "2026-11-01", "2026-12-01"],
    });
  });

  it("sums up the plan: readiness, topics, bots, brands, months", () => {
    const posts = [
      post({ status: "SENT" }),
      post({ status: "APPROVED", channels: ["PARTNER", "CONNECT"], title: "Тестовый общий" }),
      post({ topic: "TRAINING", brand: "PINE", channels: ["CONNECT"] }),
      post({ topic: null, brand: null, publishDate: "2026-11-03" }),
      post({ status: "CANCELLED", topic: "PROMO" }),
    ];
    const o = contentOverview(posts, ["2026-10-01", "2026-11-01"]);
    expect([o.total, o.ready, o.readyPercent]).toEqual([4, 2, 50]);
    expect(o.mainTopic).toEqual({ id: "PRICES", count: 2, percent: 50 });
    expect(o.topics.map((s) => s.id)).toEqual(["PRICES", NO_TOPIC, "TRAINING"]);
    expect(o.brands.map((b) => [b.id, b.count])).toEqual([
      ["ESSE", 2],
      ["PINE", 1],
      ["GENERAL", 1],
    ]);
    const connect = o.bots.find((b) => b.channel === "CONNECT")!;
    expect(connect.count).toBe(2);
    expect(connect.topics.map((s) => s.id)).toEqual(["PRICES", "TRAINING"]);
    expect(o.months.map((m) => m.count)).toEqual([3, 1]);
    // The post going to two bots leads the month.
    expect(o.months[0]!.headlines[0]!.title).toBe("Тестовый общий");
    // Untagged posts aren't shown as a month's theme.
    expect(o.months[1]!.topics).toEqual([]);
  });
});
