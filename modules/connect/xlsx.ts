import ExcelJS from "exceljs";

import { formatDay } from "@/lib/dates";
import { formatNumber as decimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { previousPeriod } from "@/modules/reports/period";

import { attentionRules } from "./attention";
import { attentionBlock, followUpBlock, recoveryBlock, worstBlock } from "./insights-xlsx";
import { oosPathBlock } from "./oos-path-xlsx";
import { formatMoney, formatNumber, monthsLabel, periodLabel, type ConnectReport } from "./report";
import { routeBlocks } from "./routes-xlsx";
import { DEFAULT_RULES } from "./rules";
import {
  ismBlock,
  mvBlock,
  oosBlock,
  orderLists,
  peopleBlock,
  peopleTable,
  problemList,
  regionsBlock,
  treeBlock,
  visitLists,
  visitsBlock,
} from "./sections-xlsx";
import { connectTone, lineBands, lineTone, targetBands, visitedTone, type Tone } from "./tone";
import { LOWER_IS_BETTER, trendTone, type TrendKey } from "./trend";
import { worstLists } from "./worst";
import { Page, type Tile } from "./xlsx-page";
import { addStyledSheet } from "./xlsx-style";

// The level on the screen as Excel (decision of 25.11.2026, see docs/DECISIONS.md): the first
// sheet is the page itself — every block of the level, top to bottom in the page's order, looking
// like the page (xlsx-page.ts) — and after it only the sheets of whole lists, each opened by a
// link from the place where the page shows its first rows (and with a link back). Texts follow
// the language of the current work (see withExportLocale); known data values (answers, statuses,
// questions, equipment) are translated with localizeData.
export async function connectXlsx(report: ConnectReport, today: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = t("app.name");
  // The first tab is named as the level is on the page.
  const page = new Page(book, t(`connect.views.${report.query.view}`), (...sheet) =>
    addStyledSheet(book, ...sheet),
  );
  top(page, report, today);
  if (report.exec) exec(page, report);
  else if (report.manager) manager(page, report);
  else if (report.executor) executor(page, report);
  norms(page, report);
  page.finish();
  return Buffer.from(await book.xlsx.writeBuffer());
}

// The top of the page: what it is, the level and whose data, the period and what it is compared
// with, how fresh the data is; then the links to the blocks.
function top(page: Page, report: ConnectReport, today: string) {
  const view = report.query.view;
  const routes = report.exec?.routes ?? report.manager?.routes ?? report.executor?.routes ?? null;
  const day = (date: string) => periodLabel({ from: date, to: date }, today);
  const period = periodLabel(report.period, today);
  const one = report.executor;
  const fresh = [
    report.dataDate && t("connect.dataDate", { date: day(report.dataDate) }),
    routes?.dataDate && t("connect.routes.dataDate", { date: day(routes.dataDate) }),
    report.salesDate && t("connect.oos.salesDate", { date: day(report.salesDate) }),
  ].filter(Boolean);
  page.title(`${t("connect.title")} — ${t(`connect.views.${view}`)}: ${period}`);
  page.facts([
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
    [
      t("connect.cover.compared"),
      t("connect.cover.comparedValue", {
        dates: periodLabel(previousPeriod(report.period), today),
      }),
    ],
    ...(fresh.length ? [[t("connect.cover.fresh"), fresh.join("; ")] as [string, string]] : []),
    [t("connect.cover.made"), day(today)],
    [t("connect.cover.note"), t("connect.testNote")],
  ]);
  page.chips();
}

const months = (report: ConnectReport) => monthsLabel(report.months);

// Leadership: the key shares as tiles, who needs attention, the worst results, the regions, then
// the sections — the whole picture.
function exec(page: Page, report: ConnectReport) {
  const data = report.exec!;
  const insights = report.insights;
  const { visits: v, oos: o, mv: m } = data.sections;
  const rules = insights?.rules ?? DEFAULT_RULES;
  const changes = insights?.trend?.changes;
  const previous = insights?.trend?.previous;
  const recovery = insights?.recovery.totals;
  // «▲ 2 п.п.» next to a share: green when it got better (for some shares lower is better).
  const trend = (key: TrendKey): Tile["trend"] => {
    const change = changes?.[key];
    if (!change) return null;
    const tone = trendTone(change.delta, LOWER_IS_BETTER[key]);
    return {
      delta: change.delta,
      tone: tone === "better" ? "good" : tone === "worse" ? "bad" : null,
      unit: t("connect.trend.pp"),
    };
  };
  page.gap();
  page.tiles(
    [
      {
        label: t("connect.tile.planDone"),
        value: v.visitedRate,
        format: "percent",
        meter: v.visitedRate,
        tone: visitedTone(v, rules),
        trend: trend("planDone"),
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(v.visited),
          planned: formatNumber(v.planned),
        }),
      },
      {
        label: t("connect.tile.connectUsed"),
        value: v.connectRate,
        format: "percent",
        meter: v.connectRate,
        tone: connectTone(v, rules),
        trend: trend("connectUsed"),
        note: t("connect.tile.connectUsedNote", { rate: v.allGoodRate }),
      },
      {
        label: t("connect.tile.mvFull"),
        value: m.fullRate,
        format: "percent",
        meter: m.fullRate,
        trend: trend("mvFull"),
        note: t("connect.tile.mvFullNote", { count: formatNumber(m.unique) }),
      },
      {
        label: t("connect.tile.oosStores"),
        value: o.withGap,
        // The change is of the share in the note; fewer stores with an OOS is better.
        trend: trend("oosStores"),
        note: t("connect.tile.oosStoresNote", {
          rate: o.gapRate,
          checked: formatNumber(o.checked),
        }),
      },
      ...(recovery && recovery.stores > 0
        ? [
            {
              label: t("connect.recovery.tile"),
              value: recovery.rate,
              format: "percent" as const,
              meter: recovery.rate,
              tone: lineTone(recovery.rate, rules.recovery),
              trend: trend("recovery"),
              note: t("connect.recovery.tileNote", {
                restored: formatNumber(recovery.restored),
                total: formatNumber(recovery.wasOut),
              }),
            },
          ]
        : []),
      {
        label: t("connect.tile.orders"),
        value: o.orders,
        note: t("connect.packs", { count: formatNumber(o.packs) }),
      },
      { label: t("connect.tile.ordersSum"), value: o.sum, format: "money" },
    ],
    // As the page's grid on a wide screen: four in a row with the recovery tile, six without.
    recovery?.stores ? 4 : 6,
  );
  if (previous && changes && Object.values(changes).some(Boolean))
    page.text(
      t("connect.trend.caption", {
        dates: `${formatDay(previous.from)} – ${formatDay(previous.to)}`,
      }),
      "small",
    );

  attentionBlock(page, insights);
  worstBlock(page, worstLists({ routes: data.routes, insights, regions: data.regions }));
  regionsBlock(page, data.regions, rules);
  routeBlocks(page, data.routes);
  visitsBlock(page, v);
  oosBlock(page, o, () => {
    if (insights && o.checked > 0) recoveryBlock(page, insights.recovery, false);
    if (insights?.followUp) followUpBlock(page, insights.followUp);
  });
  if (insights && o.checked > 0) oosPathBlock(page, insights.oosPath, "exec");
  mvBlock(page, m);
  ismBlock(page, { level: "exec", months: months(report), block: data.ism });
}

