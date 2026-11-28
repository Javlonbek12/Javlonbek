import ExcelJS from "exceljs";

import { t } from "@/lib/i18n";
import { addStyledSheet, type SheetColumn, type Value } from "@/modules/connect/xlsx-style";

import { coverFlags } from "./calc";
import type { SopReport } from "./report";
import type { SopMarkRow } from "./service";
import type { SopSettings } from "./settings";
import { describeFinding, monthLabel } from "./texts";

// The upload on screen as an Excel file: plain sheets with the findings, the stocks, the order
// and the shipment caps (or the caps alone, to send to the sales team). The numbers are the
// report's own, so the file says what the pages say.

const one = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

function capsSheet(book: ExcelJS.Workbook, report: SopReport, settings: SopSettings) {
  const labels = { ka: settings.kaLabel, distributor: settings.distributorLabel };
  const months = report.caps[0]?.months.map((m) => m.month) ?? [];
  const columns: SheetColumn[] = [
    { header: t("sop.xlsx.sku"), width: 34 },
    { header: t("sop.xlsx.factory"), width: 9 },
    ...months.flatMap((month): SheetColumn[] => [
      {
        header: `${monthLabel(month)} · ${t("sop.caps.columns.sellIn")}`,
        width: 13,
        format: "count",
      },
      {
        header: `${monthLabel(month)} · ${t("sop.caps.columns.ka", labels)}`,
        width: 13,
        format: "count",
      },
      {
        header: `${monthLabel(month)} · ${t("sop.caps.columns.cap", labels)}`,
        width: 15,
        format: "count",
      },
      {
        header: `${monthLabel(month)} · ${t("sop.caps.columns.stock")}`,
        width: 13,
        format: "count",
      },
      {
        header: `${monthLabel(month)} · ${t("sop.caps.columns.kaMonths", labels)}`,
        width: 13,
        format: "count",
        tone: (value) => (typeof value === "number" && value < 3 ? "bad" : null),
      },
    ]),
  ];
  const rows = report.caps.map((row): Value[] => [
    row.name,
    row.factory,
    ...row.months.flatMap((m) => [m.sellIn, m.ka, m.cap, m.entityStock, one(m.kaMonths)]),
  ]);
  addStyledSheet(book, t("sop.xlsx.caps"), columns, rows, {
    source: "both",
    about: t("sop.xlsx.caps"),
  });
}

