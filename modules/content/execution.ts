import { db } from "@/lib/db";
import {
  addDays,
  addMonths,
  fromDateString,
  startOfMonth,
  toDateString,
  todayInTimezone,
} from "@/lib/dates";
import type { ContentChannel, ContentStatus, Role } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/modules/core/permissions";
import { displayName } from "@/modules/core/users/display-name";

import { canAddContent, CHANNELS, ContentError } from "./service";

// «Выполнение плана»: how the plan of a past period was carried out — what had to go out, what
// was sent (on time or late), what wasn't, how often posts came back for changes (from the
// reviewer and from the lawyer), what was cancelled — in total and by author.
// On time: sent to every bot on or before the publication day (the sender's calendar day).

export type ExecutionPost = {
  id: string;
  publishDate: string;
  status: ContentStatus;
  channels: ContentChannel[];
  sentChannels: ContentChannel[];
  // The day it was marked sent to the last bot.
  sentDay: string | null;
  authorId: string | null;
  author: string | null;
  // Returns for changes: by a reviewer and by the lawyer.
  returns: { review: number; legal: number };
};

type Counts = {
  due: number;
  sent: number;
  onTime: number;
  late: number;
  notSent: number;
  returnedPosts: number;
  returnsReview: number;
  returnsLegal: number;
  cancelled: number;
};

function count(posts: ExecutionPost[], today: string): Counts {
  const live = posts.filter((p) => p.status !== "CANCELLED");
  const due = live.filter((p) => p.publishDate <= today);
  const sent = due.filter((p) => p.status === "SENT");
  const onTime = sent.filter((p) => p.sentDay !== null && p.sentDay <= p.publishDate).length;
  // Late: not sent yet although the day has passed (a post due today still has the day).
  const notSent = due.filter((p) => p.status !== "SENT" && p.publishDate < today).length;
  return {
    due: due.length,
    sent: sent.length,
    onTime,
    late: sent.length - onTime,
    notSent,
    returnedPosts: posts.filter((p) => p.returns.review + p.returns.legal > 0).length,
    returnsReview: posts.reduce((s, p) => s + p.returns.review, 0),
    returnsLegal: posts.reduce((s, p) => s + p.returns.legal, 0),
    cancelled: posts.length - live.length,
  };
}

// `posts`: the period's posts (cancelled included) up to the end of the current month; the ones
// after `today` are «впереди» (ahead).
export function planExecution(posts: ExecutionPost[], today: string) {
  const past = posts.filter((p) => p.publishDate <= today);
  const ahead = posts.filter((p) => p.publishDate > today && p.status !== "CANCELLED").length;
  const byBot = CHANNELS.map((channel) => ({
    channel,
    planned: past.filter((p) => p.status !== "CANCELLED" && p.channels.includes(channel)).length,
    sent: past.filter((p) => p.sentChannels.includes(channel)).length,
  }));
  const authors = new Map<string, { name: string | null; posts: ExecutionPost[] }>();
  for (const post of past) {
    const key = post.authorId ?? "";
    const entry = authors.get(key) ?? { name: post.author, posts: [] };
    entry.posts.push(post);
    authors.set(key, entry);
  }
  return {
    ...count(past, today),
    ahead,
    byBot,
    // Who gets stuck first: the most late and unsent, then the most returns.
    byAuthor: [...authors.entries()]
      .map(([id, a]) => ({ id: id || null, name: a.name, ...count(a.posts, today) }))
      .sort(
        (a, b) =>
          b.notSent + b.late - (a.notSent + a.late) ||
          b.returnsReview + b.returnsLegal - (a.returnsReview + a.returnsLegal) ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      ),
  };
}
export type PlanExecution = ReturnType<typeof planExecution>;

const LEGAL: Role = "LAWYER";

// The posts from `from` to the end of the current month, with the day each was sent (in
// `timezone`) and its returns for changes (a remark by a lawyer counts as the lawyer's return).
export async function loadExecution(
  actor: Actor,
  from: string,
  today: string,
  timezone: string,
  options: { bot?: ContentChannel } = {},
): Promise<ExecutionPost[]> {
  if (!canAddContent(actor)) throw new ContentError("forbidden");
  const to = addDays(addMonths(startOfMonth(today), 1), -1);
  const rows = await db.contentPost.findMany({
    where: {
      publishDate: { gte: fromDateString(from), lte: fromDateString(to) },
      ...(options.bot ? { channels: { has: options.bot } } : {}),
    },
    select: {
      id: true,
      publishDate: true,
      status: true,
      channels: true,
      sentChannels: true,
      sentAt: true,
      authorId: true,
      author: { select: { firstName: true, lastName: true } },
      comments: {
        where: { isFeedback: true },
        select: { author: { select: { role: true } } },
      },
    },
    orderBy: { publishDate: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    publishDate: toDateString(r.publishDate),
    status: r.status,
    channels: r.channels,
    sentChannels: r.sentChannels,
    sentDay: r.sentAt ? todayInTimezone(timezone, r.sentAt) : null,
    authorId: r.authorId,
    author: r.author ? displayName(r.author) : null,
    returns: {
      review: r.comments.filter((c) => c.author.role !== LEGAL).length,
      legal: r.comments.filter((c) => c.author.role === LEGAL).length,
    },
  }));
}
