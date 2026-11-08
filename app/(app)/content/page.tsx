import { BarChart3, Download, FileSpreadsheet, Plus, Send } from "lucide-react";
import Link from "next/link";

import { BOT_COLOR, LateBadge } from "@/components/content/bot-chip";
import { DraggablePost, DropDay } from "@/components/content/drag";
import { menuItem, MoreMenu } from "@/components/content/more-menu";
import {
  DayList,
  groupByDay,
  ListView,
  PreviewView,
  STATUS_EDGE,
  StatusLegend,
  WeekView,
} from "@/components/content/views";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { PeriodPicker } from "@/components/ui/period-picker";
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
  isLatePost,
  isOwnPost,
  listPostsBetween,
} from "@/modules/content/service";
import { formatRange } from "@/modules/reports/format";

import { deliverTodayAction, importPlanAction } from "./actions";

type Post = Awaited<ReturnType<typeof listPostsBetween>>[number];
const VIEWS = ["month", "week", "list", "preview"] as const;
type View = (typeof VIEWS)[number];

// A post in the month calendar: its status as the edge colour, the title on up to two lines,
// a red «!» when its day passed without sending.
function PostChip({ post, today }: { post: Post; today: string }) {
  return (
    <Link
      href={`/content/${post.id}`}
      title={`${post.title} · ${t(`content.status.${post.status}`)}`}
      className={cn(
        "hover:bg-accent bg-card flex items-start gap-1.5 rounded-md border border-l-[3px] px-1.5 py-1 text-[11px] leading-tight",
        STATUS_EDGE[post.status],
        post.status === "CANCELLED" && "line-through opacity-50",
      )}
    >
      <span className="mt-1 flex shrink-0 gap-0.5">
        {post.channels.map((c) => (
          <span key={c} className="size-1.5 rounded-full" style={{ background: BOT_COLOR[c] }} />
        ))}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words">{post.title}</span>
      {post.status === "SENT" && <span className="shrink-0 text-emerald-600">✓</span>}
      {isLatePost(post, today) && <LateBadge compact />}
    </Link>
  );
}

