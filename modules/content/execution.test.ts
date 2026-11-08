import { describe, expect, it } from "vitest";

import { planExecution, type ExecutionPost } from "./execution";

let n = 0;
const post = (over: Partial<ExecutionPost>): ExecutionPost => ({
  id: `p${++n}`,
  publishDate: "2026-11-02",
  status: "SENT",
  channels: ["PARTNER"],
  sentChannels: ["PARTNER"],
  sentDay: "2026-11-02",
  authorId: "a",
  author: "Сотрудник (тест)",
  returns: { review: 0, legal: 0 },
  ...over,
});

describe("plan execution", () => {
  it("counts what had to go out, what went on time, late or not at all, returns and what's ahead", () => {
    const posts = [
      post({}),
      // Sent a day after its date.
      post({ publishDate: "2026-11-03", sentDay: "2026-11-04", returns: { review: 1, legal: 1 } }),
      // The day passed, not sent.
      post({
        publishDate: "2026-11-05",
        status: "APPROVED",
        sentChannels: [],
        sentDay: null,
        authorId: "b",
        author: "Тест",
        channels: ["CONNECT"],
      }),
      // Today: still has the day.
      post({ publishDate: "2026-11-08", status: "REVIEW", sentChannels: [], sentDay: null }),
      post({ publishDate: "2026-11-06", status: "CANCELLED", sentChannels: [], sentDay: null }),
      // Ahead.
      post({ publishDate: "2026-11-20", status: "PLANNED", sentChannels: [], sentDay: null }),
      post({ publishDate: "2026-11-21", status: "CANCELLED", sentChannels: [], sentDay: null }),
    ];
    const e = planExecution(posts, "2026-11-08");
    expect(e).toMatchObject({
      due: 4,
      sent: 2,
      onTime: 1,
      late: 1,
      notSent: 1,
      returnedPosts: 1,
      returnsReview: 1,
      returnsLegal: 1,
      cancelled: 1,
      ahead: 1,
    });
    expect(e.byBot).toEqual([
      { channel: "PARTNER", planned: 3, sent: 2 },
      { channel: "CONNECT", planned: 1, sent: 0 },
      { channel: "RESEARCH", planned: 0, sent: 0 },
    ]);
    // The author with a late post comes first.
    expect(e.byAuthor.map((a) => [a.name, a.due, a.notSent + a.late])).toEqual([
      ["Сотрудник (тест)", 3, 1],
      ["Тест", 1, 1],
    ]);
  });
});