// Managers: who needs attention and the worst results, the positions as a tree with the numbers
// of the TSMs under each (or, without the employee info, one row per TSM), then the sections for
// those TSMs.
function manager(page: Page, report: ConnectReport) {
  const data = report.manager!;
  const insights = report.insights;
  const sales = report.salesDate !== null;
  const o = data.sections.oos;
  attentionBlock(page, insights);
  worstBlock(page, worstLists({ routes: data.routes, insights, people: data.people }));
  const people = peopleTable(data.people, sales);
  if (data.tree) {
    treeBlock(page, data.tree, sales, people);
    if (data.tree.outside.length > 0)
      peopleBlock(
        page,
        data.tree.outside,
        people,
        t("connect.manager.outside"),
        t("connect.manager.outsideHint"),
      );
  } else
    peopleBlock(
      page,
      data.people,
      people,
      t("connect.manager.people"),
      t("connect.manager.peopleHint"),
    );
  routeBlocks(page, data.routes);
  visitsBlock(page, data.sections.visits);
  oosBlock(page, o, () => {
    if (insights && o.checked > 0) recoveryBlock(page, insights.recovery, false);
    if (insights?.followUp) followUpBlock(page, insights.followUp);
  });
  if (insights && o.checked > 0) oosPathBlock(page, insights.oosPath, "manager");
  mvBlock(page, data.sections.mv);
  ismBlock(page, { level: "manager", months: months(report), block: data.ism });
}