function AttentionCard({
  title,
  posts,
  tone,
  marks,
}: {
  title: string;
  posts: Post[];
  tone: string;
  // A short note after a post's title: «вы проверяете», «ваш пост».
  marks?: Map<string, string>;
}) {
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
              {marks?.get(post.id) && (
                <span className="text-primary shrink-0 font-medium">· {marks.get(post.id)}</span>
              )}
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
  const lead = user.role === "OWNER" || user.role === "MANAGER";
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
  const title = view === "week" ? formatRange(week, addDays(week, 6), today) : formatMonth(month);
  // The period: this and the next month (or week), arrows step further.
  const thisWeek = startOfWeek(today);
  const thisMonth = startOfMonth(today);
  const chips =
    view === "week"
      ? [
          { key: thisWeek, label: t("content.period.thisWeek"), href: href({ week: thisWeek }) },
          {
            key: addDays(thisWeek, 7),
            label: t("content.period.nextWeek"),
            href: href({ week: addDays(thisWeek, 7) }),
          },
        ]
      : [
          {
            key: thisMonth,
            label: t("content.period.thisMonth"),
            href: href({ month: thisMonth }),
          },
          {
            key: addMonths(thisMonth, 1),
            label: t("content.period.nextMonth"),
            href: href({ month: addMonths(thisMonth, 1) }),
          },
        ];
  const shown = view === "week" ? week : month;
  // Who checks what: the person's own reviews are marked, their own posts too.
  const reviewMarks = new Map(
    attention.review.map((p) => [
      p.id,
      attention.mine.has(p.id)
        ? t("content.attention.mine")
        : isOwnPost(user, p)
          ? t("content.attention.own")
          : "",
    ]),
  );
  // Owner and managers prepare little themselves: instead of an empty «Мне подготовить» they
  // follow the posts returned to their authors.
  const showChanges = lead && planner && attention.prepare.length === 0;
  const cards = [
    {
      key: "late",
      title: t("content.attention.lateTitle"),
      posts: attention.late,
      tone: "text-destructive",
    },
    ...(planner || lawyer
      ? [
          {
            key: "review",
            title: t(lawyer ? "content.attention.legal" : "content.attention.review"),
            posts: attention.review,
            tone: lawyer ? "text-violet-600" : "text-amber-600",
            marks: reviewMarks,
          },
        ]
      : []),
    showChanges
      ? {
          key: "changes",
          title: t("content.attention.changes"),
          posts: attention.changes,
          tone: "text-orange-600",
        }
      : {
          key: "prepare",
          title: t("content.attention.prepare"),
          posts: attention.prepare,
          tone: "text-primary",
        },
    ...(planner && !lawyer
      ? [
          {
            key: "toSend",
            title: t("content.attention.toSend"),
            posts: attention.toSend,
            tone: "text-emerald-600",
          },
        ]
      : []),
  ];
  const pill = (on: boolean) =>
    cn(
      "rounded-full px-3.5 py-1 whitespace-nowrap",
      on ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
    );

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1">
          <h1 className="text-[22px] font-medium md:text-2xl">{t("content.title")}</h1>
          <InfoHint>{t("content.flow")}</InfoHint>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden md:inline-flex">
            <Link href="/content-analytics">
              <BarChart3 />
              {t("content.analyticsLink")}
            </Link>
          </Button>
          <MoreMenu label={t("content.more")}>
            {/* The analytics is in the menu only on wide screens; here it is reachable on a phone. */}
            <Link href="/content-analytics" className={cn(menuItem, "md:hidden")}>
              <BarChart3 />
              {t("content.analyticsLink")}
            </Link>
            {planner && !lawyer && (
              <form action={deliverTodayAction}>
                <input type="hidden" name="back" value={href({})} />
                <button type="submit" className={menuItem} title={t("content.telegram.hint")}>
                  <Send />
                  {t("content.telegram.today")}
                </button>
              </form>
            )}
            <a href={exportHref} className={menuItem}>
              <Download />
              {t("content.excel.download")}
            </a>
            {planner && !lawyer && (
              <details className="rounded-lg">
                <summary className={cn(menuItem, "cursor-pointer list-none")}>
                  <FileSpreadsheet />
                  {t("content.excel.upload")}
                </summary>
                <div className="flex flex-col gap-2 px-3 pt-1 pb-2">
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
          </MoreMenu>
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

      {/* Messages next to the buttons that caused them. */}
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
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm break-words"
        >
          {t(`content.errors.${params.error}` as TranslationKey, { mb: 50, max: 10 })}
        </p>
      )}

      {/* Phones: the numbers as one row of chips; the lists open on a tap. */}
      <details className="md:hidden">
        <summary className="flex cursor-pointer list-none flex-wrap gap-1.5 [&::-webkit-details-marker]:hidden">
          {cards.map((c) => (
            <span
              key={c.key}
              className={cn(
                "bg-card inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                c.posts.length === 0 && "text-muted-foreground",
              )}
            >
              {c.title}
              <span className={cn("font-semibold", c.posts.length > 0 && c.tone)}>
                {c.posts.length}
              </span>
            </span>
          ))}
        </summary>
        <div className="mt-3 grid gap-3">
          {cards.map((c) => (
            <AttentionCard
              key={c.key}
              title={c.title}
              posts={c.posts}
              tone={c.tone}
              marks={"marks" in c ? c.marks : undefined}
            />
          ))}
        </div>
      </details>
      <div
        className={cn(
          "hidden gap-3 md:grid",
          cards.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3",
        )}
      >
        {cards.map((c) => (
          <AttentionCard
            key={c.key}
            title={c.title}
            posts={c.posts}
            tone={c.tone}
            marks={"marks" in c ? c.marks : undefined}
          />
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-secondary/70 hidden gap-0.5 rounded-full p-1 text-sm md:inline-flex">
            {VIEWS.map((v) => (
              <Link key={v} href={href({ view: v })} className={pill(v === view)}>
                {t(`content.views.${v}`)}
              </Link>
            ))}
          </div>
          {/* On a phone the month, the week and the list are the same list of days. */}
          <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1 text-sm md:hidden">
            <Link href={href({ view: "month" })} className={pill(view !== "preview")}>
              {t("content.views.plan")}
            </Link>
            <Link href={href({ view: "preview" })} className={pill(view === "preview")}>
              {t("content.views.preview")}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display min-w-36 text-base font-medium">{title}</h2>
          <PeriodPicker
            chips={chips}
            active={chips.some((c) => c.key === shown) ? shown : null}
            step={{
              prev:
                view === "week"
                  ? href({ week: addDays(week, -7) })
                  : href({ month: addMonths(month, -1) }),
              next:
                view === "week"
                  ? href({ week: addDays(week, 7) })
                  : href({ month: addMonths(month, 1) }),
              prevLabel: t(view === "week" ? "content.week.prev" : "content.month.prev"),
              nextLabel: t(view === "week" ? "content.week.next" : "content.month.next"),
            }}
          />
          {/* Bots: one row that scrolls inside itself on a phone, never the page. */}
          <div className="bg-secondary/70 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 text-sm sm:ml-auto">
            {[null, ...CHANNELS].map((c) => (
              <Link
                key={c ?? "all"}
                href={href({ bot: c })}
                className={cn(pill((bot ?? null) === c), "flex items-center gap-1.5 px-3")}
              >
                {c && <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />}
                {c ? t(`content.channels.${c}`) : t("content.allBots")}
              </Link>
            ))}
          </div>
        </div>

        {(view === "week" || view === "month") && (
          <div className="hidden flex-col gap-1 md:flex">
            <StatusLegend />
            {movable.size > 0 && (
              <p className="text-muted-foreground text-xs">{t("content.dragHint")}</p>
            )}
          </div>
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
                        {list.slice(0, 3).map((post) => (
                          <DraggablePost
                            key={post.id}
                            id={post.id}
                            date={dayValue}
                            enabled={movable.has(post.id)}
                          >
                            <PostChip post={post} today={today} />
                          </DraggablePost>
                        ))}
                        {list.length > 3 && (
                          // The week of that day shows every post of it.
                          <Link
                            href={href({ view: "week", week: dayValue })}
                            className="text-muted-foreground hover:text-foreground px-1 text-[11px] hover:underline"
                          >
                            {t("content.month.more", { count: list.length - 3 })}
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
