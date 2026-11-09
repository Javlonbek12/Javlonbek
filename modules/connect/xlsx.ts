import ExcelJS from "exceljs";

import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import type { IsmBlock, paymentIssues } from "./analytics";
import { monthsLabel, periodLabel, type ConnectReport } from "./report";
import { MV_RESULTS, VISIT_ISSUES, type TsmRow, type VisitSections } from "./visits";

type Value = string | number | null;

// The level on the screen as Excel: the same sections, one sheet each, ready to filter and sort.
export async function connectXlsx(report: ConnectReport, today: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  const sheet = (name: string, columns: { header: string; width: number }[], rows: Value[][]) => {
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
  const col = (key: keyof typeof ru.connect.col, width = 14) => ({
    header: t(`connect.col.${key}`),
    width,
  });
  const metric = [col("metric", 50), col("value", 18)];
  const period = periodLabel(report.period, today);
  const title = (name: string) => `${t("connect.title")} — ${name}: ${period}`;

  // Sections 1–3 as metric lists, the orders by status, products and questions as tables.
  const sections = (s: VisitSections, heading: string) => {
    const v = s.visits;
    const summary = sheet(t("connect.sheets.visits"), metric, [
      [t("connect.visits.planned"), v.planned],
      [t("connect.visits.visited"), v.visited],
      [`${t("connect.visits.visited")}, %`, v.visitedRate],
      [t("connect.visits.notVisited"), v.notVisited],
      [t("connect.visits.unplanned"), v.unplanned],
      [`${t("connect.visits.withMv")}, %`, v.withMvRate],
      [`${t("connect.visits.withOos")}, %`, v.withOosRate],
      [t("connect.visits.both"), v.both],
      [`${t("connect.visits.inTime")}, % (${t("connect.visits.inTimeNote")})`, v.inTimeRate],
      [t("connect.visits.otherEmployee"), v.otherEmployee],
      [t("connect.visits.closed"), v.closed],
      ...(["ok", ...VISIT_ISSUES] as const).map((s) => [t(`connect.status.${s}`), v.status[s]]),
      [t("connect.visits.mvWithoutVisit"), v.mvWithoutVisit],
      [`${t("connect.visits.duplicates")}: ${t("connect.col.mv")}`, v.mvCopiesRemoved],
      [`${t("connect.visits.duplicates")}: ${t("connect.col.oos")}`, v.oosCopiesRemoved],
    ]);
    summary.insertRow(1, [heading]);
    summary.getRow(1).font = { bold: true, size: 14 };
    sheet(
      t("connect.sheets.days"),
      [
        col("day", 14),
        { header: t("connect.visits.legend.planned"), width: 14 },
        { header: t("connect.visits.legend.visited"), width: 14 },
        { header: t("connect.visits.legend.withConnect"), width: 14 },
      ],
      v.days.map((d) => [d.day, d.planned, d.visited, d.withConnect]),
    );
    const o = s.oos;
    sheet(t("connect.sheets.oos"), metric, [
      [t("connect.oos.checked"), o.checked],
      [t("connect.oos.withGap"), o.withGap],
      [`${t("connect.oos.withGap")}, %`, o.gapRate],
      [`${t("connect.oos.ledToOrder")}, %`, o.orderRate],
      [t("connect.oos.orders"), o.orders],
      [t("connect.oos.packs"), o.packs],
      [`${t("connect.oos.sum")}, ${t("connect.sum")}`, o.sum],
    ]);
    sheet(
      t("connect.sheets.statuses"),
      [col("status", 44), col("count"), col("packs"), col("sum", 18)],
      o.byStatus.map((x) => [x.status || t("connect.oos.noStatus"), x.count, x.packs, x.sum]),
    );
    sheet(
      t("connect.sheets.skus"),
      [col("sku", 34), col("count"), { header: `${t("connect.col.share")}, %`, width: 12 }],
      o.topSkus.map((x) => [x.sku, x.total, x.rate]),
    );
    const m = s.mv;
    sheet(t("connect.sheets.mv"), metric, [
      [t("connect.mv.unique"), m.unique],
      [`${t("connect.mv.fullRate")}, %`, m.fullRate],
      [t("connect.mv.problems"), m.problems],
      ...MV_RESULTS.map((r) => [t(`connect.result.${r}`), m.results[r]]),
    ]);
    sheet(
      t("connect.sheets.questions"),
      [col("question", 70), col("answer", 28), col("count"), col("problemRate")],
      m.questions.flatMap((q) => [
        ...q.answers.map((a, i): Value[] => [
          q.q,
          a.value,
          a.count,
          i === 0 ? q.problemRate : null,
        ]),
        ...(q.unanswered ? [[q.q, t("connect.mv.unanswered"), q.unanswered, null]] : []),
      ]),
    );
    sheet(
      t("connect.sheets.equipment"),
      [col("value", 50), col("count")],
      m.equipment.map((e) => [e.type, e.count]),
    );
  };

  const people = (rows: TsmRow[]) =>
    sheet(
      t("connect.sheets.people"),
      [
        col("tsm", 26),
        col("person", 30),
        col("zone", 18),
        col("region", 16),
        col("planned", 10),
        col("visitedRate", 10),
        col("connectRate", 10),
        col("withMvRate", 10),
        col("withOosRate", 10),
        col("inTimeRate", 10),
        col("otherEmployee", 10),
        col("closed", 10),
        col("attention", 10),
        col("mvFullRate", 10),
        col("problems", 10),
        col("oosFound", 10),
        col("orders", 10),
        col("packs", 10),
        col("sum", 16),
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
        r.inTimeRate,
        r.otherEmployee,
        r.closed,
        r.attention,
        r.mvFullRate,
        r.problems,
        r.oosFound,
        r.orders,
        r.packs,
        r.sum,
        r.statuses.map((s) => `${s.status || t("connect.oos.noStatus")}: ${s.count}`).join("; "),
      ]),
    );

  const ism = (block: IsmBlock | null, issues: ReturnType<typeof paymentIssues> | null) => {
    const name = `${t("connect.sheets.ism")} ${monthsLabel(report.months)}`;
    if (issues)
      return sheet(
        name,
        [
          col("store", 40),
          col("city", 16),
          col("date", 12),
          col("stage", 24),
          col("status", 40),
          col("sum", 14),
        ],
        issues.map((p) => [
          p.store,
          p.city,
          p.day,
          t(`connect.paymentStage.${p.stage}`),
          [p.note, ...p.failed].filter(Boolean).join("; ") || null,
          p.sum,
        ]),
      );
    if (!block) return;
    const ws = sheet(
      name,
      [col("stage", 40), col("count"), col("sum", 18)],
      [
        [t("connect.kpi.requests"), block.requests, block.contractSum],
        ...block.stages.map((s) => [t(`connect.paymentStage.${s.id}`), s.value, s.sum]),
      ],
    );
    if (block.waitingList.length) {
      ws.addRow([]);
      ws.addRow([t("connect.ism.waiting")]).font = { bold: true };
      ws.addRow([
        t("connect.col.store"),
        t("connect.col.person"),
        t("connect.col.stage"),
        t("connect.col.decider"),
        t("connect.col.sum"),
        t("connect.col.days"),
      ]).font = { bold: true };
      for (const p of block.waitingList)
        ws.addRow([
          p.store,
          p.person,
          t(`connect.paymentStage.${p.stage}`),
          p.decider,
          p.sum,
          p.days,
        ]);
    }
    if (block.checklistFails.length) {
      ws.addRow([]);
      ws.addRow([t("connect.ism.checklist")]).font = { bold: true };
      for (const f of block.checklistFails) ws.addRow([f.q, `${f.no}/${f.total}`, `${f.rate}%`]);
    }
  };

  if (report.exec) {
    const e = report.exec;
    const { visits: v, oos: o, mv: m } = e.sections;
    const summary = sheet(t("connect.sheets.summary"), metric, [
      [`${t("connect.tile.planDone")}, %`, v.visitedRate],
      [`${t("connect.tile.connectUsed")}, %`, v.connectRate],
      [`${t("connect.status.ok")}, %`, v.allGoodRate],
      [`${t("connect.tile.mvFull")}, %`, m.fullRate],
      [t("connect.tile.oosStores"), o.withGap],
      [t("connect.tile.orders"), o.orders],
      [t("connect.oos.packs"), o.packs],
      [`${t("connect.tile.ordersSum")}, ${t("connect.sum")}`, o.sum],
    ]);
    summary.insertRow(1, [title(t("connect.views.exec"))]);
    summary.getRow(1).font = { bold: true, size: 14 };
    sheet(
      t("connect.sheets.regions"),
      [
        col("region", 20),
        col("people", 8),
        col("planned", 10),
        col("visitedRate", 10),
        col("connectRate", 10),
        col("withMvRate", 10),
        col("withOosRate", 10),
        col("inTimeRate", 10),
        col("otherEmployee", 10),
        col("closed", 10),
        col("mvFullRate", 10),
        col("oosFound", 10),
        col("orders", 10),
        col("packs", 10),
        col("sum", 16),
      ],
      e.regions.map((r) => [
        r.region,
        r.people,
        r.planned,
        r.visitedRate,
        r.connectRate,
        r.withMvRate,
        r.withOosRate,
        r.inTimeRate,
        r.otherEmployee,
        r.closed,
        r.mvFullRate,
        r.oosFound,
        r.orders,
        r.packs,
        r.sum,
      ]),
    );
    sections(e.sections, title(t("connect.section.visits")));
    ism(e.ism, null);
  }

  if (report.manager) {
    const m = report.manager;
    people(m.people);
    sections(m.sections, title(t("connect.views.manager")));
    ism(m.ism, null);
  }

  if (report.executor) {
    const x = report.executor;
    const d = x.detail;
    const heading = `${x.row.code}${x.row.name ? ` · ${x.row.name}` : ""}: ${period}`;
    people([x.row]).insertRow(1, [heading]);
    sheet(
      t("connect.sheets.attention"),
      [
        col("store", 40),
        col("date", 12),
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
    );
    sheet(
      t("connect.sheets.notVisited"),
      [col("store", 40), col("date", 12)],
      d.notVisited.map((n) => [n.store, n.day]),
    );
    sheet(
      t("connect.sheets.withoutVisit"),
      [col("store", 40), col("date", 12), col("time", 8)],
      d.withoutVisit.map((w) => [w.store, w.day, w.at]),
    );
    sheet(
      t("connect.sheets.duplicates"),
      [col("store", 40), col("date", 12), col("mv", 8), col("oos", 8)],
      d.duplicates.map((w) => [w.store, w.day, w.mv || null, w.oos || null]),
    );
    sheet(
      t("connect.sheets.problems"),
      [col("store", 40), col("date", 12), col("problems", 90)],
      d.problems.map((p) => [p.store, p.day, p.problems.join("; ")]),
    );
    sheet(
      t("connect.sheets.orders"),
      [
        col("order", 14),
        col("store", 40),
        col("date", 12),
        col("status", 40),
        col("packs"),
        col("sum"),
      ],
      d.orders.map((o) => [o.id, o.store, o.day, o.status, o.packs, o.sum]),
    );
    sections(x.sections, heading);
    ism(null, x.payments);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
