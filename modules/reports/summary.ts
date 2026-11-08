import { t, dateFormat } from "@/lib/i18n";

import type { Report } from "./data";
import { formatDecimal } from "./format";

// Signed change in percent, e.g. "+12%", "−5%"; null when there is nothing to compare with.
export function changePercent(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "0%";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

// Below this many tasks a percentage only alarms: «+125%» is 4 tasks against 9.
export const SMALL = 10;

// "▲ +12%", "▼ −3 п.п." ("pp" in English), "без изменений"; compared with the previous period
// (explained once on the page). On a few tasks, and for days, the number before says more than a
// percentage: «▲ было 4», «▲ было 1,5 дн.».
export function changeNote(
  current: number | null,
  previous: number | null,
  kind: "count" | "points" | "days" = "count",
): string {
  if (current === null || previous === null) return t("reports.kpi.noData");
  const diff = current - previous;
  if (diff === 0) return t("reports.kpi.noChange");
  const arrow = diff > 0 ? "▲" : "▼";
  if (kind === "points")
    return `${arrow} ${diff > 0 ? "+" : "−"}${t("reports.kpi.points", { n: Math.abs(diff) })}`;
  if (kind === "days")
    return `${arrow} ${t("reports.kpi.wasDays", { value: formatDecimal(previous) })}`;
  if (Math.max(current, previous) < SMALL)
    return `${arrow} ${t("reports.kpi.was", { value: previous })}`;
  return `${arrow} ${changePercent(current, previous)}`;
}

// «7,3 дн.»: the average with a decimal comma.
export const formatDays = (value: number) => t("reports.kpi.days", { value: formatDecimal(value) });

const reportDate = {
  format: (date: Date) =>
    dateFormat({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
};

// "1 октября 2026 г." for report headers.
export const formatReportDate = (value: string) =>
  reportDate.format(new Date(`${value}T00:00:00Z`));

const LOW_ON_TIME = 70;

// "Главное": a few plain sentences built from the numbers (no AI, no cost).
export function highlights(report: Report): string[] {
  const { kpis, previousKpis, now, people } = report;
  const lines: string[] = [];
  if (kpis.completed === 0) lines.push(t("reports.highlights.nothingCompleted"));
  else {
    const change = changePercent(kpis.completed, previousKpis.completed);
    lines.push(
      Math.max(kpis.completed, previousKpis.completed) < SMALL
        ? t("reports.highlights.completedWas", {
            count: kpis.completed,
            was: previousKpis.completed,
          })
        : change
          ? t("reports.highlights.completed", { count: kpis.completed, change })
          : t("reports.highlights.completedNoPrev", { count: kpis.completed }),
    );
  }
  if (kpis.onTimePercent !== null) {
    lines.push(
      t(
        kpis.onTimePercent < LOW_ON_TIME
          ? "reports.highlights.onTimeLow"
          : "reports.highlights.onTime",
        {
          percent: kpis.onTimePercent,
        },
      ),
    );
  }
  lines.push(
    now.overdue
      ? t("reports.highlights.overdue", { count: now.overdue, high: now.overdueHigh })
      : t("reports.highlights.noOverdue"),
  );
  const worst = [...people].sort((a, b) => b.overdue - a.overdue)[0];
  if (worst && worst.overdue > 1)
    lines.push(t("reports.highlights.topOverdue", { name: worst.name, count: worst.overdue }));
  if (kpis.created > kpis.completed * 1.3 && kpis.created - kpis.completed >= 3) {
    lines.push(
      t("reports.highlights.createdMore", { created: kpis.created, completed: kpis.completed }),
    );
  }
  const waiting = now.waitingApproval + now.inReview;
  if (waiting) lines.push(t("reports.highlights.waiting", { count: waiting }));
  return lines;
}
