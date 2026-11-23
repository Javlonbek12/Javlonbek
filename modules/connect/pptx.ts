import PptxGenJS from "pptxgenjs";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { plural } from "@/modules/reports/format";

import { orderStage, type IsmBlock } from "./analytics";
import { flattenTree, type TreeNode } from "./hierarchy";
import { localizeData } from "./localize";
import { formatMoney, formatNumber, monthsLabel, periodLabel, type ConnectReport } from "./report";
import { MV_RESULTS, topAnswers, VISIT_ISSUES, type TsmRow, type VisitSections } from "./visits";

// The level on the screen as a 16:9 deck: native PowerPoint charts and tables, so numbers
// stay editable. Colors: the validated chart palette (blue / orange) and the status scale.
// Texts follow the language of the current work (see withExportLocale); known data values
// (answers, statuses, questions, equipment) are translated with localizeData.

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
  noAnswer: C.amber,
  refused: C.grey,
  rejected: C.grey,
};
// Smart Up visits and Market Visit results (red stays for errors).
const STATUS: Record<string, string> = {
  ok: C.green,
  noMv: C.orange,
  noOos: C.amber,
  notInTime: "B7791F",
  otherEmployee: "8A6FD1",
  full: C.green,
  partial: C.amber,
  noPhoto: C.orange,
  partialNoPhoto: "B7791F",
  skipped: C.grey,
  closed: "B8B6AE",
};
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

