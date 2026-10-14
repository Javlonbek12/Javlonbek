import Link from "next/link";

import {
  BrandsChart,
  FocusMap,
  PlanFact,
  Storylines,
  sectionMeta,
  TopicBotMatrix,
} from "@/components/content/analytics-charts";
import { AnalyticsTabs } from "@/components/content/analytics-tabs";
import { BOT_COLOR } from "@/components/content/bot-chip";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { listSections } from "@/modules/content/sections";

import {
  archiveSectionAction,
  deleteSectionAction,
  retagAction,
  saveSectionAction,
  saveTargetsAction,
} from "./actions";

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
  const [posts, sections] = await Promise.all([
    loadAnalyticsPosts(user, period.from, period.to, { bot, sentOnly }),
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
    if (next.sent ?? sentOnly) query.set("sent", "1");
    return `/content-analytics?${query}`;
  };
  const planner = canPlanContent(user);
  const DONE = ["saved", "created", "archived", "restored", "deleted", "retagged"] as const;
  const ERRORS = ["invalid", "state", "forbidden", "notFound"] as const;
  const sectionDone = DONE.find((d) => d === params.section);
  const sectionError = ERRORS.find((e) => e === params.sectionError);
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
      <AnalyticsTabs active="analytics" />

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
            <Storylines
              lines={storylines(posts, period.weeks, topics)}
              weeks={period.weeks}
              meta={meta}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.focus.title")}</CardTitle>
              <CardDescription>{t("content.analytics.focus.hint")}</CardDescription>
              <FocusMap shares={topicShares(posts, topics)} meta={meta} />
            </Card>
            <Card className="gap-3">
              <CardTitle>{t("content.analytics.matrix.title")}</CardTitle>
              <CardDescription>{t("content.analytics.matrix.hint")}</CardDescription>
              <TopicBotMatrix rows={topicByBot(posts, topics)} meta={meta} />
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
              <PlanFact rows={planVsFact(posts, targets, topics)} meta={meta} />
              {planner && (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("content.analytics.plan.edit")}
                  </summary>
                  <form action={saveTargetsAction} className="mt-3 flex flex-col gap-2 text-sm">
                    <input type="hidden" name="back" value={href({})} />
                    <div className="grid grid-cols-2 gap-2">
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

      {planner && (
        <Card id="sections" className="scroll-mt-20 gap-3">
          <CardTitle>{t("content.analytics.sections.title")}</CardTitle>
          <CardDescription>{t("content.analytics.sections.hint")}</CardDescription>
          {sectionDone && (
            <p className="text-sm text-emerald-700">
              {t(`content.analytics.sections.done.${sectionDone}`, {
                count: String(params.count ?? 0),
              })}
            </p>
          )}
          {sectionError && (
            <p className="text-destructive text-sm">
              {t(`content.analytics.sections.errors.${sectionError}`)}
            </p>
          )}
          <ul className="flex flex-col divide-y">
            {sections.map((section) => (
              <li key={section.id} className="flex flex-col gap-2 py-3">
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: meta[section.id]?.color }}
                    />
                    <span
                      className={cn("font-medium", section.archived && "text-muted-foreground")}
                    >
                      {meta[section.id]?.name ?? section.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("content.analytics.sections.posts", { count: section.posts })}
                      {section.archived && ` · ${t("content.analytics.sections.archived")}`}
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    <SectionForm section={section} back={href({})} />
                    <div className="flex flex-wrap gap-2">
                      <form action={archiveSectionAction}>
                        <input type="hidden" name="back" value={href({})} />
                        <input type="hidden" name="id" value={section.id} />
                        <input type="hidden" name="archived" value={section.archived ? "0" : "1"} />
                        <Button type="submit" size="sm" variant="outline">
                          {section.archived
                            ? t("content.analytics.sections.restore")
                            : t("content.analytics.sections.archive")}
                        </Button>
                      </form>
                      {section.posts === 0 && (
                        <form action={deleteSectionAction}>
                          <input type="hidden" name="back" value={href({})} />
                          <input type="hidden" name="id" value={section.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                          >
                            {t("content.analytics.sections.delete")}
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                </details>
                {section.description && (
                  <p className="text-muted-foreground pl-[18px] text-xs">{section.description}</p>
                )}
              </li>
            ))}
          </ul>
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("content.analytics.sections.add")}
            </summary>
            <div className="mt-3">
              <SectionForm
                section={{
                  id: "",
                  name: "",
                  nameEn: null,
                  description: null,
                  sortOrder: sections.length,
                }}
                back={href({})}
              />
            </div>
          </details>
          <form action={retagAction} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
            <input type="hidden" name="back" value={href({})} />
            <input type="hidden" name="from" value={period.from} />
            <input type="hidden" name="to" value={period.to} />
            <span className="text-muted-foreground text-xs">
              {t("content.analytics.sections.retagHint")} ({formatDay(period.from)} –{" "}
              {formatDay(period.to)})
            </span>
            <div>
              <Button type="submit" size="sm" variant="outline">
                {t("content.analytics.sections.retag")}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function SectionForm({
  section,
  back,
}: {
  section: {
    id: string;
    name: string;
    nameEn: string | null;
    description: string | null;
    sortOrder: number;
  };
  back: string;
}) {
  return (
    <form action={saveSectionAction} className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={section.id} />
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <label className="flex flex-col gap-1">
          {t("content.analytics.sections.name")}
          <Input name="name" defaultValue={section.name} required maxLength={60} />
        </label>
        <label className="flex flex-col gap-1">
          {t("content.analytics.sections.order")}
          <Input
            type="number"
            name="sortOrder"
            min={0}
            max={999}
            defaultValue={section.sortOrder}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        {t("content.analytics.sections.nameEn")}
        <Input name="nameEn" defaultValue={section.nameEn ?? ""} maxLength={60} />
      </label>
      <label className="flex flex-col gap-1">
        {t("content.analytics.sections.description")}
        <Textarea
          name="description"
          defaultValue={section.description ?? ""}
          maxLength={300}
          rows={2}
        />
      </label>
      <div>
        <Button type="submit" size="sm">
          {section.id ? t("content.analytics.sections.save") : t("content.analytics.sections.add")}
        </Button>
      </div>
    </form>
  );
}
