import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FLOWS } from "@/modules/sop/types";
import type { SopMarkRow } from "@/modules/sop/service";
import type { SopSettings } from "@/modules/sop/settings";
import { coverFlags } from "@/modules/sop/calc";
import { TABLE_HISTORY, type SkuCard, type SkuMonth } from "@/modules/sop/sku";
import { cases, coverText, metricName, monthLabel } from "@/modules/sop/texts";

import { PsiChart } from "./chart";
import { FindingItem } from "./findings";
import { HintBlock } from "./order";
import { Chip, NUM, ScrollTable, Section, STICKY, TD, TH, TONE_CELL, TONE_TEXT } from "./parts";

type MarkAction = (form: FormData) => void | Promise<void>;

// One SKU: the picture, every month in numbers, its findings, the order hint with the
// arithmetic, its materials and the split of Sell-in by channel.
export function SkuCardView({
  card,
  settings,
  marks,
  cycle,
  back,
  markAction,
  timeZone,
}: {
  card: SkuCard;
  settings: SopSettings;
  marks: Map<string, SopMarkRow>;
  cycle: string;
  back: string;
  markAction: MarkAction;
  timeZone: string;
}) {
  const { stats } = card;
  // The table keeps to the last closed months and the plan, so the plan is on screen at once.
  const firstForecast = card.months.findIndex((m) => m.forecast);
  const months = card.months.slice(
    Math.max(0, (firstForecast < 0 ? card.months.length : firstForecast) - TABLE_HISTORY),
  );
  const head = (m: SkuMonth) => (
    <th
      key={m.month}
      className={cn(
        TH,
        "text-right align-top",
        m.frozen && "bg-muted/50",
        m.ordering && "bg-secondary/60",
      )}
    >
      <span className="text-foreground block text-sm font-medium">{monthLabel(m.month)}</span>
      <span className="block">
        {m.ordering
          ? t("sop.sku.ordering")
          : m.frozen
            ? t("sop.sku.frozen")
            : m.forecast
              ? t("sop.overview.chart.forecast")
              : t("sop.sku.actual")}
      </span>
    </th>
  );
  const ground = (m: SkuMonth) =>
    cn(
      m.frozen && "bg-muted/50",
      m.ordering && "bg-secondary/60",
      !m.forecast && "text-foreground/80",
    );
  const row = (label: string, hint: string | null, cell: (m: SkuMonth) => React.ReactNode) => (
    <tr key={label}>
      <th scope="row" className={cn(TD, STICKY, "text-left font-normal")}>
        <span className="whitespace-nowrap">{label}</span>
        {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
      </th>
      {months.map((m) => (
        <td key={m.month} className={cn(TD, NUM, ground(m))}>
          {cell(m)}
        </td>
      ))}
    </tr>
  );
  const stock = (value: number, file: number | null | undefined) => (
    <>
      <span className={cn(value < -0.5 && cn(TONE_TEXT.bad, "font-semibold"))}>{cases(value)}</span>
      {file !== undefined && (
        <span className="text-muted-foreground block text-xs">
          ({file === null ? t("sop.sku.emptyInFile") : t("sop.sku.inFile", { value: cases(file) })})
        </span>
      )}
    </>
  );
  // Each row is coloured by its own norm: the entity and the distributor red under their
  // minimum, the total amber above the maximum.
  const coverRow = (which: "entity" | "dist" | "total") => (
    <tr>
      <th scope="row" className={cn(TD, STICKY, "text-left font-normal whitespace-nowrap")}>
        {t(`sop.sku.cover.${which}`)}
      </th>
      {months.map((m) => {
        const judged = stats.covers.find((c) => c.month === m.month && c.judged);
        const flags = judged ? coverFlags(judged, settings) : null;
        const tone =
          flags &&
          (which === "entity"
            ? flags.entityLow && "bad"
            : which === "dist"
              ? flags.distLow && "bad"
              : flags.high && "warn");
        return (
          <td key={m.month} className={cn(TD, NUM, "p-1", ground(m))}>
            <span className={cn("inline-block rounded px-1.5 py-0.5", tone && TONE_CELL[tone])}>
              {coverText(m.cover[which])}
            </span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Link
        href="/sop/stock"
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("sop.sku.back")}
      </Link>
      <PageHeader title={stats.name}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {t("sop.sku.meta", {
            factory: stats.factory || "—",
            type: stats.type || "—",
            row: stats.row,
          })}
          {" · "}
          {stats.code ? t("sop.sku.code", { code: stats.code }) : t("sop.sku.noCode")}
          {stats.status && <Chip>{stats.status}</Chip>}
          {stats.slow && <Chip tone="warn">{t("sop.stock.flags.slow")}</Chip>}
          {stats.short && <Chip tone="bad">{t("sop.stock.flags.short")}</Chip>}
          {stats.excess && <Chip tone="warn">{t("sop.stock.flags.excess")}</Chip>}
        </span>
      </PageHeader>

      <Section title={t("sop.sku.chart")}>
        <PsiChart
          title={`${t("sop.sku.chart")}: ${stats.name}`}
          months={card.months.map((m) => ({
            month: m.month,
            forecast: m.forecast,
            sellIn: m.sellIn,
            sellThru: m.sellThru,
            out: m.out,
            entity: m.entity,
            dist: m.dist,
          }))}
        />
      </Section>

      <Section title={t("sop.sku.table")} hint={t("sop.sku.tableHint")}>
        <ScrollTable label={t("sop.sku.table")}>
          <thead>
            <tr>
              <th className={cn(TH, STICKY)} />
              {months.map(head)}
            </tr>
          </thead>
          <tbody>
            {FLOWS.map((metric) =>
              row(metricName(metric), t(`sop.metricsHint.${metric}`), (m) =>
                m[metric] === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  cases(m[metric])
                ),
              ),
            )}
            {row(metricName("factoryStock"), t("sop.metricsHint.factoryStock"), (m) =>
              cases(m.factoryStock),
            )}
            {row(metricName("entityStock"), t("sop.metricsHint.entityStock"), (m) =>
              stock(m.entity, m.fileEntity),
            )}
            {row(metricName("distStock"), t("sop.metricsHint.distStock"), (m) =>
              stock(m.dist, m.fileDist),
            )}
            {coverRow("entity")}
            {coverRow("dist")}
            {coverRow("total")}
          </tbody>
        </ScrollTable>
      </Section>

      <Section title={t("sop.sku.findings")}>
        {card.findings.length === 0 ? (
          <CardDescription>{t("sop.sku.noFindings")}</CardDescription>
        ) : (
          <ul className="flex flex-col">
            {card.findings.map((finding) => (
              <FindingItem
                key={finding.key}
                finding={finding}
                mark={marks.get(finding.key)}
                cycle={cycle}
                back={back}
                markAction={markAction}
                timeZone={timeZone}
                showSku={false}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("sop.sku.hint")}>
        {card.hint ? (
          <HintBlock hint={card.hint} settings={settings} />
        ) : (
          <CardDescription>
            {t(`sop.sku.noHint.${card.noHint ?? "noDemand"}`, {
              firstBatch: cases(settings.firstBatch),
            })}
          </CardDescription>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("sop.sku.materials")}>
          {card.material ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["ksh", card.material.totalKsh],
                  ["box", card.material.totalBox],
                  ["plan", card.material.planTotal],
                  ["leftover", card.material.leftover > 0.5 ? card.material.leftover : null],
                  ["forecast", card.material.salesForecast],
                ] as const
              ).map(([column, value]) => (
                <div key={column} className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">
                    {t(`sop.materials.columns.${column}`)}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {value === null ? "—" : cases(value)}
                  </dd>
                </div>
              ))}
              {card.material.flag && (
                <div className="col-span-2">
                  <Chip tone="warn">{t(`sop.materials.flags.${card.material.flag}`)}</Chip>
                </div>
              )}
            </dl>
          ) : (
            <CardDescription>{t("sop.sku.noMaterials")}</CardDescription>
          )}
        </Section>

        <Section
          title={t("sop.sku.split")}
          hint={
            card.split.length > 0
              ? t("sop.sku.splitHint", {
                  distributor: settings.distributorLabel,
                  ka: settings.kaLabel,
                })
              : undefined
          }
        >
          {card.split.length === 0 ? (
            <CardDescription>{t("sop.sku.splitNone")}</CardDescription>
          ) : (
            <ScrollTable label={t("sop.sku.split")}>
              <thead>
                <tr>
                  <th className={cn(TH, STICKY, "text-left")}>{t("sop.overview.chart.month")}</th>
                  <th className={cn(TH, "text-right")}>{settings.distributorLabel}</th>
                  <th className={cn(TH, "text-right")}>{settings.kaLabel}</th>
                </tr>
              </thead>
              <tbody>
                {card.split.map((s) => (
                  <tr key={s.month}>
                    <td className={cn(TD, STICKY)}>{monthLabel(s.month)}</td>
                    <td className={cn(TD, NUM)}>{cases(s.distributor)}</td>
                    <td className={cn(TD, NUM)}>{cases(s.ka)}</td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          )}
        </Section>
      </div>
    </div>
  );
}
