import type { ReactNode } from "react";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { orderStage } from "@/modules/connect/analytics";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import {
  MV_RESULTS,
  STORE_OPEN_QUESTION,
  topAnswers,
  VISIT_ISSUES,
  type VisitSections,
} from "@/modules/connect/visits";
import { plural } from "@/modules/reports/format";

import {
  AnswerBar,
  BarList,
  DayBars,
  Section,
  StageBar,
  STAGE_COLOR,
  StatGrid,
  UNANSWERED_COLOR,
} from "./parts";

// The report's three sections on Smart Up visits and Connect Bot, the same on every level (the
// numbers differ by whose visits they count). Extra lists of a level go in as children.

const pct = (value: number) => `${value}%`;

// An order's delivery status as the bot writes it, coloured by its stage.
export const deliveryColor = (status: string) =>
  STAGE_COLOR[orderStage({ status, outcome: null, storeAnswer: null })];
export const statusLabel = (status: string) => status || t("connect.oos.noStatus");

// A TSM: the code, the name under it.
export function TsmName({ code, name }: { code: string; name?: string | null }) {
  return (
    <span className="flex flex-col">
      <span>{code}</span>
      {name && <span className="text-muted-foreground text-xs">{name}</span>}
    </span>
  );
}

export function VisitsSection({
  data,
  children,
}: {
  data: VisitSections["visits"];
  children?: ReactNode;
}) {
  const v = data;
  return (
    <Section title={t("connect.section.visits")} hint={t("connect.section.visitsHint")}>
      <StatGrid
        items={[
          { key: "planned", label: t("connect.visits.planned"), value: formatNumber(v.planned) },
          {
            key: "visited",
            label: t("connect.visits.visited"),
            value: formatNumber(v.visited),
            note: t("connect.visits.visitedNote", { rate: v.visitedRate }),
          },
          {
            key: "notVisited",
            label: t("connect.visits.notVisited"),
            value: formatNumber(v.notVisited),
            tone: v.notVisited ? "warn" : undefined,
          },
          {
            key: "unplanned",
            label: t("connect.visits.unplanned"),
            value: formatNumber(v.unplanned),
            note: t("connect.visits.unplannedNote", { count: v.unplannedWithConnect }),
          },
        ]}
      />
      <h3 className="text-sm font-medium">{t("connect.visits.ofVisited")}</h3>
      <StatGrid
        items={[
          {
            key: "withMv",
            label: t("connect.visits.withMv"),
            value: pct(v.withMvRate),
            note: formatNumber(v.withMv),
          },
          {
            key: "withOos",
            label: t("connect.visits.withOos"),
            value: pct(v.withOosRate),
            note: formatNumber(v.withOos),
          },
          { key: "both", label: t("connect.visits.both"), value: formatNumber(v.both) },
          {
            key: "inTime",
            label: t("connect.visits.inTime"),
            value: pct(v.inTimeRate),
            note: t("connect.visits.inTimeNote"),
          },
          {
            key: "other",
            label: t("connect.visits.otherEmployee"),
            value: formatNumber(v.otherEmployee),
            note: pct(v.otherRate),
            tone: v.otherEmployee ? "warn" : undefined,
          },
          { key: "closed", label: t("connect.visits.closed"), value: formatNumber(v.closed) },
          {
            key: "withoutVisit",
            label: t("connect.visits.mvWithoutVisit"),
            value: formatNumber(v.mvWithoutVisit),
          },
          {
            key: "duplicates",
            label: t("connect.visits.duplicates"),
            value: formatNumber(v.mvCopiesRemoved + v.oosCopiesRemoved),
            note: [
              t("connect.visits.mvCopies", {
                copies: plural("connect.words.copies", v.mvCopiesRemoved),
                days: formatNumber(v.mvDuplicateDays),
              }),
              t("connect.visits.oosCopies", {
                copies: plural("connect.words.copies", v.oosCopiesRemoved),
                days: formatNumber(v.oosDuplicateDays),
              }),
            ].join("; "),
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("connect.visits.statuses")}</h3>
          <StageBar
            rows={[
              ...(["ok", ...VISIT_ISSUES] as const).map((s) => ({
                key: s,
                label: t(`connect.status.${s}`),
                value: v.status[s],
                note: v.visited ? pct(Math.round((v.status[s] / v.visited) * 100)) : undefined,
              })),
            ]}
          />
        </div>
        {v.days.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("connect.visits.byDay")}</h3>
            <DayBars
              days={v.days.map((d) => ({
                key: d.day,
                label: formatDay(d.day),
                values: [d.planned, d.visited, d.withConnect],
              }))}
              series={[
                { label: t("connect.visits.legend.planned"), color: "#c9c7bf" },
                { label: t("connect.visits.legend.visited"), color: "#2a78d6" },
                { label: t("connect.visits.legend.withConnect"), color: "#1f9d55" },
              ]}
            />
          </div>
        )}
      </div>
      {children}
    </Section>
  );
}

