import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { addDays, formatDay, fromDateString, toDateString } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { deleteContentAction } from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/button";
import { displayName } from "@/modules/core/users/display-name";
import type { listPostsBetween } from "@/modules/content/service";

import { BOT_COLOR, BotChip, ContentStatusBadge } from "./bot-chip";
import { DraggablePost, DropDay } from "./drag";
import { TelegramBubble, TelegramChat } from "./post-preview";

export type Post = Awaited<ReturnType<typeof listPostsBetween>>[number];

const STATUS_EDGE: Record<Post["status"], string> = {
  PLANNED: "border-l-muted-foreground/30",
  DRAFT: "border-l-blue-500",
  REVIEW: "border-l-amber-500",
  LEGAL_REVIEW: "border-l-violet-500",
  CHANGES: "border-l-destructive",
  APPROVED: "border-l-emerald-500",
  SENT: "border-l-emerald-700",
  CANCELLED: "border-l-muted",
};

// The thumbnail: the first photo (Russian first).
const imageOf = (post: Post) => {
  const photo = post.files.find((f) => f.kind === "PHOTO");
  return photo ? `/api/content/files/${photo.id}` : null;
};

const weekdayShort = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });

export function groupByDay(posts: Post[]) {
  const byDay = new Map<string, Post[]>();
  for (const post of posts) {
    const key = toDateString(post.publishDate);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }
  return byDay;
}

// A post as a small card: bots, time, topic and the visual's thumbnail (week view).
function WeekCard({ post }: { post: Post }) {
  const image = imageOf(post);
  return (
    <Link
      href={`/content/${post.id}`}
      title={`${post.title} · ${t(`content.status.${post.status}`)}`}
      className={cn(
        "bg-card hover:border-primary/40 flex gap-1.5 rounded-lg border border-l-[3px] p-1.5 text-[11px] leading-tight shadow-xs transition-colors",
        STATUS_EDGE[post.status],
        post.status === "CANCELLED" && "line-through opacity-50",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1">
          {post.channels.map((c) => (
            <span
              key={c}
              className="flex size-4 items-center justify-center rounded-[5px] text-[9px] font-bold text-white"
              style={{ background: BOT_COLOR[c] }}
              aria-label={t(`content.channels.${c}`)}
            >
              {c[0]}
            </span>
          ))}
          {post.publishTime && (
            <span className="text-muted-foreground ml-auto">{post.publishTime}</span>
          )}
        </span>
        <span className="line-clamp-2 font-medium">{post.title}</span>
      </span>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- private image from our API
        <img src={image} alt="" className="size-9 shrink-0 rounded-md object-cover" />
      )}
    </Link>
  );
}

const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i); // 08:00 … 21:00

