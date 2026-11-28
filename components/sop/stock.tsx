import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { coverFlags, type CoverMonth, type SkuStats } from "@/modules/sop/calc";
import { inStockView, STOCK_VIEWS, type StockView as View } from "@/modules/sop/filter";
import { skuHref } from "@/modules/sop/links";
import type { SopSettings } from "@/modules/sop/settings";
import { cases, coverText, monthLabel } from "@/modules/sop/texts";

import { Chip, NUM, Pills, ScrollTable, STICKY, TD, TH, TONE_CELL, type Tone } from "./parts";

// How a month's stock stands against the norms: red — the entity or the distributor is under its
// minimum, amber — more than the maximum in total, green — within the norm. Nothing to judge
// without demand, for a product being delisted, or before the launch.
export function coverTone(cover: CoverMonth, settings: SopSettings): Tone | null {
  if (cover.entityStock < -0.5 || cover.distStock < -0.5) return "bad";
  if (!cover.judged || cover.total === null) return null;
  const flags = coverFlags(cover, settings);
  if (flags.entityLow || flags.distLow) return "bad";
  return flags.high ? "warn" : "good";
}

const href = (view: View, q: string) => {
  const search = new URLSearchParams();
  if (view !== "all") search.set("view", view);
  if (q) search.set("q", q);
  const query = search.toString();
  return query ? `/sop/stock?${query}` : "/sop/stock";
};

// «Запасы и прогноз»: every SKU with its stock now, the months of stock over the plan coloured by
// the norms, the month of risk and when the entity's stock runs out.
export function StockView({
  stats,
  all,
  view,
  q,
  closed,
  horizon,
  settings,
}: {
  // The SKUs after the filter, and all of them (for the counts of the pills).
  stats: SkuStats[];
  all: SkuStats[];
  view: View;
  q: string;
  closed: string | null;
  horizon: string[];
  settings: SopSettings;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.stock.intro")}</p>
      <Card className="gap-3">
        <Pills
          label={t("sop.tabs.stock")}
          items={STOCK_VIEWS.map((key) => ({
            key,
            label: t(`sop.stock.filters.${key}`),
            href: href(key, q),
            active: view === key,
            count: all.filter((s) => inStockView(s, key)).length,
          }))}
        />
        <form action="/sop/stock" className="flex flex-wrap items-center gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder={t("sop.stock.search")}
            aria-label={t("sop.stock.search")}
            className="w-56"
          />
          <Button type="submit" variant="outline">
            {t("sop.stock.find")}
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("sop.stock.count", { count: stats.length })}
          </span>
        </form>
        <p className="text-muted-foreground text-xs">
          {t("sop.stock.legend", {
            entityMin: settings.entityMin,
            distMin: settings.distMin,
            max: settings.maxTotal,
          })}
        </p>
      </Card>

      {stats.length === 0 ? (
        <Card>
          <CardDescription>{t("sop.stock.none")}</CardDescription>
        </Card>
      ) : (
        <Card className="gap-0">
          <ScrollTable label={t("sop.tabs.stock")}>
            <thead>
              <tr>
                <th rowSpan={2} className={cn(TH, STICKY, "text-left align-bottom")}>
                  {t("sop.stock.columns.sku")}
                </th>
                <th colSpan={2} className={cn(TH, "text-center")}>
                  {closed ? t("sop.stock.columns.now", { month: monthLabel(closed) }) : ""}
                </th>
                <th colSpan={horizon.length} className={cn(TH, "text-center")}>
                  {t("sop.stock.columns.cover")}
                </th>
                <th
                  rowSpan={2}
                  className={cn(TH, "max-w-[5rem] text-left align-bottom whitespace-normal")}
                >
                  {t("sop.stock.columns.risk")}
                </th>
                <th
                  rowSpan={2}
                  className={cn(TH, "max-w-[6.5rem] text-left align-bottom whitespace-normal")}
                >
                  {t("sop.stock.columns.runOut")}
                </th>
                <th
                  rowSpan={2}
                  className={cn(TH, "max-w-[6.5rem] text-right align-bottom whitespace-normal")}
                  title={t("sop.stock.rateHint")}
                >
                  {t("sop.stock.columns.rate")}
                </th>
              </tr>
              <tr>
                <th className={cn(TH, "max-w-[4.5rem] text-right whitespace-normal")}>
                  {t("sop.stock.columns.entity")}
                </th>
                <th className={cn(TH, "max-w-[6rem] text-right whitespace-normal")}>
                  {t("sop.stock.columns.dist")}
                </th>
                {horizon.map((month) => (
                  <th key={month} className={cn(TH, "text-center")}>
                    {monthLabel(month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.key}>
                  <td
                    className={cn(
                      TD,
                      STICKY,
                      "max-w-[8.5rem] min-w-[7.5rem] sm:max-w-[11rem] sm:min-w-[9rem]",
                    )}
                  >
                    <Link
                      href={skuHref(s.key)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground text-xs">
                        {[s.factory, s.type, s.status].filter(Boolean).join(" · ")}
                      </span>
                      {s.slow && <Chip tone="warn">{t("sop.stock.flags.slow")}</Chip>}
                    </span>
                  </td>
                  <td className={cn(TD, NUM)}>{cases(s.stock.entity)}</td>
                  <td className={cn(TD, NUM)}>{cases(s.stock.dist)}</td>
                  {s.covers.map((c) => {
                    const tone = coverTone(c, settings);
                    return (
                      <td key={c.month} className={cn(TD, "p-1 text-center")}>
                        <span
                          className={cn(
                            "flex min-w-[3.9rem] flex-col rounded-md px-1 py-1 tabular-nums",
                            tone ? TONE_CELL[tone] : "text-muted-foreground",
                          )}
                        >
                          <span className="text-sm font-semibold">{coverText(c.total)}</span>
                          <span className="text-[10px] whitespace-nowrap opacity-80">
                            {t("sop.stock.split", {
                              entity: coverText(c.entity),
                              dist: coverText(c.dist),
                            })}
                          </span>
                        </span>
                      </td>
                    );
                  })}
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {s.riskMonth ? (
                      <>
                        {monthLabel(s.riskMonth)}
                        <span className="text-muted-foreground block text-xs">
                          {s.riskWhat && t(`sop.stock.riskWhat.${s.riskWhat}`)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(TD, "min-w-[5.5rem]")}>
                    {s.runOut ? (
                      s.runOut.beyond ? (
                        <>
                          {monthLabel(s.runOut.month)}
                          <span className="text-muted-foreground block text-xs">
                            {t("sop.stock.runOutBeyond")}
                          </span>
                        </>
                      ) : (
                        <Chip tone="bad">{monthLabel(s.runOut.month)}</Chip>
                      )
                    ) : (
                      <span className="text-muted-foreground text-xs">{t("sop.stock.enough")}</span>
                    )}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {s.runRate === null || (s.runRate === 0 && s.planRate === 0) ? (
                      <span className="text-muted-foreground">{t("sop.stock.noSales")}</span>
                    ) : (
                      <>
                        {t("sop.stock.rate", {
                          actual: cases(s.runRate),
                          plan: cases(s.planRate),
                        })}
                        {s.deviation !== null && (
                          <span
                            className={cn(
                              "block text-xs",
                              Math.abs(s.deviation) > settings.runRateDeviation
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {s.deviation > 0 ? "+" : ""}
                            {Math.round(s.deviation)} %
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Card>
      )}
    </div>
  );
}
