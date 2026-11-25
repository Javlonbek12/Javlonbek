import { formatNumber as decimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { previousPeriod } from "@/modules/reports/period";

import { attentionRules } from "./attention";
import { formatMoney, formatNumber, periodLabel, type ConnectReport } from "./report";
import { DEFAULT_RULES } from "./rules";
import { connectTone, lineBands, lineTone, targetBands, targetTone, visitedTone } from "./tone";
import { LOWER_IS_BETTER, trendTone, type TrendKey } from "./trend";
import type { Cover, CoverTile, SheetSource } from "./xlsx-style";

// A sheet of the workbook as the cover lists it.
export type ListedSheet = { name: string; about: string; source: SheetSource };

// What the first sheet of the Connect download says (see fillCoverSheet): the level and whose
// data it is, the period and what it is compared with, how fresh the data is; the level's
// headline numbers as the page's tiles show them, in the same colours; the owner's norms with
// what each colour means; the list of sheets.
export function connectCover(report: ConnectReport, today: string, sheets: ListedSheet[]): Cover {
  const rules = report.insights?.rules ?? DEFAULT_RULES;
  const view = report.query.view;
  const routes = report.exec?.routes ?? report.manager?.routes ?? report.executor?.routes ?? null;
  const day = (date: string) => periodLabel({ from: date, to: date }, today);
  const period = periodLabel(report.period, today);
  const previous = periodLabel(previousPeriod(report.period), today);
  const share = (value: number) => `${decimal(value, 2)}%`;

  // --- The headline numbers ---
  const changes = report.insights?.trend?.changes;
  const change = (key: TrendKey): CoverTile["change"] => {
    const now = changes?.[key];
    if (!now) return null;
    const tone = trendTone(now.delta, LOWER_IS_BETTER[key]);
    return { delta: now.delta, tone: tone === "better" ? "good" : tone === "worse" ? "bad" : null };
  };
  const tiles: CoverTile[] = [];
  const sections = report.exec?.sections ?? report.manager?.sections;
  const one = report.executor;
  const zone = one?.routes?.zone;
  if (sections) {
    // Leadership's tiles; a manager's file has the same shares for the TSMs they see.
    const { visits: v, oos: o, mv: m } = sections;
    const recovery = report.insights?.recovery.totals;
    tiles.push(
      {
        label: `${t("connect.tile.planDone")}, %`,
        value: v.visitedRate,
        format: "percent",
        tone: visitedTone(v, rules),
        change: change("planDone"),
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(v.visited),
          planned: formatNumber(v.planned),
        }),
      },
      {
        label: `${t("connect.tile.connectUsed")}, %`,
        value: v.connectRate,
        format: "percent",
        tone: connectTone(v, rules),
        change: change("connectUsed"),
        note: t("connect.tile.connectUsedNote", { rate: v.allGoodRate }),
      },
      { label: `${t("connect.status.ok")}, %`, value: v.allGoodRate, format: "percent" },
      {
        label: `${t("connect.tile.mvFull")}, %`,
        value: m.fullRate,
        format: "percent",
        change: change("mvFull"),
        note: t("connect.tile.mvFullNote", { count: formatNumber(m.unique) }),
      },
      {
        label: t("connect.tile.oosStores"),
        value: o.withGap,
        format: "count",
        // The change is of the share in the note; fewer stores with an OOS is better.
        change: change("oosStores"),
        note: t("connect.tile.oosStoresNote", {
          rate: o.gapRate,
          checked: formatNumber(o.checked),
        }),
      },
      ...(recovery && recovery.stores > 0
        ? [
            {
              label: `${t("connect.recovery.tile")}, %`,
              value: recovery.rate,
              format: "percent" as const,
              tone: lineTone(recovery.rate, rules.recovery),
              change: change("recovery"),
              note: t("connect.recovery.tileNote", {
                restored: formatNumber(recovery.restored),
                total: formatNumber(recovery.wasOut),
              }),
            },
          ]
        : []),
      { label: t("connect.tile.orders"), value: o.orders, format: "count" },
      { label: t("connect.oos.packs"), value: o.packs, format: "count" },
      {
        label: `${t("connect.tile.ordersSum")}, ${t("connect.sum")}`,
        value: o.sum,
        format: "money",
      },
    );
  } else if (
    one &&
    zone?.kind === "DR" &&
    !(one.row.planned || one.row.unplanned || one.row.mvUnique || one.row.oosChecked)
  ) {
    // A distributor's rep has a route and nothing in Connect Bot: the route's numbers.
    const { targets } = one.routes!.analysis;
    tiles.push(
      { label: t("connect.routes.tile.planned"), value: zone.planned, format: "count" },
      {
        label: `${t("connect.routes.tile.attendance")}, %`,
        value: zone.attendance,
        format: "percent",
        tone: targetTone(zone.attendance, targets.attendance),
        note: t("connect.routes.tile.attendanceNote", {
          visited: formatNumber(zone.visited),
          planned: formatNumber(zone.planned),
        }),
      },
      {
        label: `${t("connect.routes.tile.hitRate")}, %`,
        value: zone.hitRate,
        format: "percent",
        tone: targetTone(zone.hitRate, targets.hitRate),
        note: t("connect.routes.tile.hitRateNote", { target: targets.hitRate }),
      },
    );
  } else if (one) {
    const { row: r, sections: s } = one;
    tiles.push(
      {
        label: `${t("connect.tile.planDone")}, %`,
        value: r.visitedRate,
        format: "percent",
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(r.visited),
          planned: formatNumber(r.planned),
        }),
      },
      {
        label: `${t("connect.tile.connectUsed")}, %`,
        value: r.connectRate,
        format: "percent",
        note: t("connect.tile.connectUsedNote", { rate: s.visits.allGoodRate }),
      },
      {
        label: t("connect.col.attention"),
        value: r.attention,
        format: "count",
        tone: r.attention ? "warn" : "good",
      },
      {
        label: `${t("connect.tile.mvFull")}, %`,
        value: r.mvFullRate,
        format: "percent",
        note: t("connect.tile.mvFullNote", { count: formatNumber(r.mvUnique) }),
      },
      {
        label: t("connect.tile.oosStores"),
        value: r.oosFound,
        format: "count",
        note: t("connect.tile.oosStoresNote", {
          rate: s.oos.gapRate,
          checked: formatNumber(r.oosChecked),
        }),
      },
      {
        label: t("connect.tile.orders"),
        value: r.orders,
        format: "count",
        note: `${t("connect.packs", { count: formatNumber(r.packs) })} · ${formatMoney(r.sum)}`,
      },
    );
  }

  // --- About the file ---
  const fresh = [
    report.dataDate && t("connect.dataDate", { date: day(report.dataDate) }),
    routes?.dataDate && t("connect.routes.dataDate", { date: day(routes.dataDate) }),
    report.salesDate && t("connect.oos.salesDate", { date: day(report.salesDate) }),
  ].filter(Boolean);
  const facts: [string, string][] = [
    [
      t("connect.viewsLabel"),
      [t(`connect.views.${view}`), report.query.staff].filter(Boolean).join(" · "),
    ],
    [
      t("connect.cover.who"),
      one
        ? [one.row.code, one.row.name].filter(Boolean).join(" · ")
        : report.manager
          ? t("connect.cover.whoTeam", { count: formatNumber(report.manager.people.length) })
          : t("connect.cover.whoAll"),
    ],
    [t("connect.cover.period"), period],
    [t("connect.cover.compared"), t("connect.cover.comparedValue", { dates: previous })],
    ...(fresh.length ? [[t("connect.cover.fresh"), fresh.join("; ")] as [string, string]] : []),
    [t("connect.cover.made"), day(today)],
    [t("connect.cover.note"), t("connect.testNote")],
  ];

  // --- The norms and the colours ---
  const target = (key: "attendance" | "hitRate") => {
    const bands = targetBands(rules[key]);
    return {
      label: t(`connect.rules.field.${key}`),
      value: share(rules[key]),
      good: t("connect.cover.band.from", { value: share(bands.good) }),
      warn: t("connect.cover.band.between", { from: share(bands.warn), to: share(bands.good) }),
      bad: t("connect.cover.band.below", { value: share(bands.warn) }),
    };
  };
  const line = (key: "connect" | "recovery" | "visited") => {
    const bands = lineBands(rules[key]);
    const off = t("connect.cover.band.off");
    return {
      label: t(`connect.rules.field.${key}`),
      value: share(rules[key]),
      good: bands ? t("connect.cover.band.from", { value: share(bands.good) }) : off,
      warn: bands
        ? t("connect.cover.band.between", { from: share(bands.warn), to: share(bands.good) })
        : off,
      bad: bands ? t("connect.cover.band.below", { value: share(bands.warn) }) : off,
    };
  };
  const R = attentionRules(rules);
  const attention = t("connect.attention.hint", {
    connect: R.connect.below,
    recovery: R.recovery.below,
    followUp: R.followUp.below,
    unsold: R.unsold.from,
  });
  const more: [string, string][] = [
    // Only what this file has.
    ...(routes ? [[t("connect.routes.title"), t("connect.cover.rule.routes")] as const] : []),
    ...(routes?.sales
      ? [[t("connect.zoneSales.title"), t("connect.cover.rule.change")] as const]
      : []),
    ...(routes?.sales?.idle.length
      ? [[t("connect.zoneSales.idle.title"), t("connect.cover.rule.idle")] as const]
      : []),
    ...(report.insights?.oosPath.totals.checks
      ? [[t("connect.oosPath.title"), t("connect.cover.rule.path")] as const]
      : []),
    ...(report.insights?.attention
      ? [
          [
            t("connect.attention.title"),
            report.insights.attendance
              ? `${attention} ${t("connect.attention.hintAttendance", { attendance: R.attendance.below })}`
              : attention,
          ] as const,
        ]
      : []),
    [t("connect.cover.rule.rowTitle"), t("connect.cover.rule.row")],
    [t("connect.cover.rule.statusTitle"), t("connect.cover.rule.status")],
  ].map(([where, rule]): [string, string] => [where, rule]);

  const sourceLabel = (source: SheetSource) =>
    source === "both"
      ? `${t("connect.source.bot")} + ${t("connect.source.smartup")}`
      : t(`connect.source.${source}`);
  return {
    title: `${t("connect.title")} — ${t(`connect.views.${view}`)}: ${period}`,
    tilesHead: [t("connect.col.metric"), t("connect.col.value")],
    tiles,
    changeUnit: t("connect.trend.pp"),
    caption:
      changes && Object.values(changes).some(Boolean)
        ? t("connect.trend.caption", { dates: previous })
        : null,
    facts: { title: t("connect.cover.facts"), rows: facts },
    norms: {
      title: t("connect.cover.norms"),
      hint: t("connect.cover.normsHint"),
      head: [
        t("connect.cover.norm"),
        t("connect.col.value"),
        t("connect.cover.green"),
        t("connect.cover.amber"),
        t("connect.cover.red"),
      ],
      rows: [
        target("attendance"),
        target("hitRate"),
        line("visited"),
        line("connect"),
        line("recovery"),
      ],
      more: { title: t("connect.cover.more"), rows: more },
    },
    sheets: {
      title: t("connect.cover.sheets"),
      hint: t("connect.cover.sheetsHint"),
      head: [t("connect.cover.sheet"), t("connect.cover.what"), t("connect.cover.source")],
      rows: sheets.map((sheet) => ({ ...sheet, sourceLabel: sourceLabel(sheet.source) })),
    },
  };
}
