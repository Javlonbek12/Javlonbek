import ExcelJS from "exceljs";

import { t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";

import { insightText, monthLabel, periodLabel, type ConnectReport } from "./report";

type Value = string | number | null;

// The level on the screen as Excel: the same tables, one sheet each, ready to filter and sort.
export async function connectXlsx(report: ConnectReport): Promise<Buffer> {
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
  const col = (key: Parameters<typeof colName>[0], width = 14) => ({
    header: colName(key),
    width,
  });
  const title = `${t("connect.title")} — ${t(`connect.views.${report.query.view}`)}`;

  if (report.exec) {
    const e = report.exec;
    const k = e.kpis;
    const summary = sheet(
      t("connect.sheets.summary"),
      [col("metric", 40), col("value", 18)],
      [
        [t("connect.kpi.stores"), k.stores],
        [t("connect.kpi.checks"), k.checks],
        [`${t("connect.kpi.gapRate")}, %`, k.gapRate],
        [t("connect.kpi.avgGaps"), k.avgGaps],
        [`${t("connect.kpi.conversion")}, %`, k.conversion],
        [t("connect.kpi.orders"), k.orders],
        [`${t("connect.kpi.deliveredRate")}, %`, k.deliveredRate],
        [`${t("connect.kpi.noAnswerRate")}, %`, k.noAnswerRate],
        [t("connect.kpi.requests"), k.requests],
        [`${t("connect.kpi.contractSum")}, ${t("connect.sum")}`, k.contractSum],
        [`${t("connect.kpi.paidSum")}, ${t("connect.sum")}`, k.paidSum],
        [`${t("connect.kpi.waitingSum")}, ${t("connect.sum")}`, k.waitingSum],
        [`${t("connect.kpi.checklist")}, %`, k.checklist],
        [t("connect.kpi.visits"), k.visits],
      ],
    );
    summary.insertRow(1, [`${title}: ${periodLabel(report)}`]);
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.addRow([]);
    summary.addRow([t("connect.exec.insights")]).font = { bold: true };
    for (const insight of e.insights) summary.addRow([insightText(insight)]);

    sheet(
      t("connect.sheets.funnel"),
      [col("metric", 30), col("count")],
      e.funnel.map((s) => [t(`connect.exec.funnelSteps.${s.id}`), s.value]),
    );
    sheet(
      t("connect.sheets.trend"),
      [
        { header: t("connect.exec.trendCols.month"), width: 16 },
        { header: t("connect.exec.trendCols.checks"), width: 12 },
        { header: `${t("connect.exec.trendCols.gapRate")}, %`, width: 14 },
        { header: t("connect.exec.trendCols.orders"), width: 12 },
        { header: t("connect.exec.trendCols.delivered"), width: 12 },
        { header: t("connect.exec.trendCols.requests"), width: 12 },
        { header: t("connect.exec.trendCols.contractSum"), width: 16 },
        { header: t("connect.exec.trendCols.paidSum"), width: 16 },
      ],
      e.trend.map((m) => [
        monthLabel(m.month),
        m.checks,
        m.gapRate,
        m.orders,
        m.delivered,
        m.requests,
        m.contractSum,
        m.paidSum,
      ]),
    );
    sheet(
      t("connect.sheets.payments"),
      [col("stage", 30), col("count"), col("sum", 18)],
      e.paymentStages.map((s) => [t(`connect.paymentStage.${s.id}`), s.value, s.sum]),
    );
    sheet(
      t("connect.sheets.orders"),
      [col("stage", 30), col("count")],
      e.orderStages.map((s) => [t(`connect.orderStage.${s.id}`), s.value]),
    );
    sheet(
      t("connect.sheets.skus"),
      [col("sku", 34), col("brand"), col("out"), col("low"), col("total"), col("share")],
      e.topSkus.map((s) => [s.sku, s.brand, s.out, s.low, s.total, s.rate]),
    );
    sheet(
      t("connect.sheets.checklist"),
      [col("question", 70), col("share"), col("count")],
      e.checklistFails.map((f) => [f.q, f.rate, `${f.no}/${f.total}`]),
    );
  }

  if (report.manager) {
    const m = report.manager;
    sheet(
      t("connect.sheets.people"),
      [
        col("person", 44),
        col("open"),
        col("checks"),
        col("gaps"),
        col("ordersFromChecks"),
        col("orders"),
        col("delivered"),
        col("noAnswer"),
        col("requests"),
        col("contractSum", 16),
        col("paid"),
        col("checklist"),
        col("visits"),
        col("visitScore"),
      ],
      m.people.map((p) => [
        p.person,
        p.open,
        p.checks,
        p.gaps,
        p.ordersFromChecks,
        p.orders,
        p.delivered,
        p.noAnswer,
        p.requests,
        p.contractSum,
        p.paid,
        p.checklist,
        p.visits,
        p.visitScore,
      ]),
    );
    sheet(
      t("connect.sheets.cities"),
      [
        col("city", 20),
        col("stores"),
        col("checks"),
        col("gapRate"),
        col("orders"),
        col("delivered"),
        col("requests"),
        col("contractSum", 16),
        col("waiting"),
        col("checklist"),
        col("visitScore"),
      ],
      m.cities.map((c) => [
        c.city,
        c.stores,
        c.checks,
        c.gapRate,
        c.orders,
        c.delivered,
        c.requests,
        c.contractSum,
        c.waiting,
        c.checklist,
        c.visitScore,
      ]),
    );
    sheet(
      t("connect.sheets.waiting"),
      [
        col("store", 40),
        col("city", 16),
        col("person", 40),
        col("stage", 22),
        col("sum", 14),
        col("days", 8),
      ],
      m.waitingPayments.map((p) => [
        p.store,
        p.city,
        p.person,
        t(`connect.paymentStage.${p.stage}`),
        p.sum,
        p.days,
      ]),
    );
    sheet(
      t("connect.sheets.stuck"),
      [
        col("store", 40),
        col("city", 16),
        col("person", 40),
        col("status", 32),
        col("agent", 22),
        col("sum", 12),
        col("days", 8),
      ],
      m.stuckOrders.map((o) => [o.store, o.city, o.person, o.status, o.agentAnswer, o.sum, o.days]),
    );
    sheet(
      t("connect.sheets.skuCity"),
      [col("sku", 34), ...m.skuCity.cities.map((city) => ({ header: `${city}, %`, width: 14 }))],
      m.skuCity.rows.map((r) => [r.sku, ...r.cells.map((c) => c.rate)]),
    );
    sheet(
      t("connect.sheets.checklist"),
      [col("question", 70), col("share"), col("count")],
      m.checklistFails.map((f) => [f.q, f.rate, `${f.no}/${f.total}`]),
    );
    sheet(
      t("connect.sheets.visits"),
      [col("question", 70), col("share"), col("count")],
      m.visitFails.map((f) => [f.q, f.rate, `${f.no}/${f.total}`]),
    );
  }

  if (report.executor && report.query.person) {
    const x = report.executor;
    const k = x.kpis;
    const summary = sheet(
      t("connect.sheets.summary"),
      [col("metric", 40), col("value", 18)],
      [
        [t("connect.col.checks"), k.checks],
        [t("connect.col.gaps"), k.gaps],
        [t("connect.col.ordersFromChecks"), k.ordersFromChecks],
        [t("connect.col.orders"), k.orders],
        [t("connect.col.delivered"), k.delivered],
        [t("connect.col.noAnswer"), k.noAnswer],
        [t("connect.col.requests"), k.requests],
        [`${t("connect.col.contractSum")}, ${t("connect.sum")}`, k.contractSum],
        [t("connect.col.paid"), k.paid],
        [`${t("connect.col.checklist")}, %`, k.checklist],
        [t("connect.col.visits"), k.visits],
        [`${t("connect.col.visitScore")}, %`, k.visitScore],
      ],
    );
    summary.insertRow(1, [`${report.query.person}: ${periodLabel(report)}`]);
    summary.getRow(1).font = { bold: true, size: 14 };
    sheet(
      t("connect.sheets.gaps"),
      [col("store", 40), col("city", 16), col("date", 12), col("sku", 80)],
      x.gapsWithoutOrder.map((g) => [g.store, g.city, g.day, g.skus.join(", ")]),
    );
    sheet(
      t("connect.sheets.openOrders"),
      [
        col("store", 40),
        col("city", 16),
        col("date", 12),
        col("status", 32),
        col("sum", 12),
        col("days", 8),
      ],
      x.openOrders.map((o) => [o.store, o.city, o.day, o.status, o.sum, o.days]),
    );
    sheet(
      t("connect.sheets.paymentIssues"),
      [
        col("store", 40),
        col("city", 16),
        col("date", 12),
        col("stage", 24),
        col("status", 30),
        col("sum", 14),
        col("problem", 70),
      ],
      x.paymentIssues.map((p) => [
        p.store,
        p.city,
        p.day,
        t(`connect.paymentStage.${p.stage}`),
        p.note,
        p.sum,
        p.failed.join("; "),
      ]),
    );
    sheet(
      t("connect.sheets.openVisits"),
      [col("store", 40), col("city", 16), col("date", 12), col("visitScore"), col("problem", 80)],
      x.openVisits.map((v) => [
        v.store,
        v.city,
        v.day,
        v.percent,
        [v.done ? null : t("connect.executor.visitOpen"), ...v.problems].filter(Boolean).join("; "),
      ]),
    );
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

const colName = (key: keyof typeof ru.connect.col) => t(`connect.col.${key}`);