// Week: days in columns, hours in rows, like a planning board. Posts without a time sit on top.
export function WeekView({
  start,
  posts,
  today,
  planner,
  movable,
}: {
  start: string;
  posts: Post[];
  today: string;
  planner: boolean;
  // Posts this person may drag to another day.
  movable: Set<string>;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = groupByDay(posts);
  const hourOf = (post: Post) =>
    post.publishTime ? Math.min(21, Math.max(8, Number(post.publishTime.slice(0, 2)))) : null;
  const rows: { key: string; label: string; hour: number | null }[] = [
    { key: "none", label: t("content.week.noTime"), hour: null },
    ...HOURS.map((h) => ({ key: String(h), label: `${String(h).padStart(2, "0")}:00`, hour: h })),
  ];
  const cols = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
  return (
    <>
      <div className="bg-card shadow-card hidden overflow-hidden rounded-2xl border md:block">
        <div className={cn("grid border-b", cols)}>
          <div />
          {days.map((d) => (
            <div key={d} className="flex items-center justify-between border-l px-2 py-2">
              <span className="flex items-baseline gap-1.5 text-sm">
                <span
                  className={cn(
                    "font-display flex size-7 items-center justify-center rounded-full text-sm",
                    d === today && "bg-primary text-primary-foreground",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                <span className="text-muted-foreground text-xs capitalize">
                  {weekdayShort.format(fromDateString(d))}
                </span>
              </span>
              {planner && (
                <Link
                  href={`/content/new?date=${d}`}
                  aria-label={t("content.add")}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full p-1"
                >
                  <Plus className="size-3.5" />
                </Link>
              )}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "grid border-b last:border-b-0",
              cols,
              row.hour === null
                ? "bg-muted/30"
                : row.hour % 2 === 0 && "bg-[oklch(0.985_0.006_250)]",
            )}
          >
            <div className="text-muted-foreground px-1.5 pt-1.5 text-right text-[10px] leading-tight">
              {row.label}
            </div>
            {days.map((d) => {
              const list = (byDay.get(d) ?? []).filter((p) => hourOf(p) === row.hour);
              return (
                <DropDay
                  key={d}
                  date={d}
                  errorText={t("content.errors.move")}
                  className="flex min-h-12 min-w-0 flex-col gap-1 border-l p-1"
                >
                  {list.map((post) => (
                    <DraggablePost
                      key={post.id}
                      id={post.id}
                      date={d}
                      enabled={movable.has(post.id)}
                    >
                      <WeekCard post={post} />
                    </DraggablePost>
                  ))}
                </DropDay>
              );
            })}
          </div>
        ))}
      </div>
      <div className="md:hidden">
        <DayList days={days.filter((d) => byDay.has(d))} byDay={byDay} today={today} />
      </div>
    </>
  );
}

// Phones (and the month on phones): days with their posts.
export function DayList({
  days,
  byDay,
  today,
}: {
  days: string[];
  byDay: Map<string, Post[]>;
  today: string;
}) {
  if (!days.length)
    return <p className="text-muted-foreground text-sm">{t("content.list.empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {days.map((d) => (
        <div key={d} className="flex flex-col gap-1.5">
          <span className={cn("text-sm font-medium", d === today && "text-primary")}>
            {formatDay(d)}, {weekdayShort.format(fromDateString(d))}
          </span>
          {(byDay.get(d) ?? []).map((post) => {
            const image = imageOf(post);
            return (
              <Link
                key={post.id}
                href={`/content/${post.id}`}
                className={cn(
                  "bg-card shadow-card flex gap-3 rounded-xl border border-l-[3px] p-3",
                  STATUS_EDGE[post.status],
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium">
                    {post.publishTime && (
                      <span className="text-muted-foreground mr-1.5">{post.publishTime}</span>
                    )}
                    {post.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <ContentStatusBadge status={post.status} />
                    {post.channels.map((c) => (
                      <BotChip key={c} channel={c} sent={post.sentChannels.includes(c)} />
                    ))}
                  </span>
                </span>
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element -- private image from our API
                  <img src={image} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// List: everything in the period as a table (cards on phones).
export function ListView({
  posts,
  today,
  deletable,
  back,
}: {
  posts: Post[];
  today: string;
  // Posts this person may delete.
  deletable: Set<string>;
  back: string;
}) {
  const byDay = groupByDay(posts);
  return (
    <>
      <div className="bg-card shadow-card hidden overflow-x-auto rounded-2xl border md:block">
        {posts.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">{t("content.list.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("content.list.date")}</th>
                <th className="px-3 py-2.5 font-medium">{t("content.list.topic")}</th>
                <th className="px-3 py-2.5 font-medium">{t("content.list.bots")}</th>
                <th className="px-3 py-2.5 font-medium">{t("content.list.author")}</th>
                <th className="px-3 py-2.5 font-medium">{t("content.list.materials")}</th>
                <th className="px-3 py-2.5 font-medium">{t("content.list.status")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => {
                const date = toDateString(post.publishDate);
                return (
                  <tr key={post.id} className="hover:bg-accent/40 border-b last:border-b-0">
                    <td
                      className={cn(
                        "px-3 py-2.5 whitespace-nowrap",
                        date === today && "text-primary font-medium",
                      )}
                    >
                      {formatDay(date)}
                      {post.publishTime && (
                        <span className="text-muted-foreground"> {post.publishTime}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/content/${post.id}`} className="font-medium hover:underline">
                        {post.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {post.channels.map((c) => (
                          <BotChip key={c} channel={c} sent={post.sentChannels.includes(c)} />
                        ))}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      {post.author ? displayName(post.author) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                      {[
                        post.files.length > 0 && `${t("content.list.visual")} ${post.files.length}`,
                        post.textRu && "RU",
                        post.textUz && "UZ",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <ContentStatusBadge status={post.status} />
                    </td>
                    <td className="px-2 py-2.5">
                      {deletable.has(post.id) && (
                        <DeleteButton postId={post.id} back={back} compact />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="md:hidden">
        <DayList days={[...byDay.keys()]} byDay={byDay} today={today} />
      </div>
    </>
  );
}

const dayLong = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// Preview: the period as a Telegram chat — date separators, every post as a message with its
// picture and text (RU or UZ); status, bots and a link under each message.
export function PreviewView({
  posts,
  lang,
  langHref,
}: {
  posts: Post[];
  lang: "ru" | "uz";
  langHref: (lang: "ru" | "uz") => string;
}) {
  const byDay = groupByDay(posts);
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-secondary/70 inline-flex w-fit gap-0.5 rounded-full p-1 text-xs">
        {(["ru", "uz"] as const).map((l) => (
          <Link
            key={l}
            href={langHref(l)}
            className={cn(
              "rounded-full px-3 py-1 font-medium",
              lang === l ? "bg-card shadow-sm" : "text-muted-foreground",
            )}
          >
            {l.toUpperCase()}
          </Link>
        ))}
      </div>
      {posts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("content.list.empty")}</p>
      ) : (
        <TelegramChat className="mx-auto w-full max-w-xl">
          <div className="flex flex-col gap-3">
            {[...byDay.entries()].map(([d, list]) => (
              <div key={d} className="flex flex-col gap-2.5">
                <span className="mx-auto rounded-full bg-black/25 px-3 py-0.5 text-[13px] font-medium text-white">
                  {dayLong.format(fromDateString(d))}
                </span>
                {list.map((post) => (
                  <div key={post.id} className="flex flex-col gap-1">
                    <TelegramBubble
                      files={post.files.filter((f) => f.lang === (lang === "uz" ? "UZ" : "RU"))}
                      text={lang === "uz" ? post.textUz : post.textRu}
                      time={post.publishTime}
                      sender={{
                        name: post.channels.map((c) => t(`content.channels.${c}`)).join(" · "),
                        color: BOT_COLOR[post.channels[0] ?? "PARTNER"],
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 pl-1">
                      <ContentStatusBadge status={post.status} />
                      <Link
                        href={`/content/${post.id}`}
                        className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-medium text-neutral-800 hover:bg-white"
                      >
                        {post.title} →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </TelegramChat>
      )}
    </div>
  );
}

// Delete with a confirmation step (no script needed: the button opens a small panel).
export function DeleteButton({
  postId,
  back,
  compact,
}: {
  postId: string;
  back: string;
  compact?: boolean;
}) {
  return (
    <details className="relative">
      <summary
        className={cn(
          "text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex cursor-pointer list-none items-center gap-1.5 rounded-full text-sm [&::-webkit-details-marker]:hidden",
          compact ? "size-8 justify-center" : "w-fit px-3 py-1.5",
        )}
        aria-label={t("content.remove.button")}
      >
        <Trash2 className="size-4" />
        {!compact && t("content.remove.button")}
      </summary>
      <div className="bg-card shadow-card absolute right-0 z-30 mt-1 flex w-64 flex-col gap-2 rounded-xl border p-3 text-sm">
        <span className="font-medium">{t("content.remove.title")}</span>
        <span className="text-muted-foreground text-xs">{t("content.remove.confirm")}</span>
        <form action={deleteContentAction}>
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="back" value={back} />
          <Button type="submit" variant="destructive" size="sm">
            {t("content.remove.yes")}
          </Button>
        </form>
      </div>
    </details>
  );
}
