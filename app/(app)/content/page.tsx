import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { BOT_COLOR, BotChip, ContentStatusBadge } from "@/components/content/bot-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  addMonths,
  formatDay,
  formatMonth,
  monthGrid,
  startOfMonth,
  toDateString,
} from "@/lib/dates";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import {
  canPlanContent,
  CHANNELS,
  contentAttention,
  listPostsBetween,
} from "@/modules/content/service";

type Post = Awaited<ReturnType<typeof listPostsBetween>>[number];

function PostChip({ post }: { post: Post }) {
  return (
    <Link
      href={`/content/${post.id}`}
      title={`${post.title} · ${t(`content.status.${post.status}`)}`}
      className={cn(
        "hover:bg-accent bg-card flex items-center gap-1.5 truncate rounded-md border px-1.5 py-1 text-[11px] leading-tight",
        post.status === "CANCELLED" && "line-through opacity-50",
      )}
    >
      <span className="flex shrink-0 gap-0.5">
        {post.channels.map((c) => (
          <span key={c} className="size-1.5 rounded-full" style={{ background: BOT_COLOR[c] }} />
        ))}
      </span>
      <span className="truncate">{post.title}</span>
      {post.status === "SENT" && <span className="ml-auto shrink-0 text-emerald-600">✓</span>}
      {post.status === "REVIEW" && (
        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" />
      )}
      {post.status === "CHANGES" && (
        <span className="bg-destructive ml-auto size-1.5 shrink-0 rounded-full" />
      )}
    </Link>
  );
}

function AttentionCard({ title, posts, tone }: { title: string; posts: Post[]; tone: string }) {
  return (
    <Card className="gap-2 p-4 md:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span
          className={cn(
            "font-display text-xl font-semibold",
            posts.length ? tone : "text-muted-foreground",
          )}
        >
          {posts.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {posts.slice(0, 3).map((post) => (
          <li key={post.id}>
            <Link href={`/content/${post.id}`} className="flex gap-1.5 hover:underline">
              <span className="text-muted-foreground shrink-0">
                {formatDay(toDateString(post.publishDate))}
              </span>
              <span className="truncate">{post.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default async function ContentPage({ searchParams }: PageProps<"/content">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const month =
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? `${params.month}-01`
      : startOfMonth(today);
  const bot = CHANNELS.find((c) => c === params.bot) as ContentChannel | undefined;
  const weeks = monthGrid(month);
  const [posts, attention] = await Promise.all([
    listPostsBetween(user, weeks[0]![0]!, weeks.at(-1)![6]!, bot),
    contentAttention(user, today),
  ]);
  const byDay = new Map<string, Post[]>();
  for (const post of posts) {
    const key = toDateString(post.publishDate);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }
  const planner = canPlanContent(user);
  const href = (next: { month?: string; bot?: string | null }) => {
    const query = new URLSearchParams();
    query.set("month", (next.month ?? month).slice(0, 7));
    const b = next.bot === undefined ? bot : next.bot;
    if (b) query.set("bot", b);
    return `/content?${query}`;
  };
  const weekdays = t("tasks.calendar.weekdays").split(",");
  const monthPosts = posts.filter((p) => toDateString(p.publishDate).startsWith(month.slice(0, 7)));

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-medium md:text-2xl">{t("content.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("content.flow")}</p>
        </div>
        {planner && (
          <Button asChild>
            <Link href={`/content/new?date=${today}`}>
              <Plus />
              {t("content.add")}
            </Link>
          </Button>
        )}
      </div>

      <div className={cn("grid gap-3", planner ? "sm:grid-cols-3" : "sm:grid-cols-1")}>
        {planner && (
          <AttentionCard
            title={t("content.attention.review")}
            posts={attention.review}
            tone="text-amber-600"
          />
        )}
        <AttentionCard
          title={t("content.attention.prepare")}
          posts={attention.prepare}
          tone="text-primary"
        />
        {planner && (
          <AttentionCard
            title={t("content.attention.toSend")}
            posts={attention.toSend}
            tone="text-emerald-600"
          />
        )}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={t("content.month.prev")}>
            <Link href={href({ month: addMonths(month, -1) })}>
              <ChevronLeft />
            </Link>
          </Button>
          <span className="font-display min-w-36 text-center text-base font-medium">
            {formatMonth(month)}
          </span>
          <Button asChild variant="outline" size="icon" aria-label={t("content.month.next")}>
            <Link href={href({ month: addMonths(month, 1) })}>
              <ChevronRight />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ month: startOfMonth(today) })}>{t("content.month.today")}</Link>
          </Button>
          <div className="bg-secondary/70 inline-flex flex-wrap gap-0.5 rounded-2xl p-1 text-sm sm:ml-auto sm:rounded-full">
            {[null, ...CHANNELS].map((c) => (
              <Link
                key={c ?? "all"}
                href={href({ bot: c })}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 whitespace-nowrap",
                  (bot ?? null) === c ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                )}
              >
                {c && <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />}
                {c ? t(`content.channels.${c}`) : t("content.allBots")}
              </Link>
            ))}
          </div>
        </div>

        {/* Larger screens: the month as a calendar. */}
        <div className="bg-card shadow-card hidden overflow-hidden rounded-2xl border md:block">
          <div className="text-muted-foreground grid grid-cols-7 border-b text-xs">
            {weekdays.map((d) => (
              <div key={d} className="px-2 py-2 font-medium">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map((dayValue) => {
                const inMonth = dayValue.startsWith(month.slice(0, 7));
                const list = byDay.get(dayValue) ?? [];
                return (
                  <div
                    key={dayValue}
                    className={cn(
                      "group flex min-h-28 min-w-0 flex-col gap-1 border-r p-1.5 last:border-r-0",
                      !inMonth && "bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-xs",
                          dayValue === today && "bg-primary text-primary-foreground font-semibold",
                          !inMonth && "text-muted-foreground",
                        )}
                      >
                        {Number(dayValue.slice(8))}
                      </span>
                      {planner && (
                        <Link
                          href={`/content/new?date=${dayValue}`}
                          aria-label={t("content.add")}
                          className="text-muted-foreground hover:text-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Plus className="size-3.5" />
                        </Link>
                      )}
                    </div>
                    {list.slice(0, 4).map((post) => (
                      <PostChip key={post.id} post={post} />
                    ))}
                    {list.length > 4 && (
                      <span className="text-muted-foreground px-1 text-[11px]">
                        {t("content.month.more", { count: list.length - 4 })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Phones: days with posts as a list. */}
        <div className="flex flex-col gap-3 md:hidden">
          {monthPosts.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("content.month.empty")}</p>
          )}
          {[...byDay.entries()]
            .filter(([d]) => d.startsWith(month.slice(0, 7)))
            .map(([d, list]) => (
              <div key={d} className="flex flex-col gap-1.5">
                <span className={cn("text-sm font-medium", d === today && "text-primary")}>
                  {formatDay(d)}
                </span>
                {list.map((post) => (
                  <Link
                    key={post.id}
                    href={`/content/${post.id}`}
                    className="bg-card shadow-card flex flex-col gap-1.5 rounded-xl border p-3"
                  >
                    <span className="text-sm font-medium">{post.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ContentStatusBadge status={post.status} />
                      {post.channels.map((c) => (
                        <BotChip key={c} channel={c} sent={post.sentChannels.includes(c)} />
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
