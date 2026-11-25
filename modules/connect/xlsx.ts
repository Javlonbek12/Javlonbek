import ExcelJS from "exceljs";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { IsmBlock, paymentIssues } from "./analytics";
import type { TreeNode } from "./hierarchy";
import { insightSheets } from "./insights-xlsx";
import { localizeData } from "./localize";
import { oosPathSheets } from "./oos-path-xlsx";
import { monthsLabel, type ConnectReport } from "./report";
import { routeSheets } from "./routes-xlsx";
import { DEFAULT_RULES } from "./rules";
import {
  connectTone,
  deliveryColor,
  regionTone,
  STAGE_COLOR,
  visitedTone,
  type Tone,
} from "./tone";
import {
  aggregateRows,
  MV_RESULTS,
  NO_VISITS_REGION,
  STORE_OPEN_QUESTION,
  VISIT_ISSUES,
  type RowTotals,
  type TsmRow,
  type VisitSections,
} from "./visits";
import { connectCover, type ListedSheet } from "./xlsx-cover";
import {
  addCoverSheet,
  addStyledSheet,
  fillCoverSheet,
  type AddSheet,
  type CellFormat,
  type SheetColumn,
  type SheetRow,
  type Value,
} from "./xlsx-style";

type About = keyof typeof ru.connect.cover.about;