function tiles(
  slide: Slide,
  items: { label: string; value: string; note?: string }[],
  y = 1.6,
  h = 2.1,
) {
  const perRow = 4;
  const gap = 0.25;
  const w = (W - 1 - gap * (perRow - 1)) / perRow;
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

export async function connectPptx(report: ConnectReport, today: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = t("connect.title");
  const view = t(`connect.views.${report.query.view}`);
  const period = periodLabel(report.period, today);
  const person = report.executor
    ? [report.executor.row.code, report.executor.row.name].filter(Boolean).join(" · ")
    : null;
  const subtitle = person ? `${person} · ${period}` : period;

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
  cover.addText(person ? `${view}: ${person}` : view, {
    x: 0.7,
    y: 3.25,
    w: W - 1.4,
    h: 0.6,
    fontFace: FONT,
    fontSize: 22,
    color: "CADCFC",
    margin: 0,
  });
  cover.addText([t("connect.pptx.period", { period }), t("connect.testNote")].join("\n"), {
    x: 0.7,
    y: 4.2,
    w: W - 1.4,
    h: 1.2,
    fontFace: FONT,
    fontSize: 13,
    color: "CADCFC",
    margin: 0,
    valign: "top",
  });

  // Sections 1–3: visits by status and by day, orders by delivery status and missing products,
  // MV results, equipment and the answers by question.
  const sectionSlides = (s: VisitSections) => {
    const v = s.visits;
    const visits = pptx.addSlide();
    header(visits, t("connect.section.visits"), subtitle);
    tiles(
      visits,
      [
        {
          label: t("connect.visits.visited"),
          value: `${v.visitedRate}%`,
          note: t("connect.tile.planDoneNote", {
            visited: formatNumber(v.visited),
            planned: formatNumber(v.planned),
          }),
        },
        {
          label: t("connect.visits.withMv"),
          value: `${v.withMvRate}%`,
          note: `${t("connect.visits.withOos")}: ${v.withOosRate}%`,
        },
        {
          label: t("connect.visits.inTime"),
          value: v.timed ? `${v.inTimeRate}%` : "—",
          note: t("connect.visits.inTimeNote"),
        },
        {
          label: t("connect.visits.otherEmployee"),
          value: formatNumber(v.otherEmployee),
          note: `${t("connect.visits.closed")}: ${formatNumber(v.closed)}`,
        },
      ],
      1.45,
      1.35,
    );
    barChart(
      pptx,
      visits,
      { x: 0.5, y: 3.0, w: 6.0, h: 4.2 },
      t("connect.visits.statuses"),
      (["ok", ...VISIT_ISSUES] as const).map((st) => ({
        label: t(`connect.status.${st}`),
        value: v.status[st],
        color: STATUS[st],
      })),
      { horizontal: true },
    );
    if (v.days.length)
      visits.addChart(
        pptx.ChartType.bar,
        [
          [t("connect.visits.legend.planned"), (d: Day) => d.planned],
          [t("connect.visits.legend.visited"), (d: Day) => d.visited],
          [t("connect.visits.legend.withConnect"), (d: Day) => d.withConnect],
        ].map(([name, pick]) => ({
          name: name as string,
          labels: v.days.map((d) => formatDay(d.day)),
          values: v.days.map(pick as (d: Day) => number),
        })),
        {
          x: 6.8,
          y: 3.0,
          w: 6.0,
          h: 4.2,
          barDir: "col",
          barGrouping: "clustered",
          chartColors: ["C9C7BF", C.blue, C.green],
          showTitle: true,
          title: t("connect.visits.byDay"),
          titleFontFace: FONT,
          titleFontSize: 13,
          showLegend: true,
          legendPos: "b",
          legendFontFace: FONT,
          legendFontSize: 10,
          catAxisLabelFontSize: 9,
          catAxisLabelFontFace: FONT,
          valAxisHidden: true,
          valGridLine: { style: "none" },
        },
      );

    const o = s.oos;
    const oos = pptx.addSlide();
    header(oos, t("connect.section.oos"), subtitle);
    tiles(
      oos,
      [
        {
          label: t("connect.oos.withGap"),
          value: formatNumber(o.withGap),
          note: t("connect.tile.oosStoresNote", {
            rate: o.gapRate,
            checked: formatNumber(o.checked),
          }),
        },
        {
          label: t("connect.oos.ledToOrder"),
          value: `${o.orderRate}%`,
          note: t("connect.oos.ledToOrderNote", { count: formatNumber(o.withGap) }),
        },
        {
          label: t("connect.tile.orders"),
          value: formatNumber(o.orders),
          note: t("connect.packs", { count: formatNumber(o.packs) }),
        },
        { label: t("connect.tile.ordersSum"), value: formatMoney(o.sum) },
      ],
      1.45,
      1.35,
    );
    barChart(
      pptx,
      oos,
      { x: 0.5, y: 3.0, w: 6.0, h: 4.2 },
      t("connect.oos.byStatus"),
      o.byStatus.map((x) => ({
        label: localizeData(x.status) || t("connect.oos.noStatus"),
        value: x.count,
        color: STAGE[orderStage({ status: x.status, outcome: null, storeAnswer: null })],
      })),
      { horizontal: true },
    );
    barChart(
      pptx,
      oos,
      { x: 6.8, y: 3.0, w: 6.0, h: 4.2 },
      t("connect.oos.topSkus"),
      o.topSkus.map((x) => ({ label: x.sku, value: x.total, color: C.orange })),
      { horizontal: true },
    );

    // Sold after the order: the shares, each delivery status, the products ordered and not sold.
    const sales = o.sales;
    if (sales && sales.orders) {
      const slide = pptx.addSlide();
      header(
        slide,
        t("connect.oos.salesTitle"),
        `${subtitle} · ${t("connect.oos.salesDate", { date: formatDay(sales.to) })}`,
      );
      tiles(
        slide,
        [
          {
            label: t("connect.oos.salesChecked"),
            value: formatNumber(sales.checked),
            note: sales.notClosed
              ? t("connect.oos.salesNotClosed", { count: formatNumber(sales.notClosed) })
              : undefined,
          },
          {
            label: t("connect.oos.salesAny"),
            value: `${sales.anyRate}%`,
            note: `${t("connect.oos.salesAll")}: ${sales.allRate}%`,
          },
          {
            label: t("connect.oos.salesLines"),
            value: `${sales.linesRate}%`,
            note: t("connect.oos.salesOf", {
              sold: formatNumber(sales.linesSold),
              total: formatNumber(sales.lines),
            }),
          },
          {
            label: t("connect.oos.salesPacks"),
            value: `${sales.packsRate}%`,
            note: t("connect.oos.salesOf", {
              sold: formatNumber(sales.packsSold),
              total: formatNumber(sales.packsOrdered),
            }),
          },
        ],
        1.45,
        1.35,
      );
      barChart(
        pptx,
        slide,
        { x: 0.5, y: 3.0, w: 6.0, h: 4.2 },
        `${t("connect.oos.salesByStatus")}: ${t("connect.col.anySold")}, %`,
        sales.byStatus
          .filter((x) => x.checked)
          .map((x) => ({
            label: `${localizeData(x.status) || t("connect.oos.noStatus")} (${formatNumber(x.checked)})`,
            value: x.anyRate,
            color: STAGE[orderStage({ status: x.status, outcome: null, storeAnswer: null })],
          })),
        { horizontal: true, percent: true },
      );
      barChart(
        pptx,
        slide,
        { x: 6.8, y: 3.0, w: 6.0, h: 4.2 },
        t("connect.oos.salesTopUnsold"),
        sales.topUnsold.map((x) => ({ label: x.sku, value: x.unsold, color: C.amber })),
        { horizontal: true },
      );
    }

    const m = s.mv;
    const mv = pptx.addSlide();
    header(mv, t("connect.section.mv"), subtitle);
    tiles(
      mv,
      [
        { label: t("connect.mv.unique"), value: formatNumber(m.unique) },
        {
          label: t("connect.mv.fullRate"),
          value: `${m.fullRate}%`,
          note: t("connect.mv.fullRateNote"),
        },
        { label: t("connect.mv.problems"), value: formatNumber(m.problems) },
        {
          label: t("connect.visits.duplicates"),
          value: formatNumber(v.mvCopiesRemoved),
          note: t("connect.visits.mvCopies", {
            copies: formatNumber(v.mvCopiesRemoved),
            days: formatNumber(v.mvDuplicateDays),
          }),
        },
      ],
      1.45,
      1.35,
    );
    barChart(
      pptx,
      mv,
      { x: 0.5, y: 3.0, w: 6.0, h: 4.2 },
      t("connect.mv.results"),
      MV_RESULTS.map((r) => ({
        label: t(`connect.result.${r}`),
        value: m.results[r],
        color: STATUS[r],
      })),
      { horizontal: true },
    );
    barChart(
      pptx,
      mv,
      { x: 6.8, y: 3.0, w: 6.0, h: 4.2 },
      t("connect.mv.equipment"),
      m.equipment
        .slice(0, 10)
        .map((e) => ({ label: localizeData(e.type).slice(0, 40), value: e.count })),
      { horizontal: true },
    );
    tableSlides(
      pptx,
      t("connect.mv.questions"),
      subtitle,
      [t("connect.col.question"), t("connect.col.answer"), t("connect.col.problemRate")],
      m.questions.map((q) => [
        localizeData(q.q),
        [
          ...topAnswers(q.answers).shown.map(
            (a) => `${localizeData(a.value)}: ${formatNumber(a.count)}`,
          ),
          ...(topAnswers(q.answers).other
            ? [
                `${t("connect.mv.otherAnswers", { count: topAnswers(q.answers).otherKinds })}: ${formatNumber(topAnswers(q.answers).other)}`,
              ]
            : []),
          ...(q.unanswered ? [`${t("connect.mv.unanswered")}: ${formatNumber(q.unanswered)}`] : []),
        ].join(" · "),
        q.answered ? `${q.problemRate}%` : null,
      ]),
      [5, 6, 1.2],
    );
  };

  const ismSlide = (block: IsmBlock) => {
    if (!block.requests) return;
    const slide = pptx.addSlide();
    header(
      slide,
      t("connect.section.ism"),
      `${subtitle} · ${t("connect.section.ismHint", { months: monthsLabel(report.months) })}`,
    );
    tiles(
      slide,
      [
        {
          label: t("connect.kpi.contractSum"),
          value: formatMoney(block.contractSum),
          note: `${t("connect.kpi.requests")}: ${formatNumber(block.requests)}`,
        },
        {
          label: t("connect.kpi.paidSum"),
          value: formatMoney(block.paidSum),
          note: t("connect.kpi.paidRate", { rate: block.paidRate }),
        },
        {
          label: t("connect.kpi.waitingSum"),
          value: formatMoney(block.waitingSum),
          note: plural("connect.words.requests", block.waiting),
        },
        {
          label: t("connect.kpi.checklist"),
          value: pct(block.checklist),
          note: t("connect.kpi.roiPositive", { rate: block.roiPositive }),
        },
      ],
      1.45,
      1.35,
    );
    barChart(
      pptx,
      slide,
      { x: 0.5, y: 3.0, w: 12.3, h: 4.2 },
      t("connect.ism.stages"),
      block.stages.map((s) => ({
        label: `${t(`connect.paymentStage.${s.id}`)} (${formatMoney(s.sum)})`,
        value: s.value,
        color: STAGE[s.id],
      })),
      { horizontal: true },
    );
  };

  const peopleTable = (rows: TsmRow[]) =>
    tableSlides(
      pptx,
      t("connect.manager.people"),
      subtitle,
      [
        t("connect.col.tsm"),
        t("connect.col.planned"),
        t("connect.col.visitedRate"),
        t("connect.col.withMvRate"),
        t("connect.col.withOosRate"),
        t("connect.col.inTimeRate"),
        t("connect.col.otherEmployee"),
        t("connect.col.attention"),
        t("connect.col.mvFullRate"),
        t("connect.col.oosFound"),
        t("connect.col.orders"),
        t("connect.col.sum"),
      ],
      rows
        .slice(0, 48)
        .map((r) => [
          r.name ? `${r.code} · ${r.name}` : r.code,
          r.planned,
          pct(r.visitedRate),
          pct(r.withMvRate),
          pct(r.withOosRate),
          r.timed ? pct(r.inTimeRate) : "—",
          r.otherEmployee,
          r.attention,
          pct(r.mvFullRate),
          r.oosFound,
          r.orders,
          formatMoney(r.sum),
        ]),
      [4, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 0.9, 1.6],
      cut(rows.length, 48),
    );

  if (report.exec) {
    const e = report.exec;
    const { visits: v, oos: o, mv: m } = e.sections;
    const s1 = pptx.addSlide();
    header(s1, t("connect.views.exec"), subtitle);
    tiles(s1, [
      {
        label: t("connect.tile.planDone"),
        value: `${v.visitedRate}%`,
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(v.visited),
          planned: formatNumber(v.planned),
        }),
      },
      {
        label: t("connect.tile.connectUsed"),
        value: `${v.connectRate}%`,
        note: t("connect.tile.connectUsedNote", { rate: v.allGoodRate }),
      },
      {
        label: t("connect.tile.mvFull"),
        value: `${m.fullRate}%`,
        note: t("connect.tile.mvFullNote", { count: formatNumber(m.unique) }),
      },
      {
        label: t("connect.tile.oosStores"),
        value: formatNumber(o.withGap),
        note: t("connect.tile.oosStoresNote", {
          rate: o.gapRate,
          checked: formatNumber(o.checked),
        }),
      },
      {
        label: t("connect.tile.orders"),
        value: formatNumber(o.orders),
        note: t("connect.packs", { count: formatNumber(o.packs) }),
      },
      { label: t("connect.tile.ordersSum"), value: formatMoney(o.sum) },
      {
        label: t("connect.visits.notVisited"),
        value: formatNumber(v.notVisited),
        note: `${t("connect.visits.unplanned")}: ${formatNumber(v.unplanned)}`,
      },
      {
        label: t("connect.visits.mvWithoutVisit"),
        value: formatNumber(v.mvWithoutVisit),
      },
    ]);
    tableSlides(
      pptx,
      t("connect.section.regions"),
      subtitle,
      [
        t("connect.col.region"),
        t("connect.col.planned"),
        t("connect.col.visitedRate"),
        t("connect.col.connectRate"),
        t("connect.col.withMvRate"),
        t("connect.col.withOosRate"),
        t("connect.col.inTimeRate"),
        t("connect.col.mvFullRate"),
        t("connect.col.oosFound"),
        t("connect.col.orders"),
        t("connect.col.sum"),
      ],
      e.regions.map((r) => [
        r.region,
        r.planned,
        pct(r.visitedRate),
        pct(r.connectRate),
        pct(r.withMvRate),
        pct(r.withOosRate),
        r.timed ? pct(r.inTimeRate) : "—",
        pct(r.mvFullRate),
        r.oosFound,
        r.orders,
        formatMoney(r.sum),
      ]),
      [2.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6],
      t("connect.section.regionsHint"),
    );
    sectionSlides(e.sections);
    ismSlide(e.ism);
  }

  // The managers' tree: positions with TSMs, indented under the one above.
  const treeTable = (roots: TreeNode[]) => {
    const rows = flattenTree(roots).filter((n) => n.totals);
    tableSlides(
      pptx,
      t("connect.manager.tree"),
      subtitle,
      [
        t("connect.col.position"),
        t("connect.col.people"),
        t("connect.col.planned"),
        t("connect.col.visitedRate"),
        t("connect.col.connectRate"),
        t("connect.col.inTimeRate"),
        t("connect.col.mvFullRate"),
        t("connect.col.oosFound"),
        t("connect.col.orders"),
        t("connect.col.sum"),
        ...(report.salesDate ? [t("connect.col.salesRate")] : []),
      ],
      rows.slice(0, 48).map((n) => {
        const r = n.totals!;
        const person = n.people.map((p) => p.name).find(Boolean);
        return [
          `${"\u00a0\u00a0".repeat(n.depth)}${n.title}${person ? ` · ${person}` : ""}`,
          n.tsms,
          r.planned,
          pct(r.visitedRate),
          pct(r.connectRate),
          r.timed ? pct(r.inTimeRate) : "—",
          pct(r.mvFullRate),
          r.oosFound,
          r.orders,
          formatMoney(r.sum),
          ...(report.salesDate ? [r.sales.checked ? pct(r.salesRate) : null] : []),
        ];
      }),
      [4.4, 0.7, 0.9, 1, 1, 1, 1, 1, 0.9, 1.6, ...(report.salesDate ? [1.1] : [])],
      cut(rows.length, 48),
    );
  };

  if (report.manager) {
    if (report.manager.tree) treeTable(report.manager.tree.roots);
    peopleTable(report.manager.people);
    sectionSlides(report.manager.sections);
    ismSlide(report.manager.ism);
  }

  if (report.executor) {
    const x = report.executor;
    const r = x.row;
    const s1 = pptx.addSlide();
    header(s1, person ?? r.code, period);
    tiles(s1, [
      {
        label: t("connect.tile.planDone"),
        value: `${r.visitedRate}%`,
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(r.visited),
          planned: formatNumber(r.planned),
        }),
      },
      { label: t("connect.tile.connectUsed"), value: `${r.connectRate}%` },
      { label: t("connect.col.attention"), value: formatNumber(r.attention) },
      { label: t("connect.tile.mvFull"), value: `${r.mvFullRate}%` },
      { label: t("connect.tile.oosStores"), value: formatNumber(r.oosFound) },
      {
        label: t("connect.tile.orders"),
        value: formatNumber(r.orders),
        note: t("connect.packs", { count: formatNumber(r.packs) }),
      },
      { label: t("connect.tile.ordersSum"), value: formatMoney(r.sum) },
      { label: t("connect.visits.mvWithoutVisit"), value: formatNumber(r.mvWithoutVisit) },
    ]);
    tableSlides(
      pptx,
      t("connect.executor.attention"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.date"),
        t("connect.col.smartUp"),
        t("connect.col.connect"),
        t("connect.col.issue"),
      ],
      x.detail.attention
        .slice(0, 48)
        .map((a) => [
          a.store,
          a.day,
          a.smartUp,
          [a.mvAt && `MV ${a.mvAt}`, a.oosAt && `OOS ${a.oosAt}`].filter(Boolean).join(" · ") ||
            null,
          [
            ...a.issues.map((i) => t(`connect.status.${i}`)),
            a.result && a.result !== "full" && a.result !== "closed"
              ? `${t("connect.section.mv")}: ${t(`connect.result.${a.result}`)}`
              : null,
          ]
            .filter(Boolean)
            .join("; "),
        ]),
      [3.6, 1.2, 1.4, 2, 4],
      [t("connect.executor.attentionHint"), cut(x.detail.attention.length, 48)]
        .filter(Boolean)
        .join(" · "),
    );
    tableSlides(
      pptx,
      t("connect.executor.orders"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.date"),
        t("connect.col.status"),
        t("connect.col.packs"),
        t("connect.col.sum"),
      ],
      x.detail.orders
        .slice(0, 24)
        .map((o) => [
          o.store,
          o.day,
          localizeData(o.status) || t("connect.oos.noStatus"),
          o.packs,
          o.sum,
        ]),
      [3.6, 1.2, 4, 1, 1.4],
      cut(x.detail.orders.length, 24),
    );
    tableSlides(
      pptx,
      t("connect.executor.unsold"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.date"),
        t("connect.col.status"),
        t("connect.col.skus"),
      ],
      x.detail.unsold
        .slice(0, 24)
        .map((o) => [
          o.store,
          o.day,
          localizeData(o.status) || t("connect.oos.noStatus"),
          o.skus.join(", "),
        ]),
      [3.4, 1.2, 3, 4.6],
      [t("connect.executor.unsoldHint"), cut(x.detail.unsold.length, 24)]
        .filter(Boolean)
        .join(" · "),
    );
    tableSlides(
      pptx,
      t("connect.executor.problems"),
      subtitle,
      [t("connect.col.store"), t("connect.col.date"), t("connect.col.problems")],
      x.detail.problems
        .slice(0, 24)
        .map((p) => [p.store, p.day, p.problems.map((q) => localizeData(q)).join("; ")]),
      [3.4, 1.2, 7.6],
      cut(x.detail.problems.length, 24),
    );
    tableSlides(
      pptx,
      t("connect.ism.issues"),
      subtitle,
      [
        t("connect.col.store"),
        t("connect.col.stage"),
        t("connect.col.status"),
        t("connect.col.sum"),
      ],
      x.payments.map((p) => [
        p.store,
        t(`connect.paymentStage.${p.stage}`),
        [p.note, ...p.failed]
          .map((q) => localizeData(q))
          .filter(Boolean)
          .join("; ") || null,
        formatMoney(p.sum),
      ]),
      [3.4, 2.2, 5, 1.6],
      t("connect.section.ismHint", { months: monthsLabel(report.months) }),
    );
  }

  return Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer);
}

type Day = VisitSections["visits"]["days"][number];
