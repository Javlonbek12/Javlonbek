import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { executiveView, Kpis } from "@/modules/connect/analytics";
import {
  formatMoney,
  formatNumber,
  insightText,
  monthShortLabel,
  partialMonth,
} from "@/modules/connect/report";
import { plural } from "@/modules/reports/format";

import { BarList, Kpi, MiniColumns, Section, StageBar, STAGE_COLOR } from "./parts";

const TONE_ICON = { bad: CircleAlert, warn: AlertTriangle, good: CheckCircle2 };
const TONE_CLASS = {
  bad: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  good: "text-emerald-700 dark:text-emerald-400",
};

type Previous = { kpis: Kpis; count: number } | null;

// «к прошлому месяцу: ▲ 2 п.п. (было 79%)»: green when better, amber when worse.
function compareWith(
  previous: Previous,
  pick: (k: Kpis) => number | null,
  current: number | null,
  options: { better: "up" | "down"; kind: "points" | "money" },
) {
  if (!previous || current === null) return undefined;
  const before = pick(previous.kpis);
  if (before === null) return undefined;
  const label =
    previous.count === 1
      ? t("connect.compare.month")
      : t("connect.compare.months", { count: previous.count });
  const was =
    options.kind === "money"
      ? formatMoney(before)
      : t("connect.compare.percent", { value: before });
  const diff = current - before;
  if (diff === 0)
    return { text: `${label}: ${t("connect.compare.same", { was })}`, trend: "same" as const };
  const amount =
    options.kind === "money"
      ? formatMoney(Math.abs(diff))
      : t("connect.compare.points", { value: Math.abs(diff) });
  const up = diff > 0;
  return {
    text: `${label}: ${up ? "▲" : "▼"} ${amount} (${t("connect.compare.was", { was })})`,
    trend: (up === (options.better === "up") ? "better" : "worse") as "better" | "worse",
  };
}

