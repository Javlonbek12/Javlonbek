import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Accuracy, Comparison } from "@/modules/sop/compare";
import { skuHref } from "@/modules/sop/links";
import { cases, metricName, monthLabel } from "@/modules/sop/texts";
import { FLOWS } from "@/modules/sop/types";

import { Chip, NUM, ScrollTable, Section, STICKY, TD, TH, TONE_TEXT } from "./parts";

export type CompareOption = { id: string; label: string };

// How many changed cells are listed on the page.
const SHOWN = 400;

const delta = (value: number) => `${value > 0 ? "+" : "−"}${cases(Math.abs(value))}`;

// «Сравнение»: two uploads — the totals, every changed cell, and how the forecast came true.
export function CompareView({
  options,
  older,
  newer,
  comparison,
  accuracy,
}: {
  options: CompareOption[];
  older: string | null;
  newer: string | null;
  // Null: fewer than two uploads, or the same one chosen twice.
  comparison: Comparison | null;
  accuracy: Accuracy | null;
}) {
  const picker = (
    <Card className="gap-3">
      <form action="/sop/compare" className="flex flex-wrap items-end gap-3">
        {(["older", "newer"] as const).map((side) => (
          <label key={side} className="flex min-w-0 flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t(`sop.compare.${side}`)}</span>
            <NativeSelect
              name={side}
              defaultValue={(side === "older" ? older : newer) ?? ""}
              className="max-w-full sm:max-w-sm"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
        <Button type="submit" variant="outline">
          {t("sop.compare.show")}
        </Button>
      </form>
    </Card>
  );
  if (options.length < 2)
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.compare.intro")}</p>
        <Card>
          <CardDescription>{t("sop.compare.needTwo")}</CardDescription>
        </Card>
      </div>
    );
  if (!comparison || !accuracy)
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.compare.intro")}</p>
        {picker}
        <Card>
          <CardDescription>{t("sop.compare.same")}</CardDescription>
        </Card>
      </div>
    );

  const { changes } = comparison;
  const offRows = accuracy.rows.filter((r) => r.off);
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.compare.intro")}</p>
      {picker}

      {comparison.reconcile && (
        <Card
          className={cn(
            "gap-1 border-l-4",
            changes.length ? "border-l-red-500" : "border-l-emerald-500",
          )}
        >
          <CardTitle>{t("sop.compare.reconcile.title")}</CardTitle>
          <CardDescription>
            {changes.length
              ? t("sop.compare.reconcile.diff", { count: changes.length })
              : t("sop.compare.reconcile.clean")}
          </CardDescription>
        </Card>
      )}

      <Section title={t("sop.compare.totals")}>
        <ScrollTable label={t("sop.compare.totals")}>
          <thead>
            <tr>
              <th className={cn(TH, STICKY, "text-left")}>{t("sop.compare.columns.metric")}</th>
              {comparison.months.map((month) => (
                <th key={month} className={cn(TH, "text-right")}>
                  {monthLabel(month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLOWS.map((metric) => (
              <tr key={metric}>
                <th
                  scope="row"
                  className={cn(TD, STICKY, "text-left font-normal whitespace-nowrap")}
                >
                  {metricName(metric)}
                </th>
                {comparison.months.map((month) => {
                  const cell = comparison.totals.find(
                    (x) => x.metric === metric && x.month === month,
                  )!;
                  return (
                    <td key={month} className={cn(TD, NUM)}>
                      {cases(cell.now)}
                      {Math.abs(cell.delta) > 0.5 && (
                        <span className={cn("block text-xs", TONE_TEXT.warn)}>
                          {delta(cell.delta)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </Section>

      <Section title={`${t("sop.compare.changes")} · ${changes.length}`}>
        {comparison.added.length > 0 && (
          <p className="text-sm">
            {t("sop.compare.added", { list: comparison.added.map((s) => s.name).join(", ") })}
          </p>
        )}
        {comparison.removed.length > 0 && (
          <p className="text-sm">
            {t("sop.compare.removed", { list: comparison.removed.map((s) => s.name).join(", ") })}
          </p>
        )}
        {changes.length === 0 ? (
          <CardDescription>{t("sop.compare.noChanges")}</CardDescription>
        ) : (
          <>
            <ScrollTable label={t("sop.compare.changes")}>
              <thead>
                <tr>
                  <th className={cn(TH, STICKY, "text-left")}>{t("sop.compare.columns.sku")}</th>
                  <th className={cn(TH, "text-left")}>{t("sop.compare.columns.month")}</th>
                  <th className={cn(TH, "text-left")}>{t("sop.compare.columns.metric")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.columns.was")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.columns.now")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.columns.delta")}</th>
                </tr>
              </thead>
              <tbody>
                {changes.slice(0, SHOWN).map((c) => (
                  <tr key={`${c.key}|${c.month}|${c.metric}`}>
                    <td
                      className={cn(
                        TD,
                        STICKY,
                        "max-w-[8.5rem] min-w-[7.5rem] sm:max-w-xs sm:min-w-[9rem]",
                      )}
                    >
                      <Link
                        href={skuHref(c.key)}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>{monthLabel(c.month)}</td>
                    <td className={cn(TD, "whitespace-nowrap")}>{metricName(c.metric)}</td>
                    <td className={cn(TD, NUM)}>{cases(c.was)}</td>
                    <td className={cn(TD, NUM, "font-semibold")}>{cases(c.now)}</td>
                    <td className={cn(TD, NUM)}>{delta(c.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
            {changes.length > SHOWN && (
              <p className="text-muted-foreground text-xs">
                {t("sop.compare.limited", { shown: SHOWN, count: changes.length })}
              </p>
            )}
          </>
        )}
      </Section>

      <Section title={t("sop.compare.accuracy.title")} hint={t("sop.compare.accuracy.hint")}>
        {accuracy.months.length === 0 ? (
          <CardDescription>{t("sop.compare.accuracy.none")}</CardDescription>
        ) : (
          <>
            <ScrollTable label={t("sop.compare.accuracy.title")}>
              <thead>
                <tr>
                  <th className={cn(TH, STICKY, "text-left")}>{t("sop.compare.columns.sku")}</th>
                  <th className={cn(TH, "text-left")}>{t("sop.compare.columns.month")}</th>
                  <th className={cn(TH, "text-left")}>{t("sop.compare.columns.metric")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.accuracy.forecast")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.accuracy.actual")}</th>
                  <th className={cn(TH, "text-right")}>{t("sop.compare.accuracy.percent")}</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.totals.map((row) => (
                  <AccuracyLine
                    key={`total|${row.month}|${row.metric}`}
                    name={t("sop.compare.accuracy.total")}
                    row={row}
                    strong
                  />
                ))}
                {offRows.map((row) => (
                  <AccuracyLine
                    key={`${row.key}|${row.month}|${row.metric}`}
                    name={row.name}
                    href={skuHref(row.key)}
                    row={row}
                  />
                ))}
              </tbody>
            </ScrollTable>
            <p className="text-muted-foreground text-xs">
              {offRows.length
                ? t("sop.compare.accuracy.bySku", { count: offRows.length })
                : t("sop.compare.accuracy.allFine")}
            </p>
          </>
        )}
      </Section>
    </div>
  );
}

function AccuracyLine({
  name,
  href,
  row,
  strong = false,
}: {
  name: string;
  href?: string;
  row: Accuracy["totals"][number];
  strong?: boolean;
}) {
  return (
    <tr className={cn(strong && "bg-muted/40")}>
      <td
        className={cn(
          TD,
          STICKY,
          "max-w-[8.5rem] min-w-[7.5rem] sm:max-w-xs sm:min-w-[9rem]",
          strong && "bg-muted",
        )}
      >
        {href ? (
          <Link href={href} className="font-medium underline-offset-2 hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-semibold">{name}</span>
        )}
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>{monthLabel(row.month)}</td>
      <td className={cn(TD, "whitespace-nowrap")}>{metricName(row.metric)}</td>
      <td className={cn(TD, NUM)}>{cases(row.forecast)}</td>
      <td className={cn(TD, NUM)}>{cases(row.actual)}</td>
      <td className={cn(TD, NUM)}>
        <span className="inline-flex flex-col items-end gap-0.5">
          {row.percent === null ? "—" : `${formatNumber(row.percent, 0)} %`}
          {row.off && <Chip tone="warn">{t("sop.compare.accuracy.off")}</Chip>}
        </span>
      </td>
    </tr>
  );
}