export function OosSection({
  data,
  children,
}: {
  data: VisitSections["oos"];
  children?: ReactNode;
}) {
  const o = data;
  return (
    <Section title={t("connect.section.oos")} hint={t("connect.section.oosHint")}>
      <StatGrid
        items={[
          {
            key: "checked",
            label: t("connect.oos.checked"),
            value: formatNumber(o.checked),
            note: t("connect.oos.checkedNote"),
          },
          {
            key: "withGap",
            label: t("connect.oos.withGap"),
            value: formatNumber(o.withGap),
            note: t("connect.oos.withGapNote", { rate: o.gapRate }),
          },
          {
            key: "ledToOrder",
            label: t("connect.oos.ledToOrder"),
            value: pct(o.orderRate),
            note: t("connect.oos.ledToOrderNote", { count: formatNumber(o.withGap) }),
          },
          { key: "orders", label: t("connect.oos.orders"), value: formatNumber(o.orders) },
          { key: "packs", label: t("connect.oos.packs"), value: formatNumber(o.packs) },
          { key: "sum", label: t("connect.oos.sum"), value: formatMoney(o.sum) },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("connect.oos.byStatus")}</h3>
          <StageBar
            rows={o.byStatus.map((s) => ({
              key: s.status || "-",
              label: statusLabel(s.status),
              value: s.count,
              note: `${t("connect.packs", { count: formatNumber(s.packs) })} · ${formatMoney(s.sum)}`,
              color: deliveryColor(s.status),
            }))}
          />
        </div>
        {o.topSkus.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("connect.oos.topSkus")}</h3>
            <BarList
              rows={o.topSkus.map((s) => ({
                key: s.sku,
                label: s.sku,
                value: s.total,
                color: "#eb6834",
                note: t("connect.oos.topSkusNote", { rate: s.rate }),
              }))}
            />
          </div>
        )}
      </div>
      {children}
    </Section>
  );
}

export function MvSection({ data, children }: { data: VisitSections["mv"]; children?: ReactNode }) {
  const m = data;
  return (
    <Section title={t("connect.section.mv")} hint={t("connect.section.mvHint")}>
      <StatGrid
        items={[
          { key: "unique", label: t("connect.mv.unique"), value: formatNumber(m.unique) },
          {
            key: "full",
            label: t("connect.mv.fullRate"),
            value: pct(m.fullRate),
            note: t("connect.mv.fullRateNote"),
          },
          { key: "problems", label: t("connect.mv.problems"), value: formatNumber(m.problems) },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("connect.mv.results")}</h3>
          <StageBar
            rows={MV_RESULTS.map((r) => ({
              key: r,
              label: t(`connect.result.${r}`),
              value: m.results[r],
            }))}
          />
        </div>
        {m.equipment.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("connect.mv.equipment")}</h3>
            <BarList
              rows={m.equipment.slice(0, 12).map((e) => ({
                key: e.type,
                label: e.type,
                value: e.count,
              }))}
            />
          </div>
        )}
      </div>
      {m.questions.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("connect.mv.questions")}</h3>
          <p className="text-muted-foreground text-xs">{t("connect.mv.questionsHint")}</p>
          <ul className="flex flex-col gap-4">
            {m.questions.map((q) => (
              <li key={q.q} className="flex flex-col gap-1.5 text-sm">
                <span className="leading-snug">
                  {q.q}
                  {q.q !== STORE_OPEN_QUESTION && q.problems > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {" "}
                      · {t("connect.mv.problemShare", { rate: q.problemRate })}
                    </span>
                  )}
                </span>
                <AnswerBar
                  parts={[
                    ...topAnswers(q.answers).shown.map((a) => ({
                      key: a.value,
                      label: a.value,
                      value: a.count,
                    })),
                    ...(topAnswers(q.answers).other
                      ? [
                          {
                            key: "+",
                            label: t("connect.mv.otherAnswers", {
                              count: topAnswers(q.answers).otherKinds,
                            }),
                            value: topAnswers(q.answers).other,
                            color: UNANSWERED_COLOR,
                          },
                        ]
                      : []),
                    ...(q.unanswered
                      ? [
                          {
                            key: "-",
                            label: t("connect.mv.unanswered"),
                            value: q.unanswered,
                            color: UNANSWERED_COLOR,
                          },
                        ]
                      : []),
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </Section>
  );
}
