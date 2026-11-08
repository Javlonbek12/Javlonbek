import Link from "next/link";

import { formatDay, formatMonth, fromDateString } from "@/lib/dates";
import type { ContentBrand, ContentChannel } from "@/lib/generated/prisma/enums";
import { t, dateFormat, currentLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  brandsByMonth,
  planVsFact,
  storylines,
  topicByBot,
  topicShares,
} from "@/modules/content/analytics";
import { squarify } from "@/modules/content/analytics";
import { CHANNELS } from "@/modules/content/service";
import { BRANDS } from "@/modules/content/tagging";
import { formatRange } from "@/modules/reports/format";

import { BOT_COLOR } from "./bot-chip";

// Name and colour of every section. A section keeps its colour everywhere: the colour follows
// its place among all sections (archived ones included), so archiving one repaints nothing.
export type SectionMeta = Record<string, { name: string; color: string }>;
export const sectionMeta = (
  all: { id: string; name: string; nameEn?: string | null }[],
): SectionMeta =>
  Object.fromEntries(
    all.map((s, i) => [
      s.id,
      {
        // In English when the viewer uses English and the section has an English name.
        name: currentLocale() === "en" && s.nameEn ? s.nameEn : s.name,
        color: `var(--series-${(i % 8) + 1})`,
      },
    ]),
  );
const NONE = { name: "—", color: "var(--muted-foreground)" };
export const BRAND_COLOR: Record<ContentBrand, string> = {
  ESSE: "var(--series-1)",
  BOHEM: "var(--series-2)",
  PINE: "var(--series-3)",
  BLOOMING: "var(--series-5)",
  SIMPLE: "var(--series-7)",
  GENERAL: "var(--muted-foreground)",
};

const monthShort = {
  format: (date: Date) => dateFormat({ month: "short", timeZone: "UTC" }).format(date),
};

function TopicLabel({ topic, meta }: { topic: string; meta: SectionMeta }) {
  const m = meta[topic] ?? NONE;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
      <span className="truncate">{m.name}</span>
    </span>
  );
}

type Line = ReturnType<typeof storylines>[number];

// What a lane says at its end: the next planned post; a warning only when the topic really is
// left behind (silent for weeks and nothing planned).
function LineNote({ line, today }: { line: Line; today: string }) {
  if (line.next)
    return (
      <span className="text-muted-foreground">
        {t("content.analytics.storylines.next", { date: formatRange(line.next, line.next, today) })}
      </span>
    );
  if (line.total === 0 || line.silentWeeks >= 3)
    return (
      <span className="font-medium text-amber-700">
        {t("content.analytics.storylines.notPlanned")}
      </span>
    );
  return null;
}

