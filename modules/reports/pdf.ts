import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";

import type { Report } from "./data";
import { changeNote as delta, formatReportDate, highlights } from "./summary";

// A4 management report: headline numbers, a weekly chart, people, projects and risks.
// Colors are the validated light-mode chart palette (dataviz skill): series blue #2a78d6 /
// orange #eb6834 on #ffffff; text ink #0b0b0b, secondary #52514e, muted #898781, grid #e1e0d9.

const hex = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
const C = {
  ink: hex("#0b0b0b"),
  secondary: hex("#52514e"),
  muted: hex("#898781"),
  grid: hex("#e1e0d9"),
  tile: hex("#f6f6f4"),
  created: hex("#2a78d6"),
  completed: hex("#eb6834"),
};
const W = 595;
const H = 842;
const M = 40;
const CONTENT = W - 2 * M;

const fontPath = (file: string) => path.join(process.cwd(), "assets", "fonts", file);

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = H - M;
    const n = this.pdf.getPageCount();
    this.page.drawText(`${this.footer} · ${n}`, {
      x: M,
      y: 20,
      size: 7,
      font: this.regular,
      color: C.muted,
    });
  }

  // Starts a new page when less than `height` points are left.
  need(height: number) {
    if (this.y - height < M) this.newPage();
  }

  text(
    value: string,
    x: number,
    size: number,
    opts: {
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      width?: number;
      align?: "left" | "right";
    } = {},
  ) {
    const font = opts.bold ? this.bold : this.regular;
    const fitted = opts.width ? fit(value, font, size, opts.width) : value;
    const dx =
      opts.align === "right" && opts.width ? opts.width - font.widthOfTextAtSize(fitted, size) : 0;
    this.page.drawText(fitted, { x: x + dx, y: this.y, size, font, color: opts.color ?? C.ink });
  }

  heading(value: string) {
    this.need(40);
    this.y -= 22;
    this.text(value, M, 12, { bold: true });
    this.y -= 8;
  }

  // Wrapped paragraph with an optional bullet.
  paragraph(value: string, size = 10, bullet = false) {
    const indent = bullet ? 12 : 0;
    for (const [i, line] of wrap(value, this.regular, size, CONTENT - indent).entries()) {
      this.need(size + 4);
      this.y -= size + 4;
      if (bullet && i === 0) this.text("•", M, size, { color: C.secondary });
      this.text(line, M + indent, size);
    }
  }

  // Simple table with a header row, light zebra rows and page breaks.
  table(headers: string[], rows: string[][], widths: number[], numeric: boolean[]) {
    const size = 8.5;
    const rowH = 15;
    const xs = widths.reduce<number[]>(
      (acc, w, i) => [...acc, i === 0 ? M : acc[i - 1] + widths[i - 1]],
      [],
    );
    const header = () => {
      this.need(rowH * 2);
      this.y -= rowH;
      headers.forEach((h, i) =>
        this.text(h, xs[i] + 4, 7.5, {
          bold: true,
          color: C.secondary,
          width: widths[i] - 8,
          align: numeric[i] ? "right" : "left",
        }),
      );
      this.page.drawLine({
        start: { x: M, y: this.y - 4 },
        end: { x: M + CONTENT, y: this.y - 4 },
        thickness: 0.5,
        color: C.grid,
      });
    };
    header();
    rows.forEach((row, r) => {
      if (this.y - rowH < M) {
        this.newPage();
        header();
      }
      this.y -= rowH;
      if (r % 2 === 1)
        this.page.drawRectangle({
          x: M,
          y: this.y - 4,
          width: CONTENT,
          height: rowH,
          color: C.tile,
        });
      row.forEach((cell, i) =>
        this.text(cell, xs[i] + 4, size, {
          width: widths[i] - 8,
          align: numeric[i] ? "right" : "left",
        }),
      );
    });
  }
}

function fit(value: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let text = value;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, size) > width)
    text = text.slice(0, -1);
  return `${text}…`;
}

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function tiles(w: Writer, items: { label: string; value: string; note: string }[]) {
  const gap = 8;
  const width = (CONTENT - gap * 3) / 4;
  const height = 58;
  w.need(height + 10);
  w.y -= 8;
  items.forEach((item, i) => {
    const x = M + i * (width + gap);
    w.page.drawRectangle({ x, y: w.y - height, width, height, color: C.tile });
    const top = w.y;
    w.y = top - 14;
    w.text(item.label, x + 8, 7.5, { color: C.secondary, width: width - 16 });
    w.y = top - 36;
    w.text(item.value, x + 8, 18, { bold: true, width: width - 16 });
    w.y = top - 50;
    w.text(item.note, x + 8, 6.5, { color: C.muted, width: width - 16 });
    w.y = top;
  });
  w.y -= height;
}