export async function sopXlsx(input: {
  report: SopReport;
  settings: SopSettings;
  marks: Map<string, SopMarkRow>;
  // Only the caps, for the sales team.
  part?: "caps";
}): Promise<Buffer> {
  const { report, settings, marks } = input;
  const book = new ExcelJS.Workbook();
  if (input.part === "caps") {
    capsSheet(book, report, settings);
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  // --- Findings ---------------------------------------------------------------------------------
  addStyledSheet(
    book,
    t("sop.xlsx.findings"),
    [
      {
        header: t("sop.xlsx.severity"),
        width: 12,
        tone: (_, row) =>
          row[0] === t("sop.severityOne.error")
            ? "bad"
            : row[0] === t("sop.severityOne.risk")
              ? "warn"
              : null,
      },
      { header: t("sop.xlsx.rule"), width: 40 },
      { header: t("sop.xlsx.sku"), width: 34 },
      { header: t("sop.xlsx.factory"), width: 9 },
      { header: t("sop.xlsx.months"), width: 22 },
      { header: t("sop.xlsx.details"), width: 60 },
      { header: t("sop.xlsx.why"), width: 60 },
      { header: t("sop.xlsx.todo"), width: 60 },
      { header: t("sop.xlsx.mark"), width: 24 },
    ],
    report.findings.map((finding): Value[] => {
      const text = describeFinding(finding);
      const mark = marks.get(finding.key);
      return [
        t(`sop.severityOne.${finding.severity}`),
        text.name,
        finding.sku?.name ?? (finding.skus.map((s) => s.name).join(", ") || text.subject),
        finding.factory,
        finding.months.map(monthLabel).join(", "),
        [text.line, text.rows.join("; ")].filter(Boolean).join(" "),
        text.why,
        text.todo,
        mark ? [t(`sop.findings.mark.${mark.status}`), mark.note].filter(Boolean).join(": ") : null,
      ];
    }),
    { source: "both", about: t("sop.xlsx.findings") },
  );

  // --- Stocks -------------------------------------------------------------------------------------
  const closed = report.months.closed ? monthLabel(report.months.closed) : "";
  const coverTone = (index: number) => (_: Value, __: Value[], rowIndex: number) => {
    const stats = report.stats[rowIndex];
    const cover = stats?.covers[index];
    if (!stats || !cover || !cover.judged || cover.total === null) return null;
    const flags = coverFlags(cover, settings);
    if (flags.entityLow || flags.distLow) return "bad" as const;
    return flags.high ? ("warn" as const) : ("good" as const);
  };
  addStyledSheet(
    book,
    t("sop.xlsx.stock"),
    [
      { header: t("sop.xlsx.sku"), width: 34 },
      { header: t("sop.xlsx.factory"), width: 9 },
      { header: t("sop.xlsx.code"), width: 14 },
      { header: t("sop.xlsx.status"), width: 18 },
      { header: t("sop.xlsx.entity", { month: closed }), width: 14, format: "count" },
      { header: t("sop.xlsx.dist", { month: closed }), width: 14, format: "count" },
      ...report.months.horizon.map((month, index): SheetColumn => ({
        header: t("sop.xlsx.coverOf", { month: monthLabel(month) }),
        width: 11,
        format: "count",
        tone: coverTone(index),
      })),
      { header: t("sop.xlsx.risk"), width: 12 },
      { header: t("sop.xlsx.runOut"), width: 14 },
      { header: t("sop.xlsx.actual"), width: 13, format: "count" },
      { header: t("sop.xlsx.planned"), width: 13, format: "count" },
      { header: t("sop.xlsx.flags"), width: 22 },
    ],
    report.stats.map((s): Value[] => [
      s.name,
      s.factory,
      s.code,
      s.status,
      s.stock.entity,
      s.stock.dist,
      ...s.covers.map((c) => one(c.total)),
      s.riskMonth ? monthLabel(s.riskMonth) : null,
      s.runOut ? monthLabel(s.runOut.month) : null,
      s.runRate === null ? null : one(s.runRate),
      one(s.planRate),
      [
        s.short && t("sop.stock.flags.short"),
        s.excess && t("sop.stock.flags.excess"),
        s.slow && t("sop.stock.flags.slow"),
      ]
        .filter(Boolean)
        .join(", ") || null,
    ]),
    { source: "both", about: t("sop.xlsx.stock") },
  );

  // --- The order by factory and month ----------------------------------------------------------
  const yes = t("sop.xlsx.yes");
  addStyledSheet(
    book,
    t("sop.xlsx.order"),
    [
      { header: t("sop.xlsx.factory"), width: 10 },
      { header: t("sop.xlsx.month"), width: 10 },
      { header: t("sop.xlsx.frozen"), width: 12 },
      { header: t("sop.xlsx.ordering"), width: 14 },
      { header: t("sop.metrics.po"), width: 13, format: "count" },
      { header: t("sop.metrics.plan"), width: 13, format: "count" },
      { header: t("sop.metrics.out"), width: 13, format: "count" },
      { header: t("sop.xlsx.loads"), width: 13, format: "count" },
      { header: t("sop.xlsx.lastFill"), width: 13, format: "count" },
      { header: t("sop.xlsx.regular"), width: 13, format: "count" },
    ],
    report.factories.flatMap((plan) =>
      plan.months.map((m): Value[] => [
        plan.factory,
        monthLabel(m.month),
        m.frozen ? yes : null,
        m.ordering ? yes : null,
        m.po,
        m.plan,
        m.out,
        m.load?.count ?? null,
        m.load ? Math.round(m.load.lastFill * 100) : null,
        m.regularPo || null,
      ]),
    ),
    { source: "both", about: t("sop.xlsx.order") },
  );

  // --- The order hint ---------------------------------------------------------------------------
  addStyledSheet(
    book,
    t("sop.xlsx.hints"),
    [
      { header: t("sop.xlsx.sku"), width: 34 },
      { header: t("sop.xlsx.factory"), width: 9 },
      { header: t("sop.xlsx.month"), width: 10 },
      { header: t("sop.xlsx.inFile"), width: 12, format: "count" },
      { header: t("sop.xlsx.suggested"), width: 12, format: "count" },
      {
        header: t("sop.xlsx.change"),
        width: 12,
        format: "count",
        tone: (value) =>
          typeof value !== "number" || value === 0 ? null : value > 0 ? "bad" : "warn",
      },
      { header: t("sop.xlsx.coverAfter"), width: 12, format: "count" },
    ],
    report.hints.flatMap((hint) =>
      hint.steps.map((step): Value[] => [
        hint.name,
        hint.factory,
        monthLabel(step.month),
        step.filePo,
        step.suggested,
        step.change,
        one(step.coverAfter),
      ]),
    ),
    { source: "both", about: t("sop.xlsx.hints") },
  );

  capsSheet(book, report, settings);
  return Buffer.from(await book.xlsx.writeBuffer());
}
