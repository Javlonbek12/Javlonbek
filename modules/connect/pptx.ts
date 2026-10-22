import PptxGenJS from "pptxgenjs";

import { t } from "@/lib/i18n";

import {
  formatMoney,
  formatNumber,
  insightText,
  monthLabel,
  periodLabel,
  type ConnectReport,
} from "./report";

// The level on the screen as a 16:9 deck: native PowerPoint charts and tables, so numbers
// stay editable. Colors: the validated chart palette (blue / orange) and the status scale.

const C = {
  ink: "1B1B1A",
  muted: "6B6A66",
  line: "E1E0D9",
  tile: "F6F6F4",
  blue: "2A78D6",
  orange: "EB6834",
  green: "1F9D55",
  amber: "D69E2E",
  red: "D64545",
  grey: "898781",
};
const STAGE: Record<string, string> = {
  delivered: C.green,
  paid: C.green,
  approved: C.blue,
  inProgress: C.blue,
  blocked: C.amber,
  waitingBum: C.orange,
  waitingBdm: C.orange,
  noAnswer: C.red,
  refused: C.grey,
  rejected: C.red,
};
const TONE = { bad: C.red, warn: C.amber, good: C.green };
const FONT = "Arial";
const W = 13.33;
const ROWS_PER_SLIDE = 12;

type Slide = PptxGenJS.Slide;
type Cell = string | number | null;

