import { z } from "zod";

import { db } from "@/lib/db";
import {
  addDays,
  addMonths,
  fromDateString,
  startOfMonth,
  startOfWeek,
  toDateString,
} from "@/lib/dates";
import type { ContentBrand, ContentChannel } from "@/lib/generated/prisma/enums";
import { logActivity } from "@/modules/core/activity/service";
import type { Actor } from "@/modules/core/permissions";

import { canAddContent, canPlanContent, CHANNELS, ContentError } from "./service";
import { BRANDS } from "./tagging";

// Content analytics: what the plan focuses on and which topics it develops over time.

export const PERIODS = [1, 3, 6, 12] as const;
export type PeriodMonths = (typeof PERIODS)[number];

export type AnalyticsPost = {
  id: string;
  title: string;
  publishDate: string;
  publishTime: string | null;
  channels: ContentChannel[];
  topic: string | null;
  brand: ContentBrand | null;
  status: string;
};

// The last `months` calendar months up to and including the current one.
export function analyticsPeriod(today: string, months: PeriodMonths) {
  const from = addMonths(startOfMonth(today), -(months - 1));
  const to = addDays(addMonths(startOfMonth(today), 1), -1);
  const weeks: string[] = [];
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) weeks.push(w);
  const monthStarts: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) monthStarts.push(m);
  return { from, to, weeks, months: monthStarts };
}

export async function loadAnalyticsPosts(
  actor: Actor,
  from: string,
  to: string,
  options: { bot?: ContentChannel; sentOnly?: boolean } = {},
): Promise<AnalyticsPost[]> {
  if (!canAddContent(actor)) throw new ContentError("forbidden");
  const rows = await db.contentPost.findMany({
    where: {
      publishDate: { gte: fromDateString(from), lte: fromDateString(to) },
      status: options.sentOnly ? "SENT" : { not: "CANCELLED" },
      ...(options.bot ? { channels: { has: options.bot } } : {}),
    },
    orderBy: [{ publishDate: "asc" }, { publishTime: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    publishDate: toDateString(r.publishDate),
    publishTime: r.publishTime,
    channels: r.channels,
    topic: r.topic,
    brand: r.brand,
    status: r.status,
  }));
}

const count = <K extends string>(keys: readonly K[], values: (K | null)[]) =>
  Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length])) as Record<
    K,
    number
  >;

// Every function takes `topics`: the ids of the sections to show, in their order.

// 1. Storylines: for every topic, its posts by week. `today` limits the silence to weeks that have
// begun: the rest of the current month is still ahead, not silence.
export function storylines(
  posts: AnalyticsPost[],
  weeks: string[],
  topics: readonly string[],
  today?: string,
) {
  const begun = today ? weeks.filter((w) => w <= today) : weeks;
  return topics.map((topic) => {
    const own = posts.filter((p) => p.topic === topic);
    return {
      topic,
      total: own.length,
      weeks: weeks.map((week) =>
        own.filter((p) => p.publishDate >= week && p.publishDate <= addDays(week, 6)),
      ),
      // Weeks in a row without a post up to the current week (a topic left behind).
      silentWeeks: (() => {
        let n = 0;
        for (let i = begun.length - 1; i >= 0; i--) {
          const w = begun[i]!;
          if (own.some((p) => p.publishDate >= w && p.publishDate <= addDays(w, 6))) break;
          n += 1;
        }
        return n;
      })(),
    };
  });
}