// The level on the screen as Excel: a cover, then the same sections, one sheet each, ready to
// filter and sort and coloured as the page is (see xlsx-style.ts). Texts follow the language of
// the current work (see withExportLocale); known data values (answers, statuses, questions,
// equipment) are translated with localizeData.
export async function connectXlsx(report: ConnectReport, today: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  // The cover comes first and lists the sheets after it: filled when they are made.
  const cover = addCoverSheet(book, t("connect.sheets.summary"));
  const listed: ListedSheet[] = [];
  const sheet: AddSheet = (name, columns, rows, options) => {
    const ws = addStyledSheet(book, name, columns, rows, options);
    listed.push({ name: ws.name, about: options.about, source: options.source });
    return ws;
  };
  const about = (key: About) => t(`connect.cover.about.${key}`);
  const col = (
    key: keyof typeof ru.connect.col,
    width = 14,
    format: CellFormat = "text",
    more: Partial<SheetColumn> = {},
  ): SheetColumn => ({ header: t(`connect.col.${key}`), width, format, ...more });
  const count = (key: keyof typeof ru.connect.col, width = 14) => col(key, width, "count");
  const share = (key: keyof typeof ru.connect.col, width = 10) => col(key, width, "percent");
  // A list of numbers: each row says what its number is (a count without it).
  const metric = [col("metric", 50), col("value", 18, "count")];
  const number = (
    label: string,
    value: Value,
    format: CellFormat = "count",
    tone: Tone | null = null,
  ): SheetRow => ({ cells: [label, value], format, tone });
  const percent = (label: string, value: Value) => number(`${label}, %`, value, "percent");
  // The page marks a number that should be zero and is not.
  const some = (value: number): Tone | null => (value ? "warn" : null);
  // The owner's lines («Нормы»), as the page takes them.
  const rules = report.insights?.rules ?? DEFAULT_RULES;
  // A delivery status as the bot writes it, in the colour of its stage.
  const statusColumn = (statuses: (string | null)[]) =>
    col("status", 44, "text", { color: (_, __, i) => deliveryColor(statuses[i] ?? "") });

  // Sections 1–3 as metric lists, the orders by status, products and questions as tables.
  const sections = (s: VisitSections) => {
    const v = s.visits;
    sheet(
      t("connect.sheets.visits"),
      metric,
      [
        number(t("connect.visits.planned"), v.planned),
        number(t("connect.visits.visited"), v.visited),
        percent(t("connect.visits.visited"), v.visitedRate),
        number(t("connect.visits.notVisited"), v.notVisited, "count", some(v.notVisited)),
        number(t("connect.visits.unplanned"), v.unplanned),
        percent(t("connect.visits.withMv"), v.withMvRate),
        percent(t("connect.visits.withOos"), v.withOosRate),
        number(t("connect.visits.both"), v.both),
        number(
          `${t("connect.visits.inTime")}, % (${t("connect.visits.inTimeNote")})`,
          v.timed ? v.inTimeRate : null,
          "percent",
        ),
        number(t("connect.visits.otherEmployee"), v.otherEmployee, "count", some(v.otherEmployee)),
        number(t("connect.visits.closed"), v.closed),
        ...(["ok", ...VISIT_ISSUES] as const).map((s) =>
          number(t(`connect.status.${s}`), v.status[s]),
        ),
        number(t("connect.visits.mvWithoutVisit"), v.mvWithoutVisit),
        number(`${t("connect.visits.duplicates")}: ${t("connect.col.mv")}`, v.mvCopiesRemoved),
        number(`${t("connect.visits.duplicates")}: ${t("connect.col.oos")}`, v.oosCopiesRemoved),
      ],
      { source: "both", about: about("visits"), list: true },
    );
    sheet(
      t("connect.sheets.days"),
      [
        col("day", 14, "date"),
        { header: t("connect.visits.legend.planned"), width: 14, format: "count" },
        { header: t("connect.visits.legend.visited"), width: 14, format: "count" },
        { header: t("connect.visits.legend.withConnect"), width: 14, format: "count" },
      ],
      v.days.map((d) => [d.day, d.planned, d.visited, d.withConnect]),
      { source: "both", about: about("days") },
    );
    const o = s.oos;
    sheet(
      t("connect.sheets.oos"),
      metric,
      [
        number(t("connect.oos.checked"), o.checked),
        number(t("connect.oos.withGap"), o.withGap),
        percent(t("connect.oos.withGap"), o.gapRate),
        percent(t("connect.oos.ledToOrder"), o.orderRate),
        number(t("connect.oos.orders"), o.orders),
        number(t("connect.oos.packs"), o.packs),
        number(`${t("connect.oos.sum")}, ${t("connect.sum")}`, o.sum, "money"),
      ],
      { source: "bot", about: about("oos"), list: true },
    );
    sheet(
      t("connect.sheets.statuses"),
      [
        statusColumn(o.byStatus.map((x) => x.status)),
        count("count"),
        count("packs"),
        col("sum", 18, "money"),
      ],
      o.byStatus.map((x) => [
        localizeData(x.status) || t("connect.oos.noStatus"),
        x.count,
        x.packs,
        x.sum,
      ]),
      { source: "bot", about: about("statuses") },
    );
    sheet(
      t("connect.sheets.skus"),
      [
        col("sku", 34),
        count("count"),
        { header: `${t("connect.col.share")}, %`, width: 12, format: "percent" },
      ],
      o.topSkus.map((x) => [x.sku, x.total, x.rate]),
      { source: "bot", about: about("skus") },
    );
    const sales = o.sales;
    if (sales) {
      sheet(
        t("connect.sheets.sales"),
        metric,
        [
          number(t("connect.oos.salesChecked"), sales.checked),
          number(t("connect.col.notClosed"), sales.notClosed),
          number(t("connect.oos.salesAny"), sales.anySold),
          percent(t("connect.oos.salesAny"), sales.anyRate),
          number(t("connect.oos.salesAll"), sales.allSold),
          percent(t("connect.oos.salesAll"), sales.allRate),
          [t("connect.col.linesSold"), `${sales.linesSold} / ${sales.lines}`],
          percent(t("connect.oos.salesLines"), sales.linesRate),
          [t("connect.col.packsSold"), `${sales.packsSold} / ${sales.packsOrdered}`],
          percent(t("connect.oos.salesPacks"), sales.packsRate),
          number(t("connect.col.packsRaw"), sales.packsSoldRaw),
          [],
          // How far the sales are loaded: an order's three days may not be over yet.
          [t("connect.oos.salesDate", { date: formatDay(sales.to) }), null],
        ],
        { source: "both", about: about("sales"), list: true },
      );
      sheet(
        t("connect.sheets.salesStatuses"),
        [
          statusColumn(sales.byStatus.map((x) => x.status)),
          count("orders", 10),
          count("checked", 10),
          count("notClosed", 12),
          count("anySold", 10),
          { header: `${t("connect.col.anySold")}, %`, width: 10, format: "percent" },
          count("allSold", 10),
          { header: `${t("connect.col.allSold")}, %`, width: 10, format: "percent" },
          // «12 / 30»: two numbers in a text, on the numbers' side.
          count("linesSold", 14),
          count("packsSold", 14),
          count("packsRaw", 12),
        ],
        sales.byStatus.map((x) => [
          localizeData(x.status) || t("connect.oos.noStatus"),
          x.orders,
          x.checked,
          x.notClosed,
          x.anySold,
          x.anyRate,
          x.allSold,
          x.allRate,
          `${x.linesSold} / ${x.lines}`,
          `${x.packsSold} / ${x.packsOrdered}`,
          x.packsSoldRaw,
        ]),
        { source: "both", about: about("salesStatuses") },
      );
      sheet(
        t("connect.sheets.unsoldSkus"),
        [
          col("sku", 34),
          count("orders", 10),
          count("count", 12),
          { header: "%", width: 8, format: "percent" },
        ],
        sales.topUnsold.map((x) => [x.sku, x.ordered, x.unsold, x.rate]),
        { source: "both", about: about("unsoldSkus") },
      );
    }
    const m = s.mv;
    sheet(
      t("connect.sheets.mv"),
      metric,
      [
        number(t("connect.mv.unique"), m.unique),
        percent(t("connect.mv.fullRate"), m.fullRate),
        number(t("connect.mv.problems"), m.problems),
        ...MV_RESULTS.map((r) => number(t(`connect.result.${r}`), m.results[r])),
      ],
      { source: "bot", about: about("mv"), list: true },
    );
    // A question's share of problem answers is on its first row; the page writes it in amber.
    const questions = m.questions.flatMap((q) => [
      ...q.answers.map((a, i) => ({
        cells: [localizeData(q.q), localizeData(a.value), a.count, i === 0 ? q.problemRate : null],
        problem: i === 0 && q.q !== STORE_OPEN_QUESTION && q.problems > 0,
      })),
      ...(q.unanswered
        ? [
            {
              cells: [localizeData(q.q), t("connect.mv.unanswered"), q.unanswered, null],
              problem: false,
            },
          ]
        : []),
    ]);
    sheet(
      t("connect.sheets.questions"),
      [
        col("question", 70),
        col("answer", 28),
        count("count"),
        col("problemRate", 14, "percent", {
          tone: (_, __, i) => (questions[i]!.problem ? "warn" : null),
          paint: "text",
        }),
      ],
      questions.map((q): Value[] => q.cells),
      { source: "bot", about: about("questions") },
    );
    sheet(
      t("connect.sheets.equipment"),
      [col("value", 50), count("count")],
      m.equipment.map((e) => [localizeData(e.type), e.count]),
      { source: "bot", about: about("equipment") },
    );
  };

  // The sales cross-check per TSM or position (when sales are loaded).
  const salesColumns = report.salesDate
    ? [
        count("checked", 10),
        count("anySold", 10),
        share("salesRate", 12),
        count("allSold", 10),
        count("linesSold", 14),
        count("packsSold", 14),
        count("notClosed", 12),
      ]
    : [];
  const salesCells = (r: Pick<RowTotals, "sales" | "salesRate">): Value[] =>
    report.salesDate
      ? [
          r.sales.checked,
          r.sales.anySold,
          r.sales.checked ? r.salesRate : null,
          r.sales.allSold,
          `${r.sales.linesSold} / ${r.sales.lines}`,
          `${r.sales.packsSold} / ${r.sales.packsOrdered}`,
          r.sales.notClosed,
        ]
      : [];

  const people = (rows: TsmRow[]) =>
    sheet(
      t("connect.sheets.people"),
      [
        col("tsm", 26),
        col("person", 30),
        col("zone", 18),
        col("region", 16),
        count("planned", 10),
        share("visitedRate"),
        share("connectRate"),
        share("withMvRate"),
        share("withOosRate"),
        share("inTimeRate"),
        count("otherEmployee", 10),
        count("closed", 10),
        count("attention", 10),
        share("mvFullRate"),
        count("problems", 10),
        count("oosFound", 10),
        count("orders", 10),
        count("packs", 10),
        col("sum", 16, "money"),
        ...salesColumns,
        col("statuses", 60),
      ],
      rows.map((r) => [
        r.code,
        r.name,
        r.zone,
        r.region,
        r.planned,
        r.visitedRate,
        r.connectRate,
        r.withMvRate,
        r.withOosRate,
        r.timed ? r.inTimeRate : null,
        r.otherEmployee,
        r.closed,
        r.attention,
        r.mvFullRate,
        r.problems,
        r.oosFound,
        r.orders,
        r.packs,
        r.sum,
        ...salesCells(r),
        r.statuses
          .map((s) => `${localizeData(s.status) || t("connect.oos.noStatus")}: ${s.count}`)
          .join("; "),
      ]),
      { source: "both", about: about("people") },
    );

  // The managers' tree: each position indented under the one above it, with the numbers of the
  // TSMs under it; positions without TSMs (the distributor's staff) after them, without numbers.
  const tree = (roots: TreeNode[], idle: TreeNode[]) => {
    const rows: SheetRow[] = [];
    const add = (
      depth: number,
      title: string,
      person: Value,
      roles: Value,
      totals: RowTotals | null,
      tsms: number,
    ) =>
      rows.push({
        cells: [
          title,
          person,
          roles,
          tsms || null,
          ...(totals
            ? [
                totals.planned,
                totals.visitedRate,
                totals.connectRate,
                totals.timed ? totals.inTimeRate : null,
                totals.mvFullRate,
                totals.oosFound,
                totals.orders,
                totals.packs,
                totals.sum,
                ...salesCells(totals),
              ]
            : []),
        ],
        indent: Math.min(depth, 15),
        bold: tsms > 1 || (!totals && depth === 0),
      });
    const walk = (n: TreeNode) => {
      add(
        n.depth,
        n.title,
        n.people.length
          ? n.people.map((p) => p.name ?? t("connect.manager.vacant")).join("; ")
          : t("connect.manager.noRow"),
        n.people.flatMap((p) => p.roles).join(", ") || null,
        n.totals,
        n.tsms,
      );
      // A TSM code of a position with positions under it: its own row.
      if (n.children.length || n.own.length > 1)
        for (const r of n.own) add(n.depth + 1, r.code, r.name, null, aggregateRows([r]), 1);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    if (idle.length) {
      rows.push([], { cells: [t("connect.manager.idle")], kind: "title" });
      idle.forEach(walk);
    }
    sheet(
      t("connect.sheets.tree"),
      [
        col("position", 40),
        col("person", 30),
        col("roles", 26),
        count("people", 8),
        count("planned", 10),
        share("visitedRate"),
        share("connectRate"),
        share("inTimeRate"),
        share("mvFullRate"),
        count("oosFound", 10),
        count("orders", 10),
        count("packs", 10),
        col("sum", 16, "money"),
        ...salesColumns,
      ],
      rows,
      { source: "both", about: about("tree") },
    );
  };

  const ism = (block: IsmBlock | null, issues: ReturnType<typeof paymentIssues> | null) => {
    const name = `${t("connect.sheets.ism")} ${monthsLabel(report.months)}`;
    if (issues)
      return sheet(
        name,
        [
          col("store", 40),
          col("city", 16),
          col("date", 12, "date"),
          col("stage", 24, "text", { color: (_, __, i) => STAGE_COLOR[issues[i]!.stage] }),
          col("status", 40),
          col("sum", 14, "money"),
        ],
        issues.map((p) => [
          p.store,
          p.city,
          p.day,
          t(`connect.paymentStage.${p.stage}`),
          [p.note, ...p.failed]
            .map((x) => localizeData(x))
            .filter(Boolean)
            .join("; ") || null,
          p.sum,
        ]),
        { source: "bot", about: about("ismIssues") },
      );
    if (!block) return;
    const rows: SheetRow[] = [
      [t("connect.kpi.requests"), block.requests, block.contractSum],
      ...block.stages.map((s): Value[] => [t(`connect.paymentStage.${s.id}`), s.value, s.sum]),
    ];
    // Under the stages: what waits for a decision (a table of its own) and the checklist's «no».
    const waiting: CellFormat[] = ["text", "text", "text", "text", "money", "count"];
    if (block.waitingList.length) {
      rows.push(
        [],
        { cells: [t("connect.ism.waiting")], kind: "title" },
        {
          cells: [
            t("connect.col.store"),
            t("connect.col.person"),
            t("connect.col.stage"),
            t("connect.col.decider"),
            t("connect.col.sum"),
            t("connect.col.days"),
          ],
          kind: "header",
          formats: waiting,
        },
        ...block.waitingList.map((p): SheetRow => ({
          cells: [
            p.store,
            p.person,
            t(`connect.paymentStage.${p.stage}`),
            p.decider,
            p.sum,
            p.days,
          ],
          formats: waiting,
        })),
      );
    }
    if (block.checklistFails.length) {
      rows.push(
        [],
        { cells: [t("connect.ism.checklist")], kind: "title" },
        ...block.checklistFails.map((f): SheetRow => ({
          cells: [localizeData(f.q), `${f.no}/${f.total}`, `${f.rate}%`],
          formats: ["text", "count", "count"],
        })),
      );
    }
    const ws = sheet(name, [col("stage", 40), count("count"), col("sum", 18, "money")], rows, {
      source: "bot",
      about: about("ism"),
    });
    // The list under the stages is wider than they are: a person and a stage under the stages'
    // numbers, then three columns more.
    if (block.waitingList.length)
      [28, 24, 30, 16, 10].forEach((width, i) => (ws.getColumn(2 + i).width = width));
  };

  if (report.exec) {
    const e = report.exec;
    sheet(
      t("connect.sheets.regions"),
      [
        col("region", 20),
        count("people", 8),
        count("planned", 10),
        // The two shares the page colours against the owner's lines.
        col("visitedRate", 10, "percent", {
          tone: (_, __, i) => visitedTone(e.regions[i]!, rules),
        }),
        col("connectRate", 10, "percent", {
          tone: (_, __, i) => connectTone(e.regions[i]!, rules),
        }),
        share("withMvRate", 10),
        share("withOosRate", 10),
        share("inTimeRate", 10),
        count("otherEmployee", 10),
        count("closed", 10),
        share("mvFullRate", 10),
        count("oosFound", 10),
        count("orders", 10),
        count("packs", 10),
        col("sum", 16, "money"),
      ],
      e.regions.map((r) => [
        r.region === NO_VISITS_REGION ? t("connect.section.noVisitsRegion") : r.region,
        r.people,
        r.planned,
        r.visitedRate,
        r.connectRate,
        r.withMvRate,
        r.withOosRate,
        r.timed ? r.inTimeRate : null,
        r.otherEmployee,
        r.closed,
        r.mvFullRate,
        r.oosFound,
        r.orders,
        r.packs,
        r.sum,
      ]),
      {
        source: "both",
        about: about("regions"),
        rowTone: (_, i) => regionTone(e.regions[i]!, rules),
      },
    );
    sections(e.sections);
    ism(e.ism, null);
  }

  if (report.manager) {
    const m = report.manager;
    if (m.tree) tree(m.tree.roots, m.tree.idle);
    people(m.people);
    sections(m.sections);
    ism(m.ism, null);
  }

  if (report.executor) {
    const x = report.executor;
    const d = x.detail;
    people([x.row]);
    sheet(
      t("connect.sheets.attention"),
      [
        col("store", 40),
        col("date", 12, "date"),
        col("smartUp", 14),
        col("mv", 8),
        col("oos", 8),
        col("issue", 60),
      ],
      d.attention.map((a) => [
        a.store,
        a.day,
        a.smartUp,
        a.mvAt,
        a.oosAt,
        [
          ...a.issues.map((i) => t(`connect.status.${i}`)),
          a.result && a.result !== "full" && a.result !== "closed"
            ? `${t("connect.section.mv")}: ${t(`connect.result.${a.result}`)}`
            : null,
          a.closed ? t("connect.status.closed") : null,
          a.by ? t("connect.executor.byOther", { person: a.by }) : null,
        ]
          .filter(Boolean)
          .join("; "),
      ]),
      { source: "both", about: about("attention") },
    );
    sheet(
      t("connect.sheets.notVisited"),
      [col("store", 40), col("date", 12, "date")],
      d.notVisited.map((n) => [n.store, n.day]),
      { source: "both", about: about("notVisited") },
    );
    sheet(
      t("connect.sheets.withoutVisit"),
      [col("store", 40), col("date", 12, "date"), col("time", 8)],
      d.withoutVisit.map((w) => [w.store, w.day, w.at]),
      { source: "both", about: about("withoutVisit") },
    );
    sheet(
      t("connect.sheets.duplicates"),
      [col("store", 40), col("date", 12, "date"), count("mv", 8), count("oos", 8)],
      d.duplicates.map((w) => [w.store, w.day, w.mv || null, w.oos || null]),
      { source: "both", about: about("duplicates") },
    );
    sheet(
      t("connect.sheets.problems"),
      [col("store", 40), col("date", 12, "date"), col("problems", 90)],
      d.problems.map((p) => [p.store, p.day, p.problems.map((x) => localizeData(x)).join("; ")]),
      { source: "bot", about: about("problems") },
    );
    sheet(
      t("connect.sheets.orders"),
      [
        col("order", 14),
        col("store", 40),
        col("date", 12, "date"),
        { ...statusColumn(d.orders.map((o) => o.status)), width: 40 },
        count("packs"),
        col("sum", 14, "money"),
      ],
      d.orders.map((o) => [o.id, o.store, o.day, localizeData(o.status), o.packs, o.sum]),
      { source: "bot", about: about("orders") },
    );
    if (report.salesDate)
      sheet(
        t("connect.sheets.unsold"),
        [
          col("order", 14),
          col("store", 40),
          col("date", 12, "date"),
          { ...statusColumn(d.unsold.map((o) => o.status)), width: 40 },
          col("skus", 80),
        ],
        d.unsold.map((o) => [o.id, o.store, o.day, localizeData(o.status), o.skus.join(", ")]),
        { source: "both", about: about("unsold") },
      );
    sections(x.sections);
    ism(null, x.payments);
  }
  // «Маршруты и дисциплина» of the level on the screen.
  const routes = report.exec?.routes ?? report.manager?.routes ?? report.executor?.routes;
  if (routes) routeSheets(sheet, routes);
  // Recovery of stock, the distributor's orders after an OOS, who needs attention.
  insightSheets(sheet, report.insights, report.executor !== null);
  // The chain after each check that found a product out, up to the sale in Smart Up.
  oosPathSheets(sheet, report.insights?.oosPath, report.executor !== null);
  fillCoverSheet(cover, connectCover(report, today, listed));
  return Buffer.from(await book.xlsx.writeBuffer());
}