function chart(w: Writer, report: Report) {
  const height = 150;
  w.need(height + 40);
  w.y -= 14;
  // Legend (two series → always a legend).
  let x = M;
  for (const [label, color] of [
    [t("reports.chart.created"), C.created],
    [t("reports.chart.completed"), C.completed],
  ] as const) {
    w.page.drawRectangle({ x, y: w.y - 1, width: 8, height: 8, color });
    w.text(label, x + 12, 8, { color: C.secondary });
    x += 20 + w.regular.widthOfTextAtSize(label, 8) + 16;
  }
  const top = w.y - 12;
  const bottom = top - height + 20;
  const left = M + 24;
  const plotW = CONTENT - 24;
  const max = Math.max(1, ...report.weeks.flatMap((wk) => [wk.created, wk.completed]));
  const step = Math.max(1, Math.ceil(max / 4));
  const yMax = step * 4;
  // Recessive gridlines with values.
  for (let i = 0; i <= 4; i++) {
    const y = bottom + ((top - bottom) * i) / 4;
    w.page.drawLine({
      start: { x: left, y },
      end: { x: left + plotW, y },
      thickness: i === 0 ? 0.8 : 0.4,
      color: C.grid,
    });
    w.page.drawText(String(step * i), { x: M, y: y - 3, size: 7, font: w.regular, color: C.muted });
  }
  const slot = plotW / report.weeks.length;
  const bar = Math.min(14, (slot - 8) / 2);
  report.weeks.forEach((wk, i) => {
    const cx = left + slot * i + slot / 2;
    for (const [value, color, dx] of [
      [wk.created, C.created, -bar - 1],
      [wk.completed, C.completed, 1],
    ] as const) {
      const h = value === 0 ? 1 : ((top - bottom) * value) / yMax;
      w.page.drawRectangle({ x: cx + dx, y: bottom, width: bar, height: h, color });
    }
    // Every other date label when the chart is dense.
    if (
      report.weeks.length <= 8 ||
      i % 2 === report.weeks.length % 2 ||
      i === report.weeks.length - 1
    ) {
      const label = formatDay(wk.weekStart);
      const lw = w.regular.widthOfTextAtSize(label, 6.5);
      w.page.drawText(label, {
        x: cx - lw / 2,
        y: bottom - 10,
        size: 6.5,
        font: w.regular,
        color: C.muted,
      });
    }
  });
  // Selective direct labels: the latest week only.
  const last = report.weeks.at(-1)!;
  const lx = left + slot * (report.weeks.length - 1) + slot / 2;
  for (const [value, dx] of [
    [last.created, -bar - 1],
    [last.completed, 1],
  ] as const) {
    const label = String(value);
    const lw = w.bold.widthOfTextAtSize(label, 7);
    w.page.drawText(label, {
      x: lx + dx + bar / 2 - lw / 2,
      y: bottom + ((top - bottom) * value) / yMax + 3,
      size: 7,
      font: w.bold,
      color: C.ink,
    });
  }
  w.y = bottom - 18;
}

