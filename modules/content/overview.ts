import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import type { ContentBrand, ContentChannel } from "@/lib/generated/prisma/enums";

import type { AnalyticsPost } from "./analytics";
import { CHANNELS } from "./service";
import { BRANDS } from "./tagging";

// "The big picture" for directors: what we are going to tell through the bots — the current
// month and the next ones: how much, about what, to whom, and the key messages month by month.

export const HORIZONS = [1, 3, 6] as const;
export type Horizon = (typeof HORIZONS)[number];

// From the first day of this month to the last day of the month `months - 1` later.
export function overviewPeriod(today: string, months: Horizon) {
  const from = startOfMonth(today);
  const to = addDays(addMonths(from, months), -1);
  const monthStarts = Array.from({ length: months }, (_, i) => addMonths(from, i));
  return { from, to, months: monthStarts };
}

const READY = ["APPROVED", "SENT"];
// Topic id for posts AI hasn't tagged yet.
export const NO_TOPIC = "";

type Share = { id: string; count: number; percent: number };

// Counts by key, biggest first; shares of the whole list (rounded).
function shares(keys: string[]): Share[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      count,
      percent: keys.length ? Math.round((count / keys.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

const topicOf = (p: AnalyticsPost) => p.topic ?? NO_TOPIC;

export function contentOverview(posts: AnalyticsPost[], months: string[]) {
  const live = posts.filter((p) => p.status !== "CANCELLED");
  const ready = live.filter((p) => READY.includes(p.status)).length;
  const topics = shares(live.map(topicOf));
  // «Общее» (no particular brand) is most of the plan: shares are of posts with a brand, and the
  // rest is counted on its own.
  const branded = live.flatMap((p) => (p.brand && p.brand !== "GENERAL" ? [p.brand] : []));
  const brands = shares(branded);
  return {
    general: live.length - branded.length,
    total: live.length,
    ready,
    readyPercent: live.length ? Math.round((ready / live.length) * 100) : 0,
    // The main topic: the biggest tagged one.
    mainTopic: topics.find((s) => s.id !== NO_TOPIC) ?? null,
    topics,
    // Brands in their fixed order (only those with posts), so colours stay put.
    brands: BRANDS.map((b) => brands.find((s) => s.id === b))
      .filter((s): s is Share => Boolean(s))
      .map((s) => ({ ...s, id: s.id as ContentBrand })),
    bots: CHANNELS.map((channel: ContentChannel) => {
      const own = live.filter((p) => p.channels.includes(channel));
      return {
        channel,
        count: own.length,
        topics: shares(own.map(topicOf)).slice(0, 3),
        brand: shares(own.map((p) => p.brand ?? "GENERAL")).find((s) => s.id !== "GENERAL") ?? null,
      };
    }),
    months: months.map((month) => {
      const own = live.filter((p) => p.publishDate.startsWith(month.slice(0, 7)));
      return {
        month,
        count: own.length,
        topics: shares(own.map(topicOf))
          .filter((s) => s.id !== NO_TOPIC)
          .slice(0, 3),
        // Key messages: the posts going to the most bots (the widest reach), shown by date.
        headlines: [...own]
          .sort(
            (a, b) =>
              b.channels.length - a.channels.length || a.publishDate.localeCompare(b.publishDate),
          )
          .slice(0, 4)
          .sort((a, b) => a.publishDate.localeCompare(b.publishDate))
          .map((p) => ({ id: p.id, title: p.title, date: p.publishDate, channels: p.channels })),
      };
    }),
  };
}
