import ExcelJS from "exceljs";

import { t } from "@/lib/i18n";

import type { TimeReport } from "./time-report";

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

// The time report in Excel: totals by person, then every person's tasks.
export async function timeReportXlsx(report: TimeReport): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const sheet = (name: string, columns: { header: string; width: number }[]) => {
    const ws = book.addWorksheet(name.slice(0, 31));
    ws.columns = columns;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  const s = (key: string) => t(`tasks.timeReport.sheet.${key}` as Parameters<typeof t>[0]);

  const people = sheet(s("people"), [
    { header: s("person"), width: 30 },
    { header: s("hours"), width: 10 },
    { header: s("count"), width: 10 },
  ]);
  for (const p of report.people) people.addRow([p.name, hours(p.minutes), p.tasks.length]);
  people.addRow([t("tasks.timeReport.total"), hours(report.totalMinutes), report.taskCount]).font =
    { bold: true };

  const tasks = sheet(s("tasks"), [
    { header: s("person"), width: 26 },
    { header: s("task"), width: 50 },
    { header: s("status"), width: 18 },
    { header: s("hours"), width: 10 },
    { header: s("estimate"), width: 10 },
  ]);
  for (const p of report.people)
    for (const task of p.tasks)
      tasks.addRow([
        p.name,
        task.title,
        t(`tasks.status.${task.status}`),
        hours(task.minutes),
        task.estimateMinutes ? hours(task.estimateMinutes) : null,
      ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