// 2. Focus: share of every topic.
export function topicShares(posts: AnalyticsPost[], topics: readonly string[]) {
  const tagged = posts.filter((p) => p.topic && topics.includes(p.topic));
  const counts = count(
    topics,
    tagged.map((p) => p.topic),
  );
  return topics
    .map((topic) => ({
      topic,
      count: counts[topic],
      percent: tagged.length ? Math.round((counts[topic] / tagged.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// 3. Topics × bots: how many posts of each topic went (or go) to each bot.
export function topicByBot(posts: AnalyticsPost[], topics: readonly string[]) {
  return topics.map((topic) => ({
    topic,
    bots: Object.fromEntries(
      CHANNELS.map((c) => [
        c,
        posts.filter((p) => p.topic === topic && p.channels.includes(c)).length,
      ]),
    ) as Record<ContentChannel, number>,
  }));
}

// 4. Brands: totals and by month.
export function brandsByMonth(posts: AnalyticsPost[], months: string[]) {
  const tagged = posts.filter((p) => p.brand);
  return {
    totals: count(
      BRANDS,
      tagged.map((p) => p.brand),
    ),
    months: months.map((m) => ({
      month: m,
      brands: count(
        BRANDS,
        tagged.filter((p) => p.publishDate.startsWith(m.slice(0, 7))).map((p) => p.brand),
      ),
    })),
  };
}

// 5. Plan vs fact: the wanted share of every topic against the real one (percentage points).
export function planVsFact(
  posts: AnalyticsPost[],
  targets: Record<string, number>,
  topics: readonly string[],
) {
  const shares = Object.fromEntries(topicShares(posts, topics).map((s) => [s.topic, s.percent]));
  return topics.map((topic) => ({
    topic,
    target: targets[topic] ?? 0,
    actual: shares[topic] ?? 0,
    gap: (shares[topic] ?? 0) - (targets[topic] ?? 0),
  }));
}

// Treemap layout (squarified): rectangles in a w × h box with areas proportional to the values.
export function squarify<T extends { value: number }>(items: T[], w: number, h: number) {
  const out: (T & { x: number; y: number; w: number; h: number })[] = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return out;
  let rest = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let box = { x: 0, y: 0, w, h };
  const scale = (w * h) / total;
  const worst = (row: T[], side: number) => {
    const areas = row.map((i) => i.value * scale);
    const sum = areas.reduce((s, a) => s + a, 0);
    return Math.max(
      ...areas.map((a) =>
        Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a)),
      ),
    );
  };
  while (rest.length) {
    const side = Math.min(box.w, box.h);
    const row: T[] = [rest[0]!];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]!], side) <= worst(row, side))
      row.push(rest[i++]!);
    rest = rest.slice(row.length);
    const rowArea = row.reduce((s, r) => s + r.value * scale, 0);
    if (box.w >= box.h) {
      const rw = rowArea / box.h;
      let y = box.y;
      for (const r of row) {
        const rh = (r.value * scale) / rw;
        out.push({ ...r, x: box.x, y, w: rw, h: rh });
        y += rh;
      }
      box = { x: box.x + rw, y: box.y, w: box.w - rw, h: box.h };
    } else {
      const rh = rowArea / box.w;
      let x = box.x;
      for (const r of row) {
        const rw = (r.value * scale) / rh;
        out.push({ ...r, x, y: box.y, w: rw, h: rh });
        x += rw;
      }
      box = { x: box.x, y: box.y + rh, w: box.w, h: box.h - rh };
    }
  }
  return out;
}

// The wanted mix of sections (percent by section id), set by planners.
const TARGETS_KEY = "content.targets";
// Defaults for the built-in sections; a new section starts at 0.
export const DEFAULT_TARGETS: Record<string, number> = {
  PRICES: 15,
  NEW_PRODUCTS: 15,
  PROMO: 15,
  TRAINING: 20,
  RESEARCH: 10,
  MOTIVATION: 10,
  COMPANY_NEWS: 10,
  SERVICE: 5,
};
const percent = z.coerce.number().int().min(0).max(100);

// The targets of the given sections (missing ones are 0).
export async function getContentTargets(
  topics: readonly string[],
): Promise<Record<string, number>> {
  const row = await db.systemState.findUnique({ where: { key: TARGETS_KEY } });
  let stored: Record<string, number> = DEFAULT_TARGETS;
  if (row) {
    try {
      const parsed = z.record(z.string(), percent).safeParse(JSON.parse(row.value));
      if (parsed.success) stored = parsed.data;
    } catch {
      // Broken value: fall back to the defaults.
    }
  }
  return Object.fromEntries(topics.map((t) => [t, stored[t] ?? 0]));
}

// Saves the targets of the active sections; together they must make 100%.
export async function saveContentTargets(
  actor: Actor,
  input: Record<string, unknown>,
  topics: readonly string[],
) {
  if (!canPlanContent(actor)) throw new ContentError("forbidden");
  const values: Record<string, number> = {};
  for (const t of topics) {
    const parsed = percent.safeParse(input[t] ?? 0);
    if (!parsed.success) throw new ContentError("invalid");
    values[t] = parsed.data;
  }
  if (Object.values(values).reduce((s, n) => s + n, 0) !== 100) throw new ContentError("invalid");
  const value = JSON.stringify(values);
  await db.systemState.upsert({
    where: { key: TARGETS_KEY },
    create: { key: TARGETS_KEY, value },
    update: { value },
  });
  await logActivity({
    actorId: actor.id,
    action: "content.targets_saved",
    entityType: "SystemState",
    entityId: TARGETS_KEY,
  });
}
