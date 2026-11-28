import Link from "next/link";

import { CardDescription } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { dateFormat, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { skuHref } from "@/modules/sop/links";
import type { FactoryPlan, HintStep, OrderHint, StampMonth } from "@/modules/sop/order";
import type { SopSettings } from "@/modules/sop/settings";
import { cases, coverText, monthLabel } from "@/modules/sop/texts";

import { Chip, NUM, ScrollTable, Section, STICKY, TD, TH, TONE_TEXT } from "./parts";

// One month of a hint: what the file has, what the calculation comes to.
function StepCell({ step }: { step: HintStep }) {
  return (
    <span className="flex flex-col tabular-nums">
      <span className="text-muted-foreground text-xs">
        {t("sop.order.hints.inFile", { po: cases(step.filePo) })}
      </span>
      {step.action === "keep" ? (
        <span className="text-muted-foreground text-sm">{t("sop.order.hints.keep")}</span>
      ) : (
        <span
          className={cn(
            "text-sm font-semibold",
            step.action === "add" ? "text-primary" : TONE_TEXT.warn,
          )}
        >
          {t(step.action === "add" ? "sop.order.hints.add" : "sop.order.hints.reduce", {
            po: cases(step.suggested),
            change: cases(Math.abs(step.change)),
          })}
        </span>
      )}
    </span>
  );
}

// The arithmetic of a hint, month by month, in words.
export function HintMath({ hint, settings }: { hint: OrderHint; settings: SopSettings }) {
  return (
    <ul className="text-muted-foreground flex flex-col gap-1 text-xs tabular-nums">
      {hint.steps.map((step) => (
        <li key={step.month}>
          {t("sop.order.hints.step", {
            month: monthLabel(step.month),
            opening: cases(step.opening),
            filePo: cases(step.filePo),
            sales: cases(step.sales),
            closing: cases(step.closing),
            cover: step.cover === null ? t("sop.order.hints.noCover") : coverText(step.cover),
            target: formatNumber(settings.targetTotal, 1),
            demand: cases(step.demand),
            goal: cases(step.target),
          })}{" "}
          {step.action === "add"
            ? t("sop.order.hints.stepAdd", {
                gap: cases(step.gap),
                filePo: cases(step.filePo),
                raw: cases(step.filePo + step.gap),
                suggested: cases(step.suggested),
              })
            : step.action === "reduce"
              ? t("sop.order.hints.stepReduce", {
                  gap: cases(-step.gap),
                  suggested: cases(step.suggested),
                })
              : step.waits
                ? t("sop.order.hints.stepWait", {
                    gap: cases(step.gap),
                    moq: cases(settings.moq),
                    max: formatNumber(settings.maxTotal, 1),
                    min: formatNumber(settings.entityMin + settings.distMin, 1),
                  })
                : t("sop.order.hints.stepKeep")}
        </li>
      ))}
    </ul>
  );
}

// A hint as a block: the three months and how they were counted.
export function HintBlock({ hint, settings }: { hint: OrderHint; settings: SopSettings }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {hint.steps.map((step) => (
          <div key={step.month} className="flex flex-col">
            <span className="text-xs font-medium">{monthLabel(step.month)}</span>
            <StepCell step={step} />
          </div>
        ))}
      </div>
      <HintMath hint={hint} settings={settings} />
    </div>
  );
}