// One TSM (or one rep's zone): the numbers, then each section with the lists to act on.
function executor(page: Page, report: ConnectReport) {
  const data = report.executor!;
  const insights = report.insights;
  const { row: r, sections: s, detail: d } = data;
  // A distributor's rep has a route and nothing in Connect Bot: the route is all there is.
  const zone = data.routes?.zone;
  if (
    zone?.kind === "DR" &&
    !(r.planned || r.unplanned || r.mvUnique || r.oosChecked || r.orders || data.payments.length)
  ) {
    page.person(zone.zone, zone.person, zone.organization);
    routeBlocks(page, data.routes);
    // The checks at the rep's stores that found a product out: what became of each.
    if (insights && insights.oosPath.totals.checks > 0)
      oosPathBlock(page, insights.oosPath, "executor");
    return;
  }
  page.person(r.code, r.name, [r.region, r.zone].filter(Boolean).join(" · ") || null);
  page.gap();
  page.tiles(
    [
      {
        label: t("connect.tile.planDone"),
        value: r.visitedRate,
        format: "percent",
        meter: r.visitedRate,
        note: t("connect.tile.planDoneNote", {
          visited: formatNumber(r.visited),
          planned: formatNumber(r.planned),
        }),
      },
      {
        label: t("connect.tile.connectUsed"),
        value: r.connectRate,
        format: "percent",
        meter: r.connectRate,
        note: t("connect.tile.connectUsedNote", { rate: s.visits.allGoodRate }),
      },
      {
        label: t("connect.col.attention"),
        value: r.attention,
        tone: r.attention ? "warn" : "good",
      },
      {
        label: t("connect.tile.mvFull"),
        value: r.mvFullRate,
        format: "percent",
        meter: r.mvFullRate,
        note: t("connect.tile.mvFullNote", { count: formatNumber(r.mvUnique) }),
      },
      {
        label: t("connect.tile.oosStores"),
        value: r.oosFound,
        note: t("connect.tile.oosStoresNote", {
          rate: s.oos.gapRate,
          checked: formatNumber(r.oosChecked),
        }),
      },
      {
        label: t("connect.tile.orders"),
        value: r.orders,
        note: `${t("connect.packs", { count: formatNumber(r.packs) })} · ${formatMoney(r.sum)}`,
      },
    ],
    6,
  );
  routeBlocks(page, data.routes);
  visitsBlock(page, s.visits, () => visitLists(page, d));
  oosBlock(page, s.oos, () => {
    orderLists(page, d, report.salesDate !== null);
    if (insights && s.oos.checked > 0) recoveryBlock(page, insights.recovery, true);
  });
  if (insights && insights.oosPath.totals.checks > 0)
    oosPathBlock(page, insights.oosPath, "executor");
  mvBlock(page, s.mv, () => problemList(page, d));
  ismBlock(page, { level: "executor", months: months(report), issues: data.payments });
}

// «Нормы и цвета» at the bottom of the page: the owner's norms in force with what each colour
// means, and what is coloured without a norm of the owner's — only what this file has.
function norms(page: Page, report: ConnectReport) {
  const rules = report.insights?.rules ?? DEFAULT_RULES;
  const routes = report.exec?.routes ?? report.manager?.routes ?? report.executor?.routes ?? null;
  const share = (value: number) => `${decimal(value, 2)}%`;
  const bands = (
    key: "attendance" | "hitRate" | "connect" | "recovery" | "visited",
    at: { warn: number; good: number } | null,
  ) => {
    const off = t("connect.cover.band.off");
    const text: Record<Tone, string> = at
      ? {
          good: t("connect.cover.band.from", { value: share(at.good) }),
          warn: t("connect.cover.band.between", { from: share(at.warn), to: share(at.good) }),
          bad: t("connect.cover.band.below", { value: share(at.warn) }),
        }
      : { good: off, warn: off, bad: off };
    return { label: t(`connect.rules.field.${key}`), value: share(rules[key]), ...text };
  };
  const R = attentionRules(rules);
  const attention = t("connect.attention.hint", {
    connect: R.connect.below,
    recovery: R.recovery.below,
    followUp: R.followUp.below,
    unsold: R.unsold.from,
  });
  const title = t("connect.cover.norms");
  page.section(title, { hint: t("connect.cover.normsHint"), own: true });
  page.norms({
    head: [
      t("connect.cover.norm"),
      t("connect.col.value"),
      t("connect.cover.green"),
      t("connect.cover.amber"),
      t("connect.cover.red"),
    ],
    rows: [
      bands("attendance", targetBands(rules.attendance)),
      bands("hitRate", targetBands(rules.hitRate)),
      bands("visited", lineBands(rules.visited)),
      bands("connect", lineBands(rules.connect)),
      bands("recovery", lineBands(rules.recovery)),
    ],
    more: {
      title: t("connect.cover.more"),
      rows: [
        ...(routes
          ? [[t("connect.routes.title"), t("connect.cover.rule.routes")] as [string, string]]
          : []),
        ...(routes?.sales
          ? [[t("connect.zoneSales.title"), t("connect.cover.rule.change")] as [string, string]]
          : []),
        ...(routes?.sales?.idle.length
          ? [[t("connect.zoneSales.idle.title"), t("connect.cover.rule.idle")] as [string, string]]
          : []),
        ...(report.insights?.oosPath.totals.checks
          ? [[t("connect.oosPath.title"), t("connect.cover.rule.path")] as [string, string]]
          : []),
        ...(report.insights?.attention
          ? [
              [
                t("connect.attention.title"),
                report.insights.attendance
                  ? `${attention} ${t("connect.attention.hintAttendance", { attendance: R.attendance.below })}`
                  : attention,
              ] as [string, string],
            ]
          : []),
        [t("connect.cover.rule.rowTitle"), t("connect.cover.rule.row")],
        [t("connect.cover.rule.statusTitle"), t("connect.cover.rule.status")],
        [t("connect.cover.rule.listsTitle"), t("connect.cover.rule.lists")],
      ],
    },
  });
}
