import { BarChart3, ChevronLeft, ChevronRight, Download, Plus, Send, Upload } from "lucide-react";
import Link from "next/link";

import { BOT_COLOR } from "@/components/content/bot-chip";
import { DraggablePost, DropDay } from "@/components/content/drag";
import { DayList, groupByDay, ListView, PreviewView, WeekView } from "@/components/content/views";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addDays,
  addMonths,
  formatDay,
  formatMonth,
  isDateString,
  monthGrid,
  startOfMonth,
  startOfWeek,
  toDateString,
} from "@/lib/dates";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import {
  canAddContent,
  canPlanContent,
  CHANNELS,
  contentAttention,
  contentRights,
  listPostsBetween,
} from "@/modules/content/service";

import { deliverTodayAction, importPlanAction } from "./actions";

type Post = Awaited<ReturnType<typeof listPostsBetween>>[number];
const VIEWS = ["month", "week", "list", "preview"] as const;
type View = (typeof VIEWS)[number];

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
  const view: View = VIEWS.find((v) => v === params.view) ?? "month";
  const month =
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? `${params.month}-01`
      : startOfMonth(today);
  const week = startOfWeek(
    typeof params.week === "string" && isDateString(params.week) ? params.week : today,
  );
  const bot = CHANNELS.find((c) => c === params.bot) as ContentChannel | undefined;
  const weeks = monthGrid(month);
  // The period on screen (and in the Excel download).
  const [from, to] =
    view === "week"
      ? [week, addDays(week, 6)]
      : view === "list" || view === "preview"
        ? [month, addDays(addMonths(month, 1), -1)]
        : [weeks[0]![0]!, weeks.at(-1)![6]!];
  const [posts, attention] = await Promise.all([
    listPostsBetween(user, from, to, bot),
    contentAttention(user, today),
  ]);
  const byDay = groupByDay(posts);
  // Posts this person may drag to another day.
  const movable = new Set(posts.filter((p) => contentRights(user, p).editPlan).map((p) => p.id));
  const lang = params.lang === "uz" ? "uz" : "ru";
  const planner = canPlanContent(user);
  const lawyer = user.role === "LAWYER";
  const canAdd = canAddContent(user);
  const href = (next: { view?: View; month?: string; week?: string; bot?: string | null }) => {
    const query = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "month") query.set("view", v);
    if (v === "week") query.set("week", next.week ?? week);
    else query.set("month", (next.month ?? month).slice(0, 7));
    const b = next.bot === undefined ? bot : next.bot;
    if (b) query.set("bot", b);
    return `/content?${query}`;
  };
  const weekdays = t("tasks.calendar.weekdays").split(",");
  const monthDays = [...byDay.keys()].filter((d) => d.startsWith(month.slice(0, 7)));
  const exportHref = `/api/content/export?${new URLSearchParams({ from, to, ...(bot ? { bot } : {}) })}`;
  const imported = typeof params.imported === "string" ? params.imported.split("-") : null;
  const title =
    view === "week" ? `${formatDay(week)} – ${formatDay(addDays(week, 6))}` : formatMonth(month);
  const prev =
    view === "week" ? href({ week: addDays(week, -7) }) : href({ month: addMonths(month, -1) });
  const next =
    view === "week" ? href({ week: addDays(week, 7) }) : href({ month: addMonths(month, 1) });

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-medium md:text-2xl">{t("content.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("content.flow")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The analytics is in the menu only on wide screens; here it is reachable on a phone. */}
          <Button asChild variant="outline">
            <Link href="/content-analytics">
              <BarChart3 />
              {t("content.analyticsLink")}
            </Link>
          </Button>
          {canAdd && planner && (
            <form action={deliverTodayAction}>
              <input type="hidden" name="back" value={href({})} />
              <Button type="submit" variant="outline" title={t("content.telegram.hint")}>
                <Send />
                {t("content.telegram.today")}
              </Button>
            </form>
          )}
          {canAdd && (
            <Button asChild>
              <Link href={`/content/new?date=${today}`}>
                <Plus />
                {t("content.add")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          planner ? "sm:grid-cols-3" : lawyer ? "sm:grid-cols-2" : "sm:grid-cols-1",
        )}
      >
        {(planner || lawyer) && (
          <AttentionCard
            title={t(lawyer ? "content.attention.legal" : "content.attention.review")}
            posts={attention.review}
            tone={lawyer ? "text-violet-600" : "text-amber-600"}
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

      {params.deleted === "1" && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          {t("content.remove.done")}
        </p>
      )}
      {typeof params.delivered === "string" && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          {t("content.telegram.done", { count: params.delivered })}
        </p>
      )}
      {imported && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <p>{t("content.excel.done", { created: imported[0] ?? 0, updated: imported[1] ?? 0 })}</p>
          {Number(imported[2]) > 0 && (
            <p>{t("content.excel.returned", { count: imported[2] ?? 0 })}</p>
          )}
          {typeof params.importErrors === "string" && (
            <>
              <p className="mt-1 font-medium">{t("content.excel.problems")}</p>
              <p className="whitespace-pre-wrap">{params.importErrors}</p>
            </>
          )}
        </div>
      )}
      {typeof params.error === "string" && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {t(`content.errors.${params.error}` as TranslationKey, { mb: 50, max: 10 })}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                className={cn(
                  "rounded-full px-3.5 py-1",
                  v === view ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                )}
              >
                {t(`content.views.${v}`)}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={exportHref}>
                <Download />
                {t("content.excel.download")}
              </a>
            </Button>
            {planner && (
              <details className="relative">
                <summary className="border-input bg-card hover:bg-accent inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium shadow-xs [&::-webkit-details-marker]:hidden">
                  <Upload className="size-4" />
                  {t("content.excel.upload")}
                </summary>
                <div className="bg-card shadow-card absolute right-0 z-30 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-2xl border p-4 text-sm">
                  <p className="text-muted-foreground text-xs">{t("content.excel.uploadHint")}</p>
                  <a
                    className="text-primary text-xs underline"
                    href="/api/content/export?template=1"
                  >
                    {t("content.excel.template")}
                  </a>
                  <form action={importPlanAction} className="flex flex-col gap-2">
                    <input type="hidden" name="back" value={href({})} />
                    <Input
                      type="file"
                      name="file"
                      required
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      aria-label={t("content.excel.choose")}
                      className="h-auto py-1.5"
                    />
                    <div>
                      <Button type="submit" size="sm">
                        {t("content.excel.submit")}
                      </Button>
                    </div>
                  </form>
                </div>
              </details>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={t("content.month.prev")}>
            <Link href={prev}>
              <ChevronLeft />
            </Link>
          </Button>
          <span className="font-display min-w-36 text-center text-base font-medium">{title}</span>
          <Button asChild variant="outline" size="icon" aria-label={t("content.month.next")}>
            <Link href={next}>
              <ChevronRight />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ month: startOfMonth(today), week: startOfWeek(today) })}>
              {t("content.month.today")}
            </Link>
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

        {(view === "week" || view === "month") && movable.size > 0 && (
          <p className="text-muted-foreground hidden text-xs md:block">{t("content.dragHint")}</p>
        )}
        {view === "week" && (
          <WeekView start={week} posts={posts} today={today} planner={canAdd} movable={movable} />
        )}
        {view === "list" && (
          <ListView
            posts={posts}
            today={today}
            deletable={new Set(posts.filter((p) => contentRights(user, p).remove).map((p) => p.id))}
            back={href({})}
          />
        )}
        {view === "preview" && (
          <PreviewView
            posts={posts.filter((p) => p.status !== "CANCELLED")}
            lang={lang}
            langHref={(l) => `${href({})}${l === "uz" ? "&lang=uz" : ""}`}
          />
        )}
        {view === "month" && (
          <>
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
                      <DropDay
                        key={dayValue}
                        date={dayValue}
                        errorText={t("content.errors.move")}
                        className={cn(
                          "group flex min-h-28 min-w-0 flex-col gap-1 border-r p-1.5 last:border-r-0",
                          !inMonth && "bg-muted/40",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "flex size-6 items-center justify-center rounded-full text-xs",
                              dayValue === today &&
                                "bg-primary text-primary-foreground font-semibold",
                              !inMonth && "text-muted-foreground",
                            )}
                          >
                            {Number(dayValue.slice(8))}
                          </span>
                          {canAdd && (
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
                          <DraggablePost
                            key={post.id}
                            id={post.id}
                            date={dayValue}
                            enabled={movable.has(post.id)}
                          >
                            <PostChip post={post} />
                          </DraggablePost>
                        ))}
                        {list.length > 4 && (
                          // The week of that day shows every post of it.
                          <Link
                            href={href({ view: "week", week: dayValue })}
                            className="text-muted-foreground hover:text-foreground px-1 text-[11px] hover:underline"
                          >
                            {t("content.month.more", { count: list.length - 4 })}
                          </Link>
                        )}
                      </DropDay>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Phones: days with posts as a list. */}
            <div className="md:hidden">
              <DayList days={monthDays} byDay={byDay} today={today} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