function FactoryTable({ plan, settings }: { plan: FactoryPlan; settings: SopSettings }) {
  const container = plan.transport === "container";
  const size = plan.months.find((m) => m.load)?.load?.size;
  const hasRegular = plan.months.some((m) => m.regularPo > 0);
  const row = (label: string, cell: (m: FactoryPlan["months"][number]) => React.ReactNode) => (
    <tr>
      <th scope="row" className={cn(TD, STICKY, "text-left font-normal whitespace-nowrap")}>
        {label}
      </th>
      {plan.months.map((m) => (
        <td
          key={m.month}
          className={cn(TD, NUM, m.frozen && "bg-muted/50", m.ordering && "bg-secondary/60")}
        >
          {cell(m)}
        </td>
      ))}
    </tr>
  );
  return (
    <Section
      title={t("sop.order.factory", { factory: plan.factory || "—" })}
      hint={
        plan.transport && size
          ? t(`sop.order.transport.${plan.transport}`, { size: cases(size) })
          : undefined
      }
    >
      <ScrollTable label={t("sop.order.factory", { factory: plan.factory })}>
        <thead>
          <tr>
            <th className={cn(TH, STICKY)} />
            {plan.months.map((m) => (
              <th
                key={m.month}
                className={cn(
                  TH,
                  "text-right align-top",
                  m.frozen && "bg-muted/50",
                  m.ordering && "bg-secondary/60",
                )}
              >
                <span className="text-foreground block text-sm font-medium">
                  {monthLabel(m.month)}
                </span>
                {m.frozen && <span className="block">{t("sop.order.frozen")}</span>}
                {m.ordering && (
                  <span className="text-primary block font-medium">{t("sop.order.ordering")}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(t("sop.metrics.po"), (m) => (
            <span className="font-semibold">{cases(m.po)}</span>
          ))}
          {row(t("sop.metrics.plan"), (m) => (
            <span className={cn(Math.abs(m.plan - m.po) > 0.5 && TONE_TEXT.bad)}>
              {cases(m.plan)}
            </span>
          ))}
          {row(t("sop.metrics.out"), (m) => cases(m.out))}
          {plan.transport &&
            row(t(container ? "sop.order.rows.loadContainer" : "sop.order.rows.load"), (m) =>
              m.load ? m.load.count : "—",
            )}
          {plan.transport &&
            row(
              t(container ? "sop.order.rows.lastFillContainer" : "sop.order.rows.lastFill"),
              (m) =>
                m.load ? (
                  <span
                    className={cn(
                      container &&
                        m.load.lastFill * 100 < settings.containerWarn &&
                        cn(TONE_TEXT.warn, "font-semibold"),
                    )}
                  >
                    {t("sop.order.percent", { value: Math.round(m.load.lastFill * 100) })}
                  </span>
                ) : (
                  "—"
                ),
            )}
          {hasRegular &&
            row(t("sop.order.rows.regular", { type: settings.regularType }), (m) =>
              m.regularPo > 0 ? cases(m.regularPo) : "—",
            )}
          {plan.months.some((m) => m.moqBreaches > 0) &&
            row(t("sop.order.rows.moq"), (m) =>
              m.moqBreaches > 0 ? (
                <span className={cn(TONE_TEXT.bad, "font-semibold")}>{m.moqBreaches}</span>
              ) : (
                "—"
              ),
            )}
        </tbody>
      </ScrollTable>
      {hasRegular && (
        <p className="text-muted-foreground text-xs">
          {t("sop.order.regularNote", { type: settings.regularType })}
        </p>
      )}
    </Section>
  );
}

// «Заказ»: the factories by month, the calculation hint and the excise stamps.
export function OrderView({
  factories,
  hints,
  stamps,
  settings,
  showAll,
}: {
  factories: FactoryPlan[];
  hints: OrderHint[];
  stamps: StampMonth[];
  settings: SopSettings;
  // Also the SKUs whose order the calculation leaves as it is.
  showAll: boolean;
}) {
  const changed = hints.filter((h) => h.weight > 0);
  const shown = showAll ? hints : changed;
  // The deadline is a calendar day, not a moment: shown as written.
  const day = dateFormat({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <p className="text-muted-foreground max-w-3xl text-sm">{t("sop.order.intro")}</p>
      {factories.map((plan) => (
        <FactoryTable key={plan.factory} plan={plan} settings={settings} />
      ))}

      <Section
        id="hints"
        title={t("sop.order.hints.title")}
        hint={t("sop.order.hints.note", {
          target: formatNumber(settings.targetTotal, 1),
          moq: cases(settings.moq),
        })}
        actions={
          hints.length > changed.length || showAll ? (
            <Link
              href={showAll ? "/sop/order#hints" : "/sop/order?all=1#hints"}
              className="text-primary text-sm underline underline-offset-2"
            >
              {showAll
                ? t("sop.order.hints.onlyChanges")
                : t("sop.order.hints.showAll", { count: hints.length - changed.length })}
            </Link>
          ) : undefined
        }
      >
        {hints.length === 0 ? (
          <CardDescription>{t("sop.order.hints.none")}</CardDescription>
        ) : shown.length === 0 ? (
          <CardDescription>{t("sop.order.hints.allKept")}</CardDescription>
        ) : (
          <ul className="flex flex-col">
            {shown.map((hint) => (
              <li key={hint.key} className="flex flex-col gap-2 border-t py-3 first:border-t-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={skuHref(hint.key)}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {hint.name}
                  </Link>
                  <Chip>{[hint.factory, hint.type].filter(Boolean).join(" · ")}</Chip>
                  {hint.status && <Chip>{hint.status}</Chip>}
                </span>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {hint.steps.map((step) => (
                    <div key={step.month} className="flex min-w-[9rem] flex-col">
                      <span className="text-xs font-medium">{monthLabel(step.month)}</span>
                      <StepCell step={step} />
                    </div>
                  ))}
                </div>
                <details>
                  <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline underline-offset-2">
                    {t("sop.order.hints.how")}
                  </summary>
                  <div className="mt-1.5">
                    <HintMath hint={hint} settings={settings} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="stamps"
        title={t("sop.order.stamps.title")}
        hint={t("sop.order.stamps.hint", { packs: cases(settings.packsPerCase) })}
      >
        {stamps.every((s) => s.cases === 0) ? (
          <CardDescription>{t("sop.order.stamps.none")}</CardDescription>
        ) : (
          <ScrollTable label={t("sop.order.stamps.title")}>
            <thead>
              <tr>
                <th className={cn(TH, STICKY, "text-left")}>{t("sop.order.stamps.month")}</th>
                <th className={cn(TH, "text-right")}>{t("sop.order.stamps.cases")}</th>
                <th className={cn(TH, "text-right")}>{t("sop.order.stamps.packs")}</th>
                <th className={cn(TH, "text-left")}>{t("sop.order.stamps.deadline")}</th>
                <th className={cn(TH, "text-left")}>{t("sop.order.stamps.status")}</th>
              </tr>
            </thead>
            <tbody>
              {stamps.map((s) => (
                <tr key={s.month}>
                  <td className={cn(TD, STICKY, "font-medium whitespace-nowrap")}>
                    {monthLabel(s.month)}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {cases(s.cases)}
                    {s.byFactory.length > 1 && (
                      <span className="text-muted-foreground block text-xs">
                        {s.byFactory.map((f) => `${f.factory} ${cases(f.cases)}`).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {formatNumber(s.packs, 0)}
                    {s.byFactory.length > 1 && (
                      <span className="text-muted-foreground block text-xs">
                        {s.byFactory
                          .map((f) => `${f.factory} ${formatNumber(f.packs, 0)}`)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {day.format(new Date(`${s.deadline}T00:00:00Z`))}
                  </td>
                  <td className={TD}>
                    {s.cases === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Chip
                        tone={
                          s.status === "overdue" ? "bad" : s.status === "soon" ? "warn" : "good"
                        }
                      >
                        {t(`sop.order.stamps.${s.status}`, { days: Math.abs(s.daysLeft) })}
                      </Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
      </Section>
    </div>
  );
}
