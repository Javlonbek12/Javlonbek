import ExcelJS from "exceljs";

import { t } from "@/lib/i18n";

import type { Report } from "./data";
import { highlights } from "./summary";

// Excel with the details behind the PDF: summary, weeks, people, projects, overdue and all tasks of the period.
export async function reportXlsx(report: Report): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const sheet = (
    name: string,
    columns: { header: string; width: number }[],
    rows: (string | number | null)[][],
  ) => {
    // Excel forbids some characters in sheet names and limits them to 31 characters.
    const ws = book.addWorksheet(
      name
        .replace(/[*?:\\/[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 31),
    );
    ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.addRows(rows);
    return ws;
  };
  const { kpis: k, previousKpis: p, now } = report;
  const summary = sheet(
    t("reports.sheet.summary"),
    [
      { header: t("reports.sheet.metric"), width: 36 },
      { header: t("reports.sheet.value"), width: 16 },
      { header: t("reports.sheet.previous"), width: 18 },
    ],
    [
      [t("reports.kpi.completed"), k.completed, p.completed],
      [t("reports.kpi.created"), k.created, p.created],
      [`${t("reports.kpi.onTime")}, %`, k.onTimePercent, p.onTimePercent],
      [`${t("reports.kpi.averageDays")}, ${t("reports.sheet.days")}`, k.averageDays, p.averageDays],
      [t("reports.kpi.active"), now.active, null],
      [t("reports.kpi.overdue"), now.overdue, null],
      [t("reports.kpi.waiting"), now.waitingApproval + now.inReview, null],
      [t("reports.kpi.meetings"), report.meetings.held, null],
      [t("reports.sheet.planograms"), report.planograms.approved, null],
    ],
  );
  summary.insertRow(1, [`${t("reports.title")}: ${report.period.from} – ${report.period.to}`]);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.addRow([]);
  summary.addRow([t("reports.summary")]).font = { bold: true };
  for (const line of highlights(report)) summary.addRow([line]);

  sheet(
    t("reports.chart.title"),
    [
      { header: t("reports.sheet.week"), width: 14 },
      { header: t("reports.chart.created"), width: 14 },
      { header: t("reports.chart.completed"), width: 14 },
    ],
    report.weeks.map((w) => [w.weekStart, w.created, w.completed]),
  );
  sheet(
    t("reports.people.title"),
    [
      { header: t("reports.people.name"), width: 30 },
      { header: t("reports.sheet.position"), width: 26 },
      { header: t("reports.people.active"), width: 12 },
      { header: t("reports.people.completed"), width: 12 },
      { header: t("reports.people.overdue"), width: 12 },
      { header: `${t("reports.people.onTime")}, %`, width: 12 },
    ],
    report.people.map((x) => [
      x.name,
      x.position,
      x.active,
      x.completed,
      x.overdue,
      x.onTimePercent,
    ]),
  );
  sheet(
    t("reports.projects.title"),
    [
      { header: t("reports.projects.name"), width: 30 },
      { header: t("reports.people.active"), width: 12 },
      { header: t("reports.people.completed"), width: 12 },
      { header: t("reports.people.overdue"), width: 12 },
    ],
    report.projects.map((x) => [
      x.name ?? t("reports.projects.none"),
      x.active,
      x.completed,
      x.overdue,
    ]),
  );
  sheet(
    t("reports.risks.title"),
    [
      { header: t("reports.risks.task"), width: 50 },
      { header: t("reports.risks.assignee"), width: 26 },
      { header: t("reports.risks.due"), width: 12 },
      { header: `${t("reports.risks.overdueBy")}, ${t("reports.sheet.days")}`, width: 14 },
      { header: t("reports.risks.priority"), width: 12 },
      { header: t("reports.projects.name"), width: 20 },
    ],
    report.overdueTasks.map((x) => [
      x.title,
      x.assignee,
      x.due,
      x.daysOverdue,
      t(`tasks.priority.${x.priority}`),
      x.project,
    ]),
  );
  sheet(
    t("reports.sheet.tasks"),
    [
      { header: t("reports.sheet.title"), width: 50 },
      { header: t("reports.risks.assignee"), width: 26 },
      { header: t("reports.sheet.status"), width: 16 },
      { header: t("reports.risks.priority"), width: 12 },
      { header: t("reports.projects.name"), width: 20 },
      { header: t("reports.sheet.created"), width: 12 },
      { header: t("reports.risks.due"), width: 12 },
      { header: t("reports.sheet.completed"), width: 12 },
    ],
    report.periodTasks.map((x) => [
      x.title,
      x.assignee,
      t(`tasks.status.${x.status}`),
      t(`tasks.priority.${x.priority}`),
      x.project,
      x.created,
      x.due,
      x.completed,
    ]),
  );
  return Buffer.from(await book.xlsx.writeBuffer());
}
