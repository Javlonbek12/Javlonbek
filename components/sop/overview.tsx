import { Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CALENDAR_STEPS,
  CHECKLIST_ITEMS,
  checklistCounts,
  checklistRules,
  currentStep,
} from "@/modules/sop/calendar";
import type { SopData } from "@/modules/sop/load";
import { findingsHref, skuHref } from "@/modules/sop/links";
import type { SopReport } from "@/modules/sop/report";
import { cases, coverText, describeFinding, monthLabel } from "@/modules/sop/texts";

import { PsiChart } from "./chart";
import { Chip, Section, SeverityMark, Tiles, type TileItem, type Tone } from "./parts";

type TickAction = (form: FormData) => void | Promise<void>;

// How many closed months the chart shows before the plan.
const HISTORY = 12;
// How many rules «Что сделать сейчас» lists, and how many rows of each it names.
const TODO = 6;
const SUBJECTS = 4;

// «Обзор»: which file this is, the headline numbers, what to do now, the picture of the sheet,
// the month's calendar and the checklist of the cycle.
export function OverviewView({
  data,
  report,
  tickAction,
  timeZone,
  names,
}: {
  data: SopData;
  report: SopReport;
  tickAction: TickAction;
  timeZone: string;
  // Who ticked the checklist: user id → name.
  names: Map<string, string>;
}) {
  const { settings, marks, checklist, today } = data;
  const upload = data.upload!;
  const { overview, findings } = report;
  const marked = new Set(marks.keys());
  const when = dateFormat({ dateStyle: "medium", timeZone });
  const openOf = (severity: "error" | "risk") =>
    findings.filter((f) => f.severity === severity && !marked.has(f.key)).length;
  const coverTone = (cover: number | null, min: number): Tone | undefined =>
    cover === null ? undefined : cover < min ? "bad" : "good";
  const closed = overview.closed;
  const versus = (actual: number, forecast: number | null) =>
    forecast === null || forecast <= 0
      ? t("sop.overview.tiles.noForecast")
      : t("sop.overview.tiles.vsForecast", {
          forecast: cases(forecast),
          percent: formatNumber((actual / forecast) * 100, 0),
        });
  const countNote = (total: number, open: number) =>
    total === 0
      ? t("sop.overview.tiles.none")
      : open === 0
        ? t("sop.overview.tiles.allMarked")
        : t("sop.overview.tiles.open", { count: open });

  const tiles: TileItem[] = [
    {
      key: "ordering",
      label: overview.ordering
        ? t("sop.overview.tiles.ordering", { month: monthLabel(overview.ordering.month) })
        : t("sop.overview.tiles.orderingNone"),
      value: overview.ordering ? cases(overview.ordering.po) : "—",
      note: overview.ordering && (
        <>
          {overview.ordering.byFactory.map((f) => `${f.factory} ${cases(f.po)}`).join(" · ")}
          <span className="block">{t("sop.overview.tiles.orderingNote")}</span>
        </>
      ),
      href: "/sop/order",
    },
    ...(closed
      ? ([
          {
            key: "entity",
            label: t("sop.overview.tiles.entity"),
            value: cases(overview.entity.stock),
            note:
              overview.entity.cover === null
                ? t("sop.overview.tiles.coverNone", { month: monthLabel(closed.month) })
                : t("sop.overview.tiles.cover", {
                    month: monthLabel(closed.month),
                    cover: coverText(overview.entity.cover),
                  }),
            tone: coverTone(overview.entity.cover, settings.entityMin),
            href: "/sop/stock",
          },
          {
            key: "dist",
            label: t("sop.overview.tiles.dist"),
            value: cases(overview.dist.stock),
            note:
              overview.dist.cover === null
                ? t("sop.overview.tiles.coverNone", { month: monthLabel(closed.month) })
                : t("sop.overview.tiles.cover", {
                    month: monthLabel(closed.month),
                    cover: coverText(overview.dist.cover),
                  }),
            tone: coverTone(overview.dist.cover, settings.distMin),
            href: "/sop/stock",
          },
          {
            key: "sellIn",
            label: t("sop.overview.tiles.sellIn", { month: monthLabel(closed.month) }),
            value: cases(closed.sellIn),
            note: versus(closed.sellIn, closed.forecastSellIn),
          },
          {
            key: "sellThru",
            label: t("sop.overview.tiles.sellThru", { month: monthLabel(closed.month) }),
            value: cases(closed.sellThru),
            note: versus(closed.sellThru, closed.forecastSellThru),
          },
        ] satisfies TileItem[])
      : []),
    {
      key: "errors",
      label: t("sop.overview.tiles.errors"),
      value: String(overview.counts.error),
      note: countNote(overview.counts.error, openOf("error")),
      tone: openOf("error") > 0 ? "bad" : overview.counts.error > 0 ? undefined : "good",
      href: findingsHref({ severity: "error" }),
    },
    {
      key: "risks",
      label: t("sop.overview.tiles.risks"),
      value: String(overview.counts.risk),
      note: countNote(overview.counts.risk, openOf("risk")),
      tone: openOf("risk") > 0 ? "warn" : undefined,
      href: findingsHref({ severity: "risk" }),
    },
  ];

  // What nobody marked yet, rule by rule: the errors first (the findings come sorted).
  const todo = findings.filter((f) => f.severity !== "note" && !marked.has(f.key));
  const todoRules = [...new Set(todo.map((f) => f.rule))];
  const step = currentStep(Number(today.slice(8, 10)));
  const firstShown = Math.max(0, report.ctx.m - HISTORY);
  const chart = report.totals.slice(firstShown, report.ctx.horizon.at(-1)! + 1).map((m) => ({
    month: m.month,
    forecast: m.forecast,
    sellIn: m.sellIn,
    sellThru: m.sellThru,
    out: m.out,
    entity: m.entityStock,
    dist: m.distStock,
  }));
  const counts = checklistCounts(findings, marked);
  const done = CHECKLIST_ITEMS.filter((item) => checklist[`${item}`]).length;

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <p className="text-sm">
        <span className="text-muted-foreground">{t("sop.overview.file")}: </span>
        <span className="font-medium break-all">{upload.fileName}</span>
        <span className="text-muted-foreground">
          {" · "}
          {upload.uploaderName
            ? t("sop.overview.uploaded", {
                kind: t(`sop.kindsShort.${upload.kind}`),
                name: upload.uploaderName,
                date: when.format(upload.createdAt),
              })
            : t("sop.overview.uploadedNoName", {
                kind: t(`sop.kindsShort.${upload.kind}`),
                date: when.format(upload.createdAt),
              })}
        </span>
        {upload.note && <span className="text-muted-foreground"> · «{upload.note}»</span>}
      </p>

      <Tiles items={tiles} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title={t("sop.overview.todo.title")}>
          <p className="text-sm">
            <span className="text-muted-foreground">{t("sop.overview.todo.today")} </span>
            <span className="font-medium">
              {t(`sop.overview.calendar.steps.${step.key}.title`)}
            </span>
          </p>
          {todo.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("sop.overview.todo.none")}</p>
          ) : (
            <ul className="flex flex-col">
              {todoRules.slice(0, TODO).map((rule) => {
                const group = todo.filter((f) => f.rule === rule);
                const first = group[0]!;
                const text = describeFinding(first);
                return (
                  <li key={rule} className="flex flex-col gap-1 border-t py-2.5 first:border-t-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <SeverityMark severity={first.severity} />
                      <Link
                        href={findingsHref({ severity: first.severity, hide: 1 })}
                        className="text-sm font-medium underline-offset-2 hover:underline"
                      >
                        {text.name}
                      </Link>
                      {group.length > 1 && (
                        <span className="text-muted-foreground text-sm tabular-nums">
                          {group.length}
                        </span>
                      )}
                    </span>
                    {/* The rows it is about: a few by name, the rest by their number. */}
                    <span className="text-sm">
                      {group.slice(0, SUBJECTS).map((finding, index) => (
                        <span key={finding.key}>
                          {index > 0 && ", "}
                          {finding.sku ? (
                            <Link
                              href={skuHref(finding.sku.key)}
                              className="underline-offset-2 hover:underline"
                            >
                              {finding.sku.name}
                            </Link>
                          ) : (
                            describeFinding(finding).subject
                          )}
                        </span>
                      ))}
                      {group.length > SUBJECTS && (
                        <span className="text-muted-foreground">
                          {" "}
                          {t("sop.findings.more", { count: group.length - SUBJECTS })}
                        </span>
                      )}
                      {group.length === 1 && (text.line || text.rows[0]) && (
                        <span className="text-muted-foreground">
                          {" — "}
                          {text.line || text.rows.slice(0, 2).join("; ")}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-sm">{text.todo}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href={findingsHref()}
            className="text-primary w-fit text-sm underline underline-offset-2"
          >
            {t("sop.overview.todo.more", { count: findings.length })}
          </Link>
        </Section>

        <Section title={t("sop.overview.calendar.title")} hint={t("sop.overview.calendar.hint")}>
          <ol className="flex flex-col">
            {CALENDAR_STEPS.map((item) => {
              const active = item.key === step.key;
              return (
                <li
                  key={item.key}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex gap-3 border-l-2 py-2 pl-3",
                    active ? "border-l-primary bg-secondary/50 rounded-r-lg" : "border-l-border",
                  )}
                >
                  <span className="text-muted-foreground w-16 shrink-0 text-xs tabular-nums">
                    {t(`sop.overview.calendar.steps.${item.key}.day`)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {t(`sop.overview.calendar.steps.${item.key}.title`)}
                      {active && (
                        <Chip tone="good">{t(`sop.overview.calendar.${step.state}`)}</Chip>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t(`sop.overview.calendar.steps.${item.key}.text`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      </div>

      <Section title={t("sop.overview.chart.title")} hint={t("sop.overview.chart.hint")}>
        <PsiChart months={chart} title={t("sop.overview.chart.title")} />
      </Section>

      <Section
        id="checklist"
        title={t("sop.overview.checklist.title", { cycle: monthLabel(upload.cycle) })}
        hint={t("sop.overview.checklist.hint")}
        actions={
          <Chip tone={done === CHECKLIST_ITEMS.length ? "good" : undefined}>
            {t("sop.overview.checklist.progress", { done, total: CHECKLIST_ITEMS.length })}
          </Chip>
        }
      >
        <ol className="flex flex-col">
          {CHECKLIST_ITEMS.map((item) => {
            const tick = checklist[`${item}`];
            const found = counts[item];
            // Only the points the file itself can be checked for have a count.
            const auto = checklistRules(item).length > 0;
            return (
              <li key={item} className="flex gap-3 border-t py-2.5 first:border-t-0">
                <form action={tickAction} className="shrink-0">
                  <input type="hidden" name="cycle" value={upload.cycle} />
                  <input type="hidden" name="item" value={item} />
                  <input type="hidden" name="done" value={tick ? "" : "1"} />
                  <button
                    type="submit"
                    aria-pressed={Boolean(tick)}
                    aria-label={`${t(tick ? "sop.overview.checklist.undo" : "sop.overview.checklist.done")}: ${t(`sop.overview.checklist.items.c${item}.title`)}`}
                    title={t(tick ? "sop.overview.checklist.undo" : "sop.overview.checklist.done")}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md border",
                      tick
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "bg-card hover:bg-accent",
                    )}
                  >
                    {tick && <Check className="size-4" />}
                  </button>
                </form>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className={cn(tick && "text-muted-foreground line-through")}>
                      {item}. {t(`sop.overview.checklist.items.c${item}.title`)}
                    </span>
                    {found > 0 ? (
                      <Link href={findingsHref({ item, hide: 1 })}>
                        <Chip tone="bad">
                          {t("sop.overview.checklist.found", { count: found })}
                        </Chip>
                      </Link>
                    ) : (
                      auto && <Chip>{t("sop.overview.checklist.clean")}</Chip>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`sop.overview.checklist.items.c${item}.text`)}
                  </span>
                  {tick && (
                    <span className="text-muted-foreground text-xs">
                      {t("sop.overview.checklist.by", {
                        name: names.get(tick.by) ?? "—",
                        date: when.format(new Date(tick.at)),
                      })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/sop/uploads">{t("sop.overview.allUploads")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/sop/guide">{t("sop.tabs.guide")}</Link>
        </Button>
      </div>
    </div>
  );
}