// 1. Storylines: topics as lanes, weeks as columns, posts as dots coloured by bot; a post not
// sent (yet) is a hollow dot.
export function Storylines({
  lines,
  weeks,
  meta,
  today,
}: {
  lines: Line[];
  weeks: string[];
  meta: SectionMeta;
  today: string;
}) {
  const months = weeks
    .map((w, i) => ({ i, key: w.slice(0, 7), label: monthShort.format(fromDateString(w)) }))
    .filter((m, i, all) => i === 0 || m.key !== all[i - 1]!.key);
  const gridStyle = {
    gridTemplateColumns: `11rem repeat(${weeks.length}, minmax(1.6rem, 1fr)) 8.5rem`,
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-max text-xs">
        <div className="grid border-b" style={gridStyle}>
          <div />
          {weeks.map((w, i) => {
            const m = months.find((x) => x.i === i);
            return (
              <div key={w} className="text-muted-foreground px-0.5 pb-1 text-[10px]">
                {m?.label ?? ""}
              </div>
            );
          })}
          <div />
        </div>
        {lines.map((line) => (
          <div
            key={line.topic}
            className="grid items-center border-b border-dashed last:border-b-0"
            style={gridStyle}
          >
            <div className="bg-card sticky left-0 z-10 flex items-center justify-between gap-1 py-2 pr-2 text-[13px]">
              <TopicLabel topic={line.topic} meta={meta} />
              <span className="text-muted-foreground tabular-nums">{line.total}</span>
            </div>
            {line.weeks.map((posts, i) => (
              <div
                key={weeks[i]}
                className="relative flex h-9 items-center justify-center"
                title={
                  posts.length
                    ? t("content.analytics.storylines.cell", {
                        date: formatDay(weeks[i]!),
                        titles: posts.map((p) => p.title).join("; "),
                      })
                    : undefined
                }
              >
                {/* The lane itself: a thin line in the topic's colour. */}
                <span
                  className="absolute inset-x-0 top-1/2 h-px opacity-25"
                  style={{ background: (meta[line.topic] ?? NONE).color }}
                />
                {posts.length > 0 && (
                  <span className="relative flex -space-x-1">
                    {posts.slice(0, 3).map((p) => {
                      const color = BOT_COLOR[p.channels[0] ?? "PARTNER"];
                      return (
                        <Link
                          key={p.id}
                          href={`/content/${p.id}`}
                          className="ring-card size-3 rounded-full border-2 ring-2"
                          style={{
                            borderColor: color,
                            background: p.status === "SENT" ? color : "var(--card)",
                          }}
                          aria-label={p.title}
                        />
                      );
                    })}
                    {posts.length > 3 && (
                      <span className="bg-card ml-1 rounded-full px-1 text-[10px] font-semibold">
                        +{posts.length - 3}
                      </span>
                    )}
                  </span>
                )}
              </div>
            ))}
            <div className="pl-2 text-[11px]">
              <LineNote line={line} today={today} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Storylines on a phone: each topic in one row — when it last had a post and the next one.
export function StorylineList({
  lines,
  meta,
  today,
}: {
  lines: Line[];
  meta: SectionMeta;
  today: string;
}) {
  return (
    <ul className="flex flex-col divide-y text-sm">
      {lines.map((line) => (
        <li key={line.topic} className="flex flex-col gap-0.5 py-2">
          <span className="flex items-center justify-between gap-2">
            <TopicLabel topic={line.topic} meta={meta} />
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {line.total}
            </span>
          </span>
          <span className="flex flex-wrap gap-x-3 pl-[18px] text-xs">
            <span className="text-muted-foreground">
              {line.last
                ? t("content.analytics.storylines.last", {
                    date: formatRange(line.last, line.last, today),
                  })
                : t("content.analytics.storylines.none")}
            </span>
            <LineNote line={line} today={today} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// 2. Focus: a treemap of topics by share of posts.
export function FocusMap({
  shares,
  meta,
}: {
  shares: ReturnType<typeof topicShares>;
  meta: SectionMeta;
}) {
  const W = 640;
  const H = 300;
  const rects = squarify(
    shares.map((s) => ({ ...s, value: s.count })),
    W,
    H,
  );
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("content.analytics.focus.title")}
      >
        {rects.map((r) => {
          const big = r.w > 70 && r.h > 44;
          // Fit the name into the tile (about 7 px per letter at this size).
          const { name, color } = meta[r.topic] ?? NONE;
          const fit = Math.max(3, Math.floor((r.w - 20) / 7));
          const label = name.length > fit ? `${name.slice(0, fit - 1)}…` : name;
          return (
            <g key={r.topic}>
              <rect
                x={r.x + 1}
                y={r.y + 1}
                width={Math.max(0, r.w - 2)}
                height={Math.max(0, r.h - 2)}
                rx="8"
                fill={color}
              >
                <title>{`${name}: ${r.count} (${r.percent}%)`}</title>
              </rect>
              {big && (
                <>
                  <text x={r.x + 12} y={r.y + 24} className="fill-white text-[14px] font-semibold">
                    {label}
                  </text>
                  <text
                    x={r.x + 12}
                    y={r.y + 46}
                    className="font-display fill-white text-[20px] font-semibold"
                  >
                    {r.percent}%
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {shares.map((s) => (
          <li key={s.topic} className="flex items-center justify-between gap-2">
            <TopicLabel topic={s.topic} meta={meta} />
            <span className="text-muted-foreground tabular-nums">
              {s.count} · {s.percent}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 3. Topics × bots: a heat table.
export function TopicBotMatrix({
  rows,
  meta,
}: {
  rows: ReturnType<typeof topicByBot>;
  meta: SectionMeta;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => CHANNELS.map((c) => r.bots[c])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="py-1.5 text-left font-medium" />
            {CHANNELS.map((c) => (
              <th key={c} className="px-1 py-1.5 font-medium">
                <span className="flex items-center justify-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />
                  {t(`content.channels.${c}`)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.topic}>
              <td className="py-1 pr-2 text-[13px]">
                <TopicLabel topic={row.topic} meta={meta} />
              </td>
              {CHANNELS.map((c: ContentChannel) => {
                const v = row.bots[c];
                return (
                  <td key={c} className="p-0.5">
                    <div
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md text-sm tabular-nums",
                        v === 0
                          ? "text-muted-foreground bg-muted/40"
                          : v / max > 0.55
                            ? "font-semibold text-white"
                            : "font-medium",
                      )}
                      style={
                        v
                          ? {
                              background: `color-mix(in oklch, var(--primary) ${Math.round(12 + 78 * (v / max))}%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      {v}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Topics × bots on a phone: a card per bot with its topics, biggest first.
export function TopicBotCards({
  rows,
  meta,
}: {
  rows: ReturnType<typeof topicByBot>;
  meta: SectionMeta;
}) {
  return (
    <div className="flex flex-col gap-2">
      {CHANNELS.map((c) => {
        const list = rows.filter((r) => r.bots[c] > 0).sort((a, b) => b.bots[c] - a.bots[c]);
        return (
          <div key={c} className="rounded-xl border p-3 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />
              {t(`content.channels.${c}`)}
            </span>
            {list.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t("content.analytics.storylines.none")}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
                {list.map((r) => (
                  <li key={r.topic} className="flex items-center justify-between gap-2">
                    <TopicLabel topic={r.topic} meta={meta} />
                    <span className="tabular-nums">{r.bots[c]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Brands with a brand: «Общее» (no particular brand) is most of the plan, so it stays out of the
// shares and is counted on its own line.
const BRANDED = BRANDS.filter((b) => b !== "GENERAL");

// 4. Brands: overall share and month by month.
export function BrandsChart({ data }: { data: ReturnType<typeof brandsByMonth> }) {
  const total = BRANDED.reduce((s, b) => s + data.totals[b], 0);
  const monthMax = Math.max(
    1,
    ...data.months.map((m) => BRANDED.reduce((s, b) => s + m.brands[b], 0)),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-4 overflow-hidden rounded-full">
        {BRANDED.filter((b) => data.totals[b]).map((b) => (
          <div
            key={b}
            className="border-card h-full border-r-2 last:border-r-0"
            style={{
              width: `${(data.totals[b] / Math.max(1, total)) * 100}%`,
              background: BRAND_COLOR[b],
            }}
            title={`${t(`content.brands.${b}`)}: ${data.totals[b]}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {BRANDED.map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: BRAND_COLOR[b] }} />
            {t(`content.brands.${b}`)}
            <span className="text-muted-foreground tabular-nums">
              {data.totals[b]}
              {total ? ` · ${Math.round((data.totals[b] / total) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {t("content.analytics.brands.general", { count: data.totals.GENERAL })}
      </p>
      {data.months.length > 1 && (
        <div className="flex h-40 items-end gap-2">
          {data.months.map((m) => {
            const sum = BRANDED.reduce((s, b) => s + m.brands[b], 0);
            return (
              <div
                key={m.month}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-xs font-semibold tabular-nums">{sum || ""}</span>
                <div
                  className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-t-[4px]"
                  style={{ height: `${(sum / monthMax) * 110}px` }}
                >
                  {BRANDED.filter((b) => m.brands[b]).map((b) => (
                    <div
                      key={b}
                      className="border-card w-full border-t-2 first:border-t-0"
                      style={{
                        height: `${(m.brands[b] / Math.max(1, sum)) * 100}%`,
                        background: BRAND_COLOR[b],
                      }}
                      title={`${formatMonth(m.month)} · ${t(`content.brands.${b}`)}: ${m.brands[b]}`}
                    />
                  ))}
                </div>
                <span className="text-muted-foreground text-[10px]">
                  {monthShort.format(fromDateString(m.month))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 5. Plan vs fact: the wanted share against the real one, gaps over 5 points highlighted.
export function PlanFact({
  rows,
  meta,
}: {
  rows: ReturnType<typeof planVsFact>;
  meta: SectionMeta;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.target, r.actual]));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-muted-foreground flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="border-muted-foreground h-2.5 w-4 rounded-sm border border-dashed" />
          {t("content.analytics.plan.target")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-foreground/70 h-2.5 w-4 rounded-sm" />
          {t("content.analytics.plan.actual")}
        </span>
      </div>
      {rows.map((r) => (
        <div
          key={r.topic}
          className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem]"
        >
          <TopicLabel topic={r.topic} meta={meta} />
          <div className="flex flex-col gap-1">
            <div
              className="border-muted-foreground/50 h-2.5 rounded-sm border border-dashed"
              style={{ width: `${(r.target / max) * 100}%` }}
              title={`${t("content.analytics.plan.target")}: ${r.target}%`}
            />
            <div
              className="h-2.5 rounded-sm"
              style={{
                width: `${Math.max(1, (r.actual / max) * 100)}%`,
                background: (meta[r.topic] ?? NONE).color,
              }}
              title={`${t("content.analytics.plan.actual")}: ${r.actual}%`}
            />
          </div>
          <span
            className={cn(
              "text-right text-xs font-medium tabular-nums",
              r.gap <= -5
                ? "text-destructive"
                : r.gap >= 5
                  ? "text-amber-700"
                  : "text-muted-foreground",
            )}
          >
            {r.actual}%{" "}
            {r.gap === 0
              ? ""
              : r.gap > 0
                ? t("content.analytics.plan.more", { count: r.gap })
                : t("content.analytics.plan.less", { count: -r.gap })}
          </span>
        </div>
      ))}
    </div>
  );
}
