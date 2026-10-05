import { t } from "@/lib/i18n";

import type { Report } from "./data";

// Signed change in percent, e.g. "+12%", "−5%"; null when there is nothing to compare with.
export function changePercent(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "0%";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

// "▲ +12%", "▼ −3 п.п.", "без изменений"; compared with the previous period (explained once on the page).
export function changeNote(
  current: number | null,
  previous: number | null,
  points = false,
): string {
  if (current === null || previous === null) return t("reports.kpi.noData");
  if (points) {
    const diff = current - previous;
    return diff === 0
      ? t("reports.kpi.noChange")
      : `${diff > 0 ? "▲ +" : "▼ −"}${Math.abs(diff)} п.п.`;
  }
  const change = changePercent(current, previous);
  if (!change) return t("reports.kpi.noData");
  return change === "0%"
    ? t("reports.kpi.noChange")
    : `${change.startsWith("+") ? "▲" : "▼"} ${change}`;
}

const reportDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

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
      change
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
