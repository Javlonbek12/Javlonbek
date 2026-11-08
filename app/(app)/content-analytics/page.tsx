import {
  BrandsChart,
  FocusMap,
  PlanFact,
  StorylineList,
  Storylines,
  sectionMeta,
  TopicBotCards,
  TopicBotMatrix,
} from "@/components/content/analytics-charts";
import { AnalyticsTabs } from "@/components/content/analytics-tabs";
import { BOT_COLOR } from "@/components/content/bot-chip";
import { ExecutionBlock } from "@/components/content/execution-block";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PeriodPicker } from "@/components/ui/period-picker";
import { Segmented } from "@/components/ui/segmented";
import { addDays, addMonths } from "@/lib/dates";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getSettings, getUserToday } from "@/modules/core/settings/service";
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
import { loadExecution, planExecution } from "@/modules/content/execution";
import { canPlanContent, CHANNELS } from "@/modules/content/service";
import { listSections } from "@/modules/content/sections";
import { formatRange, plural } from "@/modules/reports/format";

import { saveTargetsAction } from "./actions";

// The results of the content plan: how it was carried out, then what it was about.
export default async function ContentAnalyticsPage({
  searchParams,
}: PageProps<"/content-analytics">) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getUserToday(user.id);
  const { timezone } = await getSettings(user.id);
  const months = (PERIODS.find((p) => String(p) === params.months) ?? 3) as PeriodMonths;
  const bot = CHANNELS.find((c) => c === params.bot) as ContentChannel | undefined;
  // Facts by default: what was really sent. The whole plan is one press away.
  const sentOnly = params.posts !== "all";
  const period = analyticsPeriod(today, months);
  const [posts, upcoming, executionPosts, sections] = await Promise.all([
    loadAnalyticsPosts(user, period.from, period.to, { bot, sentOnly }),
    loadAnalyticsPosts(user, addDays(today, 1), addMonths(today, 6), { bot }),
    loadExecution(user, period.from, today, timezone, { bot }),
    listSections(),
  ]);
  const meta = sectionMeta(sections);
  const active = sections.filter((s) => !s.archived);
  const topics = active.map((s) => s.id);
  const targets = await getContentTargets(topics);
  const untagged = posts.filter((p) => !p.topic).length;
  const href = (next: { months?: number; bot?: string | null; sent?: boolean }) => {
    const query = new URLSearchParams({ months: String(next.months ?? months) });
    const b = next.bot === undefined ? bot : next.bot;
    if (b) query.set("bot", b);
    if (!(next.sent ?? sentOnly)) query.set("posts", "all");
    return `/content-analytics?${query}`;
  };
  const planner = canPlanContent(user);
  const lines = storylines(posts, period.weeks, topics, today, upcoming);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("content.analytics.title")}
        hint={t("content.analytics.intro")}
        hintClassName="max-w-3xl"
      />
      <AnalyticsTabs active="analytics" />

      <div className="flex flex-col gap-2">
        <PeriodPicker
          label={t("content.analytics.past")}
          chips={PERIODS.map((m) => ({
            key: String(m),
            label: t("content.analytics.months", { count: m }),
            href: href({ months: m }),
            dates: formatRange(analyticsPeriod(today, m).from, today, today),
          }))}
          active={String(months)}
          dates={formatRange(period.from, period.to, today)}
        />
        {/* Bots: one row that scrolls inside itself on a phone, never the page. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Segmented
            label={t("content.channels.label")}
            className="overflow-x-auto"
            items={[null, ...CHANNELS].map((c) => ({
              key: c ?? "all",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {c && (
                    <span className="size-2 rounded-full" style={{ background: BOT_COLOR[c] }} />
                  )}
                  {c ? t(`content.channels.${c}`) : t("content.allBots")}
                </span>
              ),
              href: href({ bot: c }),
              active: (bot ?? null) === c,
            }))}
          />
        </div>
      </div>

      <ExecutionBlock data={planExecution(executionPosts, today)} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium">{t("content.analytics.contents")}</h2>
          <Segmented
            label={t("content.analytics.contents")}
            items={[
              {
                key: "sent",
                label: t("content.analytics.sentOnly"),
                href: href({ sent: true }),
                active: sentOnly,
              },
              {
                key: "all",
                label: t("content.analytics.all"),
                href: href({ sent: false }),
                active: !sentOnly,
              },
            ]}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {plural("content.analytics.postsCount", posts.length)}
          {untagged > 0 && ` · ${t("content.analytics.pending", { count: untagged })}`}
        </p>
      </div>

      {posts.length === 0 ? (
        <Card>
          <CardDescription>{t("content.analytics.empty")}</CardDescription>
        </Card>
      ) : (
        <>
          <Card className="gap-3">
            <div className="flex flex-wrap items-center gap-x-1">
              <CardTitle>{t("content.analytics.storylines.title")}</CardTitle>
              <InfoHint>{t("content.analytics.storylines.hint")}</InfoHint>
            </div>
            {/* Phones: a list «тема — был — следующий»; wider screens: the lanes by week. */}
            <div className="md:hidden">
              <StorylineList lines={lines} meta={meta} today={today} />
            </div>
            <div className="hidden md:block">
              <Storylines lines={lines} weeks={period.weeks} meta={meta} today={today} />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-3">
              <div className="flex flex-wrap items-center gap-x-1">
                <CardTitle>{t("content.analytics.focus.title")}</CardTitle>
                <InfoHint>{t("content.analytics.focus.hint")}</InfoHint>
              </div>
              <FocusMap shares={topicShares(posts, topics)} meta={meta} />
            </Card>
            <Card className="gap-3">
              <div className="flex flex-wrap items-center gap-x-1">
                <CardTitle>{t("content.analytics.matrix.title")}</CardTitle>
                <InfoHint>
                  {t(
                    sentOnly ? "content.analytics.matrix.hint" : "content.analytics.matrix.hintAll",
                  )}
                </InfoHint>
              </div>
              <div className="md:hidden">
                <TopicBotCards rows={topicByBot(posts, topics)} meta={meta} />
              </div>
              <div className="hidden md:block">
                <TopicBotMatrix rows={topicByBot(posts, topics)} meta={meta} />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-3">
              <div className="flex flex-wrap items-center gap-x-1">
                <CardTitle>{t("content.analytics.brands.title")}</CardTitle>
                <InfoHint>{t("content.analytics.brands.hint")}</InfoHint>
              </div>
              <BrandsChart data={brandsByMonth(posts, period.months)} />
            </Card>
            <Card className="gap-3">
              <div className="flex flex-wrap items-center gap-x-1">
                <CardTitle>{t("content.analytics.plan.title")}</CardTitle>
                <InfoHint>{t("content.analytics.plan.hint")}</InfoHint>
              </div>
              {params.targets === "saved" && (
                <p className="text-sm text-emerald-700">{t("content.analytics.plan.saved")}</p>
              )}
              {params.targets === "invalid" && (
                <p className="text-destructive text-sm">{t("content.analytics.plan.invalid")}</p>
              )}
              <PlanFact rows={planVsFact(posts, targets, topics)} meta={meta} />
              {planner && (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("content.analytics.plan.edit")}
                  </summary>
                  <form action={saveTargetsAction} className="mt-3 flex flex-col gap-2 text-sm">
                    <input type="hidden" name="back" value={href({})} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      {topics.map((topic) => (
                        <label key={topic} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: meta[topic]?.color }}
                            />
                            <span className="truncate">{meta[topic]?.name}</span>
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
                        sum: topics.reduce((s, tp) => s + (targets[tp] ?? 0), 0),
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