function header(slide: Slide, title: string, subtitle: string) {
  slide.addText(title, {
    x: 0.5,
    y: 0.3,
    w: W - 1,
    h: 0.6,
    fontFace: FONT,
    fontSize: 24,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  slide.addText(subtitle, {
    x: 0.5,
    y: 0.9,
    w: W - 1,
    h: 0.35,
    fontFace: FONT,
    fontSize: 12,
    color: C.muted,
    margin: 0,
  });
}

function tiles(slide: Slide, items: { label: string; value: string; note?: string }[], y = 1.6) {
  const perRow = 4;
  const gap = 0.25;
  const w = (W - 1 - gap * (perRow - 1)) / perRow;
  const h = 2.1;
  items.forEach((item, i) => {
    const x = 0.5 + (i % perRow) * (w + gap);
    const top = y + Math.floor(i / perRow) * (h + gap);
    slide.addShape("roundRect", {
      x,
      y: top,
      w,
      h,
      fill: { color: C.tile },
      line: { color: C.line, width: 0.75 },
      rectRadius: 0.08,
    });
    slide.addText(item.label, {
      x: x + 0.2,
      y: top + 0.12,
      w: w - 0.4,
      h: 0.3,
      fontFace: FONT,
      fontSize: 11,
      color: C.muted,
      margin: 0,
    });
    slide.addText(item.value, {
      x: x + 0.2,
      y: top + 0.45,
      w: w - 0.4,
      h: 0.55,
      fontFace: FONT,
      fontSize: 26,
      bold: true,
      color: C.ink,
      margin: 0,
    });
    if (item.note)
      slide.addText(item.note, {
        x: x + 0.2,
        y: top + 1.02,
        w: w - 0.4,
        h: 0.3,
        fontFace: FONT,
        fontSize: 10,
        color: C.muted,
        margin: 0,
      });
  });
}

function barChart(
  pptx: PptxGenJS,
  slide: Slide,
  box: { x: number; y: number; w: number; h: number },
  title: string,
  rows: { label: string; value: number; color?: string }[],
  opts: { horizontal?: boolean; percent?: boolean } = {},
) {
  if (!rows.length) return;
  // PowerPoint draws horizontal bars bottom-up: reverse them so the list reads top-down.
  if (opts.horizontal) rows = [...rows].reverse();
  slide.addChart(
    pptx.ChartType.bar,
    [{ name: title, labels: rows.map((r) => r.label), values: rows.map((r) => r.value) }],
    {
      ...box,
      barDir: opts.horizontal ? "bar" : "col",
      chartColors: rows.map((r) => r.color ?? C.blue),
      invertedColors: rows.map((r) => r.color ?? C.blue),
      showTitle: true,
      title,
      titleFontFace: FONT,
      titleFontSize: 13,
      titleColor: C.ink,
      showLegend: false,
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelFontSize: 10,
      dataLabelFontFace: FONT,
      dataLabelColor: C.ink,
      dataLabelFormatCode: opts.percent ? '0"%"' : "#,##0",
      catAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT,
      catAxisLabelColor: C.muted,
      valAxisHidden: true,
      valGridLine: { style: "none" },
      catGridLine: { style: "none" },
      barGapWidthPct: 60,
    },
  );
}

// A table split into slides of ROWS_PER_SLIDE rows each; an empty list adds no slide.
function tableSlides(
  pptx: PptxGenJS,
  title: string,
  subtitle: string,
  head: string[],
  rows: Cell[][],
  widths: number[],
  hint?: string,
) {
  if (!rows.length) return;
  const pages = Math.ceil(rows.length / ROWS_PER_SLIDE);
  for (let page = 0; page < pages; page++) {
    const slide = pptx.addSlide();
    header(
      slide,
      pages > 1 ? `${title} (${page + 1}/${pages})` : title,
      hint ? `${subtitle} · ${hint}` : subtitle,
    );
    const body = rows.slice(page * ROWS_PER_SLIDE, (page + 1) * ROWS_PER_SLIDE);
    const total = widths.reduce((a, b) => a + b, 0);
    slide.addTable(
      [
        head.map((h) => ({
          text: h,
          options: { bold: true, color: C.muted, fill: { color: C.tile } },
        })),
        ...body.map((row) =>
          row.map((cell) => ({
            text: cell === null ? "—" : typeof cell === "number" ? formatNumber(cell) : cell,
            options: { align: (typeof cell === "number" ? "right" : "left") as "right" | "left" },
          })),
        ),
      ],
      {
        x: 0.5,
        y: 1.5,
        w: W - 1,
        colW: widths.map((w) => (w / total) * (W - 1)),
        fontFace: FONT,
        fontSize: 10,
        color: C.ink,
        border: { type: "solid", pt: 0.5, color: C.line },
        valign: "middle",
        margin: 0.05,
      },
    );
  }
}

// "and N more — the full list is in Excel" when a long list is cut for the slides.
const cut = (total: number, shown: number) =>
  total > shown ? t("connect.more", { count: total - shown }) : undefined;

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

export async function connectPptx(report: ConnectReport): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = t("connect.title");
  const view = t(`connect.views.${report.query.view}`);
  const f = report.query.filter;
  const filters = [f.city, f.channel].filter(Boolean).join(", ");
  const subtitle = [periodLabel(report), filters].filter(Boolean).join(" · ");

  // Title slide.
  const cover = pptx.addSlide();
  cover.background = { color: "1E2761" };
  cover.addText(t("connect.title"), {
    x: 0.7,
    y: 2.3,
    w: W - 1.4,
    h: 0.9,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: "FFFFFF",
    margin: 0,
  });
  cover.addText(report.query.person ? `${view}: ${report.query.person}` : view, {
    x: 0.7,
    y: 3.25,
    w: W - 1.4,
    h: 0.6,
    fontFace: FONT,
    fontSize: 22,
    color: "CADCFC",
    margin: 0,
  });
  cover.addText(
    [
      t("connect.pptx.period", { period: periodLabel(report) }),
      ...(filters ? [t("connect.pptx.filters", { list: filters })] : []),
      t("connect.testNote"),
    ].join("\n"),
    {
      x: 0.7,
      y: 4.2,
      w: W - 1.4,
      h: 1.2,
      fontFace: FONT,
      fontSize: 13,
      color: "CADCFC",
      margin: 0,
      valign: "top",
    },
  );

  if (report.exec) {
    const e = report.exec;
    const k = e.kpis;
    const s1 = pptx.addSlide();
    header(s1, t("connect.views.exec"), subtitle);
    tiles(s1, [
      { label: t("connect.kpi.stores"), value: formatNumber(k.stores) },
      {
        label: t("connect.kpi.gapRate"),
        value: `${k.gapRate}%`,
        note: t("connect.kpi.ofChecks", { count: formatNumber(k.checks) }),
      },
      { label: t("connect.kpi.conversion"), value: `${k.conversion}%` },
      {
        label: t("connect.kpi.noAnswerRate"),
        value: `${k.noAnswerRate}%`,
        note: `${t("connect.kpi.orders")}: ${formatNumber(k.orders)}`,
      },
      {
        label: t("connect.kpi.contractSum"),
        value: formatMoney(k.contractSum),
        note: `${t("connect.kpi.requests")}: ${formatNumber(k.requests)}`,
      },
      {
        label: t("connect.kpi.paidSum"),
        value: formatMoney(k.paidSum),
        note: t("connect.kpi.paidRate", { rate: k.paidRate }),
      },
      {
        label: t("connect.kpi.waitingSum"),
        value: formatMoney(k.waitingSum),
        note: t("connect.kpi.waiting", { count: k.waiting }),
      },
      {
        label: t("connect.kpi.checklist"),
        value: pct(k.checklist),
        note: t("connect.kpi.roiPositive", { rate: k.roiPositive }),
      },
    ]);

    if (e.insights.length) {
      const s2 = pptx.addSlide();
      header(s2, t("connect.exec.insights"), subtitle);
      e.insights.forEach((insight, i) => {
        const y = 1.6 + i * 0.85;
        s2.addShape("ellipse", {
          x: 0.6,
          y: y + 0.12,
          w: 0.22,
          h: 0.22,
          fill: { color: TONE[insight.tone] },
          line: { color: TONE[insight.tone] },
        });
        s2.addText(insightText(insight), {
          x: 1.05,
          y,
          w: W - 1.7,
          h: 0.5,
          fontFace: FONT,
          fontSize: 16,
          color: C.ink,
          margin: 0,
          valign: "middle",
        });
      });
    }

    const s3 = pptx.addSlide();
    header(s3, t("connect.exec.funnel"), `${subtitle} · ${t("connect.exec.funnelHint")}`);
    barChart(
      pptx,
      s3,
      { x: 0.5, y: 1.5, w: 6.2, h: 5.5 },
      t("connect.exec.funnel"),
      e.funnel.map((s, i) => ({
        label: t(`connect.exec.funnelSteps.${s.id}`),
        value: s.value,
        color: i === e.funnel.length - 1 ? C.green : C.blue,
      })),
      { horizontal: true },
    );
    barChart(
      pptx,
      s3,
      { x: 6.9, y: 1.5, w: 5.9, h: 5.5 },
      t("connect.exec.payments"),
      e.paymentStages.map((s) => ({
        label: `${t(`connect.paymentStage.${s.id}`)} (${formatMoney(s.sum)})`,
        value: s.value,
        color: STAGE[s.id],
      })),
      { horizontal: true },
    );

    if (e.trend.length > 1) {
      const s4 = pptx.addSlide();
      header(s4, t("connect.exec.trend"), subtitle);
      const labels = e.trend.map((m) => monthLabel(m.month));
      const box = (i: number) => ({
        x: 0.5 + (i % 2) * 6.25,
        y: 1.45 + Math.floor(i / 2) * 2.95,
        w: 6.0,
        h: 2.8,
      });
      barChart(
        pptx,
        s4,
        box(0),
        t("connect.exec.trendCols.checks"),
        e.trend.map((m, i) => ({ label: labels[i]!, value: m.checks })),
      );
      barChart(
        pptx,
        s4,
        box(1),
        `${t("connect.exec.trendCols.gapRate")}, %`,
        e.trend.map((m, i) => ({ label: labels[i]!, value: m.gapRate, color: C.orange })),
        { percent: true },
      );
      barChart(
        pptx,
        s4,
        box(2),
        t("connect.exec.trendCols.orders"),
        e.trend.map((m, i) => ({ label: labels[i]!, value: m.orders })),
      );
      barChart(
        pptx,
        s4,
        box(3),
        `${t("connect.exec.trendCols.paidSum")}, ${t("connect.mln")} ${t("connect.sum")}`,
        e.trend.map((m, i) => ({
          label: labels[i]!,
          value: Math.round(m.paidSum / 1e5) / 10,
          color: C.green,
        })),
      );
    }

    const s5 = pptx.addSlide();
    header(s5, t("connect.exec.topSkus"), `${subtitle} · ${t("connect.exec.topSkusHint")}`);
    barChart(
      pptx,
      s5,
      { x: 0.5, y: 1.5, w: 7.4, h: 5.5 },
      t("connect.exec.topSkus"),
      e.topSkus.map((s) => ({ label: s.sku, value: s.total, color: C.orange })),
      { horizontal: true },
    );
    barChart(
      pptx,
      s5,
      { x: 8.1, y: 1.5, w: 4.7, h: 2.7 },
      t("connect.exec.brands"),
      e.brands.map((b) => ({ label: b.brand, value: b.total })),
      { horizontal: true },
    );
    barChart(
      pptx,
      s5,
      { x: 8.1, y: 4.3, w: 4.7, h: 2.7 },
      t("connect.exec.orders"),
      e.orderStages.map((s) => ({
        label: t(`connect.orderStage.${s.id}`),
        value: s.value,
        color: STAGE[s.id],
      })),
      { horizontal: true },
    );

    if (e.checklistFails.length)
      tableSlides(
        pptx,
        t("connect.exec.checklist"),
        subtitle,
        [t("connect.col.question"), t("connect.col.share"), t("connect.col.count")],
        e.checklistFails.map((q) => [q.q, `${q.rate}%`, `${q.no}/${q.total}`]),
        [8, 1.5, 1.5],
      );
  }

  if (report.manager) {
    const m = report.manager;
    tableSlides(
      pptx,
      t("connect.manager.people"),
      subtitle,
      [
        t("connect.col.person"),
        t("connect.col.open"),
        t("connect.col.checks"),
        t("connect.col.gaps"),
        t("connect.col.ordersFromChecks"),
        t("connect.col.noAnswer"),
        t("connect.col.requests"),
        t("connect.col.paid"),
        t("connect.col.checklist"),
        t("connect.col.visitScore"),
      ],
      m.people.map((p) => [
        p.person,
        p.open,
        p.checks,
        p.gaps,
        p.ordersFromChecks,
        p.noAnswer,
        p.requests,
        p.paid,
        pct(p.checklist),
        pct(p.visitScore),
      ]),
      [4.5, 1, 1, 1, 1.2, 1, 1, 1, 1, 1],
      cut(m.people.length, 24),
    );
    tableSlides(
      pptx,
      t("connect.manager.cities"),
      subtitle,
      [
        t("connect.col.city"),
        t("connect.col.stores"),
        t("connect.col.checks"),
        t("connect.col.gapRate"),
        t("connect.col.orders"),
        t("connect.col.delivered"),
        t("connect.col.requests"),
        t("connect.col.contractSum"),
        t("connect.col.waiting"),
        t("connect.col.checklist"),
      ],
      m.cities.map((c) => [
        c.city,
        c.stores,
        c.checks,
        pct(c.gapRate),
        c.orders,
        c.delivered,
        c.requests,
        formatMoney(c.contractSum),
        c.waiting,
        pct(c.checklist),
      ]),
      [2.2, 1, 1, 1, 1, 1, 1, 1.6, 1, 1],
      cut(m.cities.length, 12),
    );
    tableSlides(
      pptx,
      t("connect.manager.waiting"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.city"),
        t("connect.col.person"),
        t("connect.col.stage"),
        t("connect.col.sum"),
        t("connect.col.days"),
      ],
      m.waitingPayments
        .slice(0, 24)
        .map((p) => [
          p.store,
          p.city,
          p.person,
          t(`connect.paymentStage.${p.stage}`),
          formatMoney(p.sum),
          p.days,
        ]),
      [3.5, 1.5, 3.5, 2, 1.5, 0.8],
      [t("connect.manager.waitingHint"), cut(m.waitingPayments.length, 24)]
        .filter(Boolean)
        .join(" · "),
    );
    tableSlides(
      pptx,
      t("connect.manager.stuck"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.city"),
        t("connect.col.person"),
        t("connect.col.status"),
        t("connect.col.sum"),
        t("connect.col.days"),
      ],
      m.stuckOrders.slice(0, 24).map((o) => [o.store, o.city, o.person, o.status, o.sum, o.days]),
      [3.5, 1.5, 3.5, 2.6, 1.2, 0.8],
      cut(m.stuckOrders.length, 24),
    );
    if (m.skuCity.rows.length) {
      const slide = pptx.addSlide();
      header(
        slide,
        t("connect.manager.skuCity"),
        `${subtitle} · ${t("connect.manager.skuCityHint")}`,
      );
      const head = [t("connect.col.sku"), ...m.skuCity.cities];
      // One hue, light to dark, for the share of checks with a gap.
      const shade = (rate: number) => {
        const mix = Math.min(0.85, rate / 100);
        const ch = (base: number) =>
          Math.round(255 + (base - 255) * mix)
            .toString(16)
            .padStart(2, "0");
        return `${ch(0xeb)}${ch(0x68)}${ch(0x34)}`.toUpperCase();
      };
      slide.addTable(
        [
          head.map((h) => ({
            text: h,
            options: { bold: true, color: C.muted, fill: { color: C.tile } },
          })),
          ...m.skuCity.rows.map((r) => [
            { text: r.sku, options: {} },
            ...r.cells.map((c) => ({
              text: c.rate ? `${c.rate}%` : "·",
              options: {
                align: "center" as const,
                fill: { color: shade(c.rate) },
                color: c.rate >= 50 ? "FFFFFF" : C.ink,
              },
            })),
          ]),
        ],
        {
          x: 0.5,
          y: 1.5,
          w: W - 1,
          colW: [3.6, ...m.skuCity.cities.map(() => (W - 1 - 3.6) / m.skuCity.cities.length)],
          fontFace: FONT,
          fontSize: 10,
          color: C.ink,
          border: { type: "solid", pt: 0.5, color: "FFFFFF" },
          valign: "middle",
        },
      );
    }
    if (m.checklistFails.length || m.visitFails.length) {
      const slide = pptx.addSlide();
      header(slide, t("connect.manager.checklistFails"), subtitle);
      barChart(
        pptx,
        slide,
        { x: 0.5, y: 1.5, w: 6.2, h: 5.5 },
        t("connect.manager.checklistFails"),
        m.checklistFails.map((q) => ({ label: q.q.slice(0, 60), value: q.rate, color: C.red })),
        { horizontal: true, percent: true },
      );
      barChart(
        pptx,
        slide,
        { x: 6.9, y: 1.5, w: 5.9, h: 5.5 },
        t("connect.manager.visitFails"),
        m.visitFails.map((q) => ({ label: q.q.slice(0, 60), value: q.rate, color: C.red })),
        { horizontal: true, percent: true },
      );
    }
  }

  if (report.executor && report.query.person) {
    const x = report.executor;
    const k = x.kpis;
    const s1 = pptx.addSlide();
    header(s1, report.query.person, subtitle);
    tiles(s1, [
      {
        label: t("connect.kpi.checks"),
        value: formatNumber(k.checks),
        note: `${t("connect.col.gaps")}: ${k.gaps}`,
      },
      { label: t("connect.col.ordersFromChecks"), value: formatNumber(k.ordersFromChecks) },
      {
        label: t("connect.kpi.orders"),
        value: formatNumber(k.orders),
        note: `${t("connect.col.noAnswer")}: ${k.noAnswer}`,
      },
      {
        label: t("connect.kpi.requests"),
        value: formatNumber(k.requests),
        note: formatMoney(k.contractSum),
      },
      { label: t("connect.col.paid"), value: formatNumber(k.paid) },
      { label: t("connect.col.checklist"), value: pct(k.checklist) },
      { label: t("connect.kpi.visits"), value: formatNumber(k.visits) },
      { label: t("connect.col.open"), value: formatNumber(x.openCount) },
    ]);
    tableSlides(
      pptx,
      t("connect.executor.gaps"),
      subtitle,
      [t("connect.col.store"), t("connect.col.city"), t("connect.col.date"), t("connect.col.sku")],
      x.gapsWithoutOrder.map((g) => [g.store, g.city, g.day, g.skus.join(", ")]),
      [3.5, 1.5, 1.2, 6],
      t("connect.executor.gapsHint"),
    );
    tableSlides(
      pptx,
      t("connect.executor.orders"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.city"),
        t("connect.col.date"),
        t("connect.col.status"),
        t("connect.col.sum"),
        t("connect.col.days"),
      ],
      x.openOrders.map((o) => [o.store, o.city, o.day, o.status, o.sum, o.days]),
      [3.5, 1.5, 1.2, 3, 1.2, 0.8],
      t("connect.executor.ordersHint"),
    );
    tableSlides(
      pptx,
      t("connect.executor.payments"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.city"),
        t("connect.col.stage"),
        t("connect.col.status"),
        t("connect.col.sum"),
      ],
      x.paymentIssues.map((p) => [
        p.store,
        p.city,
        t(`connect.paymentStage.${p.stage}`),
        [p.note, ...p.failed].filter(Boolean).join("; ") || null,
        formatMoney(p.sum),
      ]),
      [3.2, 1.4, 2, 4.5, 1.4],
      t("connect.executor.paymentsHint"),
    );
    tableSlides(
      pptx,
      t("connect.executor.visits"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.city"),
        t("connect.col.date"),
        t("connect.col.problem"),
      ],
      x.openVisits.map((v) => [
        v.store,
        v.city,
        v.day,
        [v.done ? null : t("connect.executor.visitOpen"), ...v.problems].filter(Boolean).join("; "),
      ]),
      [3.2, 1.4, 1.2, 6.4],
    );
  }

  return Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer);
}
