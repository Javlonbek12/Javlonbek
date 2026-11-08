import Link from "next/link";

import { BRAND_COLOR, sectionMeta } from "@/components/content/analytics-charts";
import { AnalyticsTabs } from "@/components/content/analytics-tabs";
import { BOT_COLOR } from "@/components/content/bot-chip";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { PeriodPicker } from "@/components/ui/period-picker";
import { formatDay, formatMonth } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { loadAnalyticsPosts } from "@/modules/content/analytics";
import {
  contentOverview,
  HORIZONS,
  NO_TOPIC,
  overviewPeriod,
  type Horizon,
} from "@/modules/content/overview";
import { listSections } from "@/modules/content/sections";
import { formatRange, plural } from "@/modules/reports/format";

// The big picture for directors: one screen, the plan ahead in plain numbers and words.
export default async function ContentOverviewPage({
  searchParams,
}: PageProps<"/content-analytics/overview">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const horizon = (HORIZONS.find((h) => String(h) === params.months) ?? 3) as Horizon;
  const period = overviewPeriod(today, horizon);
  const [posts, sections] = await Promise.all([
    loadAnalyticsPosts(user, period.from, period.to),
    listSections(),
  ]);
  const meta = sectionMeta(sections);
  const topicName = (id: string) =>
    id === NO_TOPIC ? t("content.overview.noTopic") : (meta[id]?.name ?? "—");
  const topicColor = (id: string) =>
    id === NO_TOPIC ? "var(--muted-foreground)" : (meta[id]?.color ?? "var(--muted-foreground)");
  const o = contentOverview(posts, period.months);
  const maxTopic = Math.max(1, ...o.topics.map((s) => s.count));

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("content.analytics.title")}</h1>
      </div>
      <AnalyticsTabs active="overview" />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-1">
          <h2 className="font-display text-lg font-medium">{t("content.overview.title")}</h2>
          <InfoHint className="max-w-2xl">{t("content.overview.intro")}</InfoHint>
        </div>
        {/* The plan ahead: unlike the analytics tab, these periods look forward. */}
        <PeriodPicker
          label={t("content.overview.next")}
          chips={HORIZONS.map((h) => {
            const p = overviewPeriod(today, h);
            return {
              key: String(h),
              label: t(`content.overview.horizons.${h}`),
              href: `/content-analytics/overview?months=${h}`,
              dates: formatRange(p.from, p.to, today),
            };
          })}
          active={String(horizon)}
          dates={formatRange(period.from, period.to, today)}
        />
      </div>

      {o.total === 0 ? (
        <Card>
          <CardDescription>{t("content.overview.empty")}</CardDescription>
        </Card>
      ) : (
        <>
          {/* The headline numbers. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="gap-1 p-4 md:p-5">
              <span className="text-muted-foreground text-xs">{t("content.overview.total")}</span>
              <span className="font-display text-3xl font-semibold">{o.total}</span>
            </Card>
            <Card className="gap-1.5 p-4 md:p-5">
              <span className="text-muted-foreground text-xs">{t("content.overview.ready")}</span>
              {/* On a few posts a percentage says less than «2 из 3». */}
              <span className="font-display text-3xl font-semibold">
                {o.total < 10
                  ? t("content.overview.readyOf", { ready: o.ready, total: o.total })
                  : `${o.readyPercent}%`}
              </span>
              <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-emerald-600"
                  style={{ width: `${o.readyPercent}%` }}
                />
              </span>
              {o.total >= 10 && (
                <span className="text-muted-foreground text-xs">
                  {t("content.overview.readyOf", { ready: o.ready, total: o.total })}
                </span>
              )}
            </Card>
            <Card className="gap-1 p-4 md:p-5">
              <span className="text-muted-foreground text-xs">
                {t("content.overview.mainTopic")}
              </span>
              {o.mainTopic ? (
                <>
                  <span className="flex items-center gap-2 text-lg leading-tight font-semibold">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: topicColor(o.mainTopic.id) }}
                    />
                    {topicName(o.mainTopic.id)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {o.mainTopic.percent}% ·{" "}
                    {plural("content.analytics.postsCount", o.mainTopic.count)}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Card>
            <Card className="gap-2 p-4 md:p-5">
              <span className="text-muted-foreground text-xs">{t("content.overview.bots")}</span>
              {o.bots.map((b) => (
                <span key={b.channel} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: BOT_COLOR[b.channel] }}
                    />
                    <span className="truncate">{t(`content.channels.${b.channel}`)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{b.count}</span>
                </span>
              ))}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {/* What we talk about: one bar per section. */}
            <Card className="gap-3">
              <CardTitle>{t("content.overview.topics")}</CardTitle>
              <CardDescription>{t("content.overview.topicsHint")}</CardDescription>
              <ul className="flex flex-col gap-2.5">
                {o.topics.map((s) => (
                  <li
                    key={s.id || "none"}
                    className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem]"
                    title={`${topicName(s.id)}: ${s.count} (${s.percent}%)`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: topicColor(s.id) }}
                      />
                      <span className="truncate">{topicName(s.id)}</span>
                    </span>
                    <span className="bg-muted/60 h-3 rounded-full">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(3, (s.count / maxTopic) * 100)}%`,
                          background: topicColor(s.id),
                        }}
                      />
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-semibold">{s.percent}%</span>
                      <span className="text-muted-foreground"> · {s.count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* What each bot says. */}
            <Card className="gap-3">
              <CardTitle>{t("content.overview.audience")}</CardTitle>
              <CardDescription>{t("content.overview.audienceHint")}</CardDescription>
              <div className="flex flex-col gap-3">
                {o.bots.map((b) => (
                  <div
                    key={b.channel}
                    className="flex flex-col gap-2 rounded-xl border border-l-4 p-3"
                    style={{ borderLeftColor: BOT_COLOR[b.channel] }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{t(`content.channels.${b.channel}`)}</span>
                      <span className="text-muted-foreground text-xs">
                        {plural("content.analytics.postsCount", b.count)}
                      </span>
                    </div>
                    {b.topics.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {b.topics.map((s) => (
                          <span
                            key={s.id || "none"}
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ background: topicColor(s.id) }}
                            />
                            {topicName(s.id)}
                            <span className="text-muted-foreground tabular-nums">{s.percent}%</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t("content.overview.monthEmpty")}
                      </span>
                    )}
                    {b.brand && (
                      <span className="text-muted-foreground text-xs">
                        {t("content.overview.mainBrand", {
                          brand: t(`content.brands.${b.brand.id as keyof typeof BRAND_COLOR}`),
                        })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Brands: one stacked bar. */}
          <Card className="gap-3">
            <CardTitle>{t("content.overview.brands")}</CardTitle>
            <CardDescription>{t("content.overview.brandsHint")}</CardDescription>
            <div className="flex h-5 overflow-hidden rounded-full">
              {o.brands.map((b) => (
                <div
                  key={b.id}
                  className="border-card h-full border-r-2 last:border-r-0"
                  style={{ width: `${b.percent}%`, background: BRAND_COLOR[b.id] }}
                  title={`${t(`content.brands.${b.id}`)}: ${b.count} (${b.percent}%)`}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {o.brands.map((b) => (
                <li key={b.id} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: BRAND_COLOR[b.id] }} />
                  {t(`content.brands.${b.id}`)}
                  <span className="font-semibold tabular-nums">{b.percent}%</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {t("content.analytics.brands.general", { count: o.general })}
            </p>
          </Card>

          {/* Month by month: how much, the themes and the key messages. */}
          <Card className="gap-3">
            <CardTitle>{t("content.overview.months")}</CardTitle>
            <CardDescription>{t("content.overview.monthsHint")}</CardDescription>
            <div
              className={cn("grid gap-3", o.months.length > 1 && "md:grid-cols-2 xl:grid-cols-3")}
            >
              {o.months.map((m) => (
                <div key={m.month} className="flex flex-col gap-2.5 rounded-xl border p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display font-medium">{formatMonth(m.month)}</span>
                    <span className="text-muted-foreground text-xs">
                      {plural("content.analytics.postsCount", m.count)}
                    </span>
                  </div>
                  {m.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.topics.map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{
                            background: `color-mix(in oklch, ${topicColor(s.id)} 16%, transparent)`,
                          }}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ background: topicColor(s.id) }}
                          />
                          {topicName(s.id)}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.headlines.length > 0 ? (
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {m.headlines.map((h) => (
                        <li key={h.id} className="flex gap-2">
                          <span className="text-muted-foreground w-12 shrink-0 text-xs leading-5 tabular-nums">
                            {formatDay(h.date)}
                          </span>
                          <Link
                            href={`/content/${h.id}`}
                            className="min-w-0 flex-1 hover:underline"
                          >
                            {h.title}
                          </Link>
                          <span className="flex shrink-0 gap-0.5 pt-1.5">
                            {h.channels.map((c) => (
                              <span
                                key={c}
                                className="size-2 rounded-full"
                                style={{ background: BOT_COLOR[c] }}
                                aria-label={t(`content.channels.${c}`)}
                              />
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      {t("content.overview.monthEmpty")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