export async function reportPdf(report: Report): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(fontPath("DejaVuSans.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(fontPath("DejaVuSans-Bold.ttf")), {
    subset: true,
  });
  pdf.setTitle(`${t("reports.title")} ${report.period.from} – ${report.period.to}`);
  const period = t("reports.subtitle", {
    from: formatReportDate(report.period.from),
    to: formatReportDate(report.period.to),
  });
  const w = new Writer(pdf, regular, bold, `${t("app.name")} · ${period}`);

  w.y -= 18;
  w.text(t("reports.title"), M, 20, { bold: true });
  w.y -= 18;
  w.text(period, M, 10, { color: C.secondary });
  w.text(t("reports.generated", { date: formatReportDate(report.today) }), M, 8, {
    color: C.muted,
    width: CONTENT,
    align: "right",
  });
  w.y -= 10;
  w.page.drawLine({
    start: { x: M, y: w.y },
    end: { x: W - M, y: w.y },
    thickness: 1,
    color: C.ink,
  });

  w.heading(t("reports.summary"));
  for (const line of highlights(report)) w.paragraph(line, 10, true);

  const { kpis: k, previousKpis: p, now } = report;
  w.y -= 6;
  tiles(w, [
    {
      label: t("reports.kpi.completed"),
      value: String(k.completed),
      note: delta(k.completed, p.completed),
    },
    {
      label: t("reports.kpi.created"),
      value: String(k.created),
      note: delta(k.created, p.created),
    },
    {
      label: t("reports.kpi.onTime"),
      value: k.onTimePercent === null ? "—" : `${k.onTimePercent}%`,
      note: delta(k.onTimePercent, p.onTimePercent, true),
    },
    {
      label: t("reports.kpi.averageDays"),
      value: k.averageDays === null ? "—" : t("reports.kpi.days", { value: k.averageDays }),
      note: delta(k.averageDays, p.averageDays),
    },
  ]);
  w.y -= 12;
  w.text(
    t("reports.compared", {
      from: formatReportDate(report.previous.from),
      to: formatReportDate(report.previous.to),
    }),
    M,
    7,
    { color: C.muted },
  );
  w.y += 2;
  tiles(w, [
    { label: t("reports.kpi.active"), value: String(now.active), note: "" },
    {
      label: t("reports.kpi.overdue"),
      value: String(now.overdue),
      note: t("reports.kpi.overdueHint", { count: now.overdueHigh }),
    },
    {
      label: t("reports.kpi.waiting"),
      value: String(now.waitingApproval + now.inReview),
      note: t("reports.kpi.waitingHint", { approval: now.waitingApproval, review: now.inReview }),
    },
    {
      label: t("reports.kpi.meetings"),
      value: String(report.meetings.held),
      note: t("reports.other.meetingTasks", { count: report.meetings.tasksFromMeetings }),
    },
  ]);

  w.heading(t("reports.chart.title"));
  chart(w, report);

  w.heading(t("reports.people.title"));
  if (report.people.length === 0) w.paragraph(t("reports.people.empty"));
  else
    w.table(
      [
        t("reports.people.name"),
        t("reports.people.active"),
        t("reports.people.completed"),
        t("reports.people.overdue"),
        t("reports.people.onTime"),
      ],
      report.people.map((p) => [
        p.name,
        String(p.active),
        String(p.completed),
        String(p.overdue),
        p.onTimePercent === null ? "—" : `${p.onTimePercent}%`,
      ]),
      [235, 70, 70, 70, 70],
      [false, true, true, true, true],
    );

  if (report.projects.length) {
    w.heading(t("reports.projects.title"));
    w.table(
      [
        t("reports.projects.name"),
        t("reports.people.active"),
        t("reports.people.completed"),
        t("reports.people.overdue"),
      ],
      report.projects.map((p) => [
        p.name ?? t("reports.projects.none"),
        String(p.active),
        String(p.completed),
        String(p.overdue),
      ]),
      [305, 70, 70, 70],
      [false, true, true, true],
    );
  }

  w.heading(t("reports.risks.title"));
  if (report.overdueTasks.length === 0) w.paragraph(t("reports.risks.empty"));
  else
    w.table(
      [
        t("reports.risks.task"),
        t("reports.risks.assignee"),
        t("reports.risks.due"),
        t("reports.risks.overdueBy"),
        t("reports.risks.priority"),
      ],
      report.overdueTasks
        .slice(0, 15)
        .map((task) => [
          task.title,
          task.assignee,
          formatDay(task.due!),
          t("reports.risks.days", { days: task.daysOverdue }),
          t(`tasks.priority.${task.priority}`),
        ]),
      [215, 120, 60, 60, 60],
      [false, false, false, true, false],
    );

  w.heading(t("reports.upcoming.title"));
  if (report.upcoming.length === 0) w.paragraph(t("reports.upcoming.empty"));
  else
    w.table(
      [
        t("reports.risks.task"),
        t("reports.risks.assignee"),
        t("reports.risks.due"),
        t("reports.risks.priority"),
      ],
      report.upcoming
        .slice(0, 15)
        .map((task) => [
          task.title,
          task.assignee,
          formatDay(task.due!),
          t(`tasks.priority.${task.priority}`),
        ]),
      [255, 140, 60, 60],
      [false, false, false, false],
    );

  w.heading(t("reports.other.title"));
  for (const line of [
    t("reports.other.meetings", { count: report.meetings.held }),
    t("reports.other.meetingTasks", { count: report.meetings.tasksFromMeetings }),
    t("reports.other.planogramsApproved", { count: report.planograms.approved }),
    t("reports.other.planogramsPending", { count: report.planograms.pending }),
  ])
    w.paragraph(line, 9, true);

  return Buffer.from(await pdf.save());
}