// Leadership: what matters first, then the headline numbers (against the previous period when
// one month or quarter is chosen), the funnel, money and the trend — one screen.
export function ExecView({
  data,
  previous,
  dataDate,
}: {
  data: ReturnType<typeof executiveView>;
  previous: Previous;
  dataDate: string | null;
}) {
  const k = data.kpis;
  const funnelMax = Math.max(1, data.funnel[0]?.value ?? 1);
  const partial = partialMonth(dataDate);
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      {data.insights.length > 0 && (
        <Section title={t("connect.exec.insights")}>
          <ul className="flex flex-col gap-2.5">
            {data.insights.map((insight) => {
              const Icon = TONE_ICON[insight.tone];
              return (
                <li key={insight.key} className="flex gap-2.5 text-sm leading-snug">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[insight.tone])} />
                  <span>{insightText(insight)}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("connect.kpi.stores")} value={formatNumber(k.stores)} />
        <Kpi
          label={t("connect.kpi.gapRate")}
          value={`${k.gapRate}%`}
          meter={k.gapRate}
          note={t("connect.kpi.ofChecks", { count: formatNumber(k.checks) })}
          tone={k.gapRate >= 40 ? "bad" : k.gapRate >= 20 ? "warn" : "good"}
          compare={compareWith(previous, (p) => p.gapRate, k.gapRate, {
            better: "down",
            kind: "points",
          })}
        />
        <Kpi
          label={t("connect.kpi.conversion")}
          value={`${k.conversion}%`}
          meter={k.conversion}
          tone={k.conversion < 50 ? "bad" : k.conversion < 80 ? "warn" : "good"}
          compare={compareWith(previous, (p) => p.conversion, k.conversion, {
            better: "up",
            kind: "points",
          })}
        />
        <Kpi
          label={t("connect.kpi.noAnswerRate")}
          value={`${k.noAnswerRate}%`}
          meter={k.noAnswerRate}
          note={`${t("connect.kpi.orders")}: ${formatNumber(k.orders)}`}
          tone={k.noAnswerRate >= 30 ? "bad" : k.noAnswerRate >= 10 ? "warn" : "good"}
          compare={compareWith(previous, (p) => p.noAnswerRate, k.noAnswerRate, {
            better: "down",
            kind: "points",
          })}
        />
        <Kpi
          label={t("connect.kpi.contractSum")}
          value={formatMoney(k.contractSum)}
          note={`${t("connect.kpi.requests")}: ${formatNumber(k.requests)}`}
        />
        <Kpi
          label={t("connect.kpi.paidSum")}
          value={formatMoney(k.paidSum)}
          note={t("connect.kpi.paidRate", { rate: k.paidRate })}
          meter={k.paidRate}
          compare={compareWith(previous, (p) => p.paidSum, k.paidSum, {
            better: "up",
            kind: "money",
          })}
        />
        <Kpi
          label={t("connect.kpi.waitingSum")}
          value={formatMoney(k.waitingSum)}
          note={plural("connect.words.requests", k.waiting)}
          tone={k.waiting ? "warn" : undefined}
        />
        <Kpi
          label={t("connect.kpi.checklist")}
          value={k.checklist === null ? "—" : `${k.checklist}%`}
          meter={k.checklist ?? undefined}
          note={t("connect.kpi.roiPositive", { rate: k.roiPositive })}
          compare={compareWith(previous, (p) => p.checklist, k.checklist, {
            better: "up",
            kind: "points",
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("connect.exec.funnel")} hint={t("connect.exec.funnelHint")}>
          <ol className="flex flex-col gap-2">
            {data.funnel.map((step, i) => {
              const previous = i > 0 ? data.funnel[i - 1]!.value : null;
              return (
                <li key={step.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{t(`connect.exec.funnelSteps.${step.id}`)}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{formatNumber(step.value)}</span>
                      {previous !== null && previous > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {Math.round((step.value / previous) * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="bg-muted/60 h-4 rounded-md">
                    <span
                      className="block h-full rounded-md"
                      style={{
                        width: `${step.value ? Math.max(1.5, (step.value / funnelMax) * 100) : 0}%`,
                        background: i === data.funnel.length - 1 ? "#1f9d55" : "#2a78d6",
                      }}
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title={t("connect.exec.payments")} hint={t("connect.exec.paymentsHint")}>
          <StageBar
            rows={data.paymentStages.map((s) => ({
              key: s.id,
              label: t(`connect.paymentStage.${s.id}`),
              value: s.value,
              note: s.sum ? formatMoney(s.sum) : undefined,
            }))}
          />
        </Section>
      </div>

      {data.trend.length > 1 && (
        <Section title={t("connect.exec.trend")} hint={t("connect.exec.trendHint")}>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <MiniColumns
              title={t("connect.exec.trendCols.checks")}
              points={data.trend.map((m) => ({
                label: monthShortLabel(m.month, dataDate),
                partial: m.month === partial,
                value: m.checks,
              }))}
            />
            <MiniColumns
              title={t("connect.exec.trendCols.gapRate")}
              points={data.trend.map((m) => ({
                label: monthShortLabel(m.month, dataDate),
                partial: m.month === partial,
                value: m.gapRate,
              }))}
              format={(n) => `${n}%`}
              color="#eb6834"
            />
            <MiniColumns
              title={t("connect.exec.trendCols.orders")}
              points={data.trend.map((m) => ({
                label: monthShortLabel(m.month, dataDate),
                partial: m.month === partial,
                value: m.orders,
              }))}
            />
            <MiniColumns
              title={t("connect.exec.trendCols.paidSum")}
              points={data.trend.map((m) => ({
                label: monthShortLabel(m.month, dataDate),
                partial: m.month === partial,
                value: m.paidSum,
              }))}
              format={(n) => (n >= 1e6 ? `${Math.round(n / 1e6)}${t("connect.mln")}` : String(n))}
              color={STAGE_COLOR.paid}
            />
          </div>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("connect.exec.topSkus")} hint={t("connect.exec.topSkusHint")}>
          <BarList
            rows={data.topSkus.map((s) => ({
              key: s.sku,
              label: s.sku,
              value: s.total,
              color: "#eb6834",
              note: `${s.rate}%`,
            }))}
          />
        </Section>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t("connect.exec.orders")}>
            <StageBar
              rows={data.orderStages.map((s) => ({
                key: s.id,
                label: t(`connect.orderStage.${s.id}`),
                value: s.value,
              }))}
            />
          </Section>
          <Section title={t("connect.exec.brands")}>
            <BarList
              rows={data.brands.map((b) => ({ key: b.brand, label: b.brand, value: b.total }))}
            />
          </Section>
        </div>
      </div>

      {data.checklistFails.length > 0 && (
        <Section title={t("connect.exec.checklist")}>
          <BarList
            rows={data.checklistFails.map((f) => ({
              key: f.q,
              label: f.q,
              value: f.rate,
              color: "#d64545",
              note: `${f.no}/${f.total}`,
            }))}
            format={(n) => `${n}%`}
            stacked
          />
        </Section>
      )}
    </div>
  );
}
