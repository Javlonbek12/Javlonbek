import Link from "next/link";

import {
  BrandsChart,
  FocusMap,
  PlanFact,
  Storylines,
  TopicBotMatrix,
  TOPIC_COLOR,
} from "@/components/content/analytics-charts";
import { BOT_COLOR } from "@/components/content/bot-chip";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/dates";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import {
  analyticsPeriod,
  brandsByMonth,
  getContentTargets,
  loadAnalyticsPosts,
  PERIODS,
  planVsFact,
  storylines,
  topicByBot,
  topicShares,
  type PeriodMonths,
} from "@/modules/content/analytics";
import { canPlanContent, CHANNELS } from "@/modules/content/service";
import { TOPICS } from "@/modules/content/tagging";

import { saveTargetsAction } from "./actions";

export default async function ContentAnalyticsPage({
  searchParams,
}: PageProps<"/content-analytics">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const months = (PERIODS.find((p) => String(p) === params.months) ?? 3) as PeriodMonths;
  const bot = CHANNELS.find((c) => c === params.bot) as ContentChannel | undefined;
  const sentOnly = params.sent === "1";
  const period = analyticsPeriod(today, months);
  const [posts, targets] = await Promise.all([
    loadAnalyticsPosts(user, period.from, period.to, { bot, sentOnly }),
    getContentTargets(),
  ]);
  const untagged = posts.filter((p) => !p.topic).length;
  const href = (next: { months?: number; bot?: string | null; sent?: boolean }) => {
    const query = new URLSearchParams({ months: String(next.months ?? months) });
    const b = next.bot === undefined ? bot : next.bot;
    if (b) query.set("bot", b);
    if (next.sent ?? sentOnly) query.set("sent", "1");
    return `/content-analytics?${query}`;
  };
  const planner = canPlanContent(user);
  const pill = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1 whitespace-nowrap",
      active ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
    );

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("content.analytics.title")}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t("content.analytics.intro")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1">
          {PERIODS.map((m) => (
            <Link key={m} href={href({ months: m })} className={pill(m === months)}>
              {t("content.analytics.months", { count: m })}
            </Link>
          ))}
        </div>
        <div className="bg-secondary/70 inline-flex flex-wrap gap-0.5 rounded-2xl p-1 sm:rounded-full">
          {[null, ...CHANNELS].map((c) => (
            <Link
              key={c ?? "all"}
              href={href({ bot: c })}
              className={cn(pill((bot ?? null) === c), "flex items-center gap-1.5")}
            >
              {c && <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />}
              {c ? t(`content.channels.${c}`) : t("content.allBots")}
            </Link>
          ))}
        </div>
        <div className="bg-secondary/70 inline-flex gap-0.5 rounded-full p-1">
          <Link href={href({ sent: false })} className={pill(!sentOnly)}>
            {t("content.analytics.all")}
          </Link>
          <Link href={href({ sent: true })} className={pill(sentOnly)}>
            {t("content.analytics.sentOnly")}
          </Link>
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">
        {formatDay(period.from)} – {formatDay(period.to)} ·{" "}
        {t("content.analytics.posts", { count: posts.length })}
        {untagged > 0 && ` · ${t("content.analytics.pending", { count: untagged })}`}
      </p>

      {posts.length === 0 ? (
        <Card>
          <CardDescription>{t("content.analytics.empty")}</CardDescription>
        </Card>
      ) : (
        <>
          <Card className="gap-3">
            <CardTitle>{t("content.analytics.storylines.title")}</CardTitle>
            <CardDescription>{t("content.analytics.storylines.hint")}</CardDescription>
            <Storylines lines={storylines(posts, period.weeks)} weeks={period.weeks} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.focus.title")}</CardTitle>
              <CardDescription>{t("content.analytics.focus.hint")}</CardDescription>
              <FocusMap shares={topicShares(posts)} />
            </Card>
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.matrix.title")}</CardTitle>
              <CardDescription>{t("content.analytics.matrix.hint")}</CardDescription>
              <TopicBotMatrix rows={topicByBot(posts)} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.brands.title")}</CardTitle>
              <CardDescription>{t("content.analytics.brands.hint")}</CardDescription>
              <BrandsChart data={brandsByMonth(posts, period.months)} />
            </Card>
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.plan.title")}</CardTitle>
              <CardDescription>{t("content.analytics.plan.hint")}</CardDescription>
              {params.targets === "saved" && (
                <p className="text-sm text-emerald-700">{t("content.analytics.plan.saved")}</p>
              )}
              {params.targets === "invalid" && (
                <p className="text-destructive text-sm">{t("content.analytics.plan.invalid")}</p>
              )}
              <PlanFact rows={planVsFact(posts, targets)} />
              {planner && (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("content.analytics.plan.edit")}
                  </summary>
                  <form action={saveTargetsAction} className="mt-3 flex flex-col gap-2 text-sm">
                    <input type="hidden" name="back" value={href({})} />
                    <div className="grid grid-cols-2 gap-2">
                      {TOPICS.map((topic) => (
                        <label key={topic} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: TOPIC_COLOR[topic] }}
                            />
                            <span className="truncate">{t(`content.topics.${topic}`)}</span>
                          </span>
                          <Input
                            type="number"
                            name={topic}
                            min={0}
                            max={100}
                            defaultValue={targets[topic]}
                            className="w-20"
                          />
                        </label>
                      ))}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {t("content.analytics.plan.sum", {
                        sum: TOPICS.reduce((s, tp) => s + targets[tp], 0),
                      })}
                    </span>
                    <div>
                      <Button type="submit" size="sm">
                        {t("content.analytics.plan.save")}
                      </Button>
                    </div>
                  </form>
                </details>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
