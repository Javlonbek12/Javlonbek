import { formatDay, fromDateString } from "@/lib/dates";
import { formatNumber as decimal } from "@/lib/format";
import { dateFormat, t } from "@/lib/i18n";
import type { ru } from "@/lib/i18n/ru";
import { formatRange } from "@/modules/reports/format";

import { calendarCell, calendarDays, calendarTotal, type CalendarMode } from "./calendar";
import { localizeData } from "./localize";
import { formatMoney, formatNumber } from "./report";
import {
  MATRIX_CLASSES,
  type MissedStore,
  type NoOrderStore,
  type RouteAnalysis,
  type RouteOrganization,
  type RouteSummary,
  type RouteTotals,
  type RouteZone,
} from "./routes";
import type { RoutesBlock } from "./routes-report";
import { SHOWN } from "./shown";
import { changeTone, classTone, deltaTone, idleTone, targetTone, zoneTone } from "./tone";
import { TONE_BAR, type Page, type Stat, type TableColumn, type TableDef } from "./xlsx-page";
import type { CellFormat } from "./xlsx-style";
import { idleSummary, type IdleStore, type ZoneSales, type ZoneSalesRow } from "./zone-sales";

type ColKey = keyof typeof ru.connect.routes.col;
type Level = RoutesBlock["level"];

const about = (key: keyof typeof ru.connect.cover.about) => t(`connect.cover.about.${key}`);
const percent = (value: number | null) => (value === null ? "—" : `${decimal(value)}%`);
// «▲ 1,4 п.п.» / «▼ 2 п.п.»: the change against the previous period, inside a note.
const deltaText = (value: number) =>
  `${value > 0 ? "▲" : value < 0 ? "▼" : ""} ${decimal(Math.abs(value))} ${t("connect.routes.pp")}`.trim();

// «Маршруты и дисциплина» in the Excel download, as the page shows it on the level: the totals,
// the days, the calendars zone × day, the reps' matrix, the zones and the stores to act on, then
// «Продажи по зонам». All of it is Smart Up's data; the shares are coloured against the owner's
// targets by the page's rules. The lists the page cuts (and the leadership's page leaves out)
// are sheets of their own.
export function routeBlocks(page: Page, block: RoutesBlock | null | undefined) {
  if (!block) return;
  const a = block.analysis;
  const { targets } = a;
  const level = block.level;
  const previous = formatRange(a.previous.from, a.previous.to, a.to);
  const dataDate = block.dataDate
    ? t("connect.routes.dataDate", { date: formatDay(block.dataDate) })
    : null;
  // The Smart Up visits of these days come from the route analysis.
  const visitNote = block.visitDays.length
    ? t("connect.routes.visitsFromRoutes", {
        days:
          block.visitDays.length === 1
            ? formatDay(block.visitDays[0]!)
            : formatRange(block.visitDays[0]!, block.visitDays.at(-1)!, a.to),
      })
    : null;
  const dr = block.zone ? block.zone.kind === "DR" : block.staff !== "TSM" && a.totals.DR.zones > 0;
  const missed = missedTable(a.missed, level !== "executor");
  const noOrder = noOrderTable(a.noOrder, level !== "executor");

  if (level === "executor") {
    const zone = block.zone;
    if (!zone) return;
    page.section(t("connect.routes.executor.title", { zone: zone.zone }), {
      sources: ["smartup"],
      hint: t("connect.routes.executor.hint", { previous }),
    });
    if (dataDate) page.text(dataDate, "small");
    if (visitNote) page.text(visitNote, "small");
    page.stats(totals(zone, { dr, targets }));
    // The zone's own days: a rep's by hit rate, a TSM's by attendance.
    calendar(page, a, dr ? "hitRate" : "attendance", [zone]);
    stores(page, missed, "missed", SHOWN.missed);
    if (dr) stores(page, noOrder, "noOrder", SHOWN.noOrder);
    zoneSalesBlock(page, block.sales, level, a, previous);
    return;
  }

  const total = a.totals[block.staff];
  const zones = zonesTable(a, dr, level === "manager" ? "zones" : "ranking");
  page.section(t("connect.routes.title"), {
    sources: ["smartup"],
    hint: t("connect.routes.hint"),
  });
  // The page's switch, as what is chosen.
  page.text(
    [`${t("connect.routes.staffLabel")}: ${t(`connect.routes.staff.${block.staff}`)}`, dataDate]
      .filter(Boolean)
      .join(" · "),
    "small",
  );
  if (visitNote) page.text(visitNote, "small");
  if (total.clients === 0) {
    page.text(t("connect.routes.none"), "muted");
  } else {
    page.stats(totals(total, { zones: total.zones, dr, drClients: a.totals.DR.clients, targets }));
    if (level === "exec") {
      // The leadership's page has no table of zones or stores: the whole lists are here.
      page.list(zones, t("connect.routes.zones.title"));
      page.list(missed, t("connect.routes.missed.title"));
      if (dr) page.list(noOrder, t("connect.routes.noOrder.title"));
    }
    if (level === "exec" && a.days.length > 0) {
      // Under each other, not side by side as on the page: the two tables' rows are of
      // different heights, and next to each other each would stretch the other's.
      page.sub(t("connect.routes.byDay"));
      page.days(
        a.days.map((d) => ({
          label: formatDay(d.day),
          values: dr ? [d.planned, d.visited, d.orders] : [d.planned, d.visited],
        })),
        [
          { label: t("connect.routes.legend.planned"), color: "#c9c7bf" },
          { label: t("connect.routes.legend.visited"), color: "#2a78d6" },
          ...(dr ? [{ label: t("connect.routes.legend.orders"), color: "#1f9d55" }] : []),
        ],
      );
      page.sub(t("connect.routes.byWeekday"), {
        hint: t(dr ? "connect.routes.byWeekdayHint" : "connect.routes.byWeekdayHintTsm"),
      });
      page.table(weekdayTable(a.weekdays, dr));
    }
  }

  // The zones × days grids, the worst zones first: the TSMs by attendance, the reps by hit rate.
  if (total.clients > 0) {
    const rows = level === "exec" ? SHOWN.calendar.exec : SHOWN.calendar.manager;
    const drByHitRate = a.zones
      .filter((z) => z.kind === "DR" && z.hitRate !== null)
      .sort((x, y) => x.hitRate! - y.hitRate! || y.visits - x.visits);
    if (a.ranking.length > 0) {
      page.section(t("connect.calendar.attendanceTitle"), {
        sources: ["smartup"],
        hint: t("connect.calendar.attendanceHint"),
        nav: false,
      });
      calendar(page, a, "attendance", a.ranking, rows, zones);
    }
    if (drByHitRate.length > 0) {
      page.section(t("connect.calendar.hitRateTitle"), {
        sources: ["smartup"],
        hint: t("connect.calendar.hitRateHint"),
        nav: false,
      });
      calendar(page, a, "hitRate", drByHitRate, rows, zones);
    }
  }

  if (level === "exec" && dr && a.matrix) {
    page.section(t("connect.routes.matrix.title"), {
      sources: ["smartup"],
      nav: false,
      hint: t("connect.routes.matrix.hint", {
        attendance: targets.attendance,
        hitRate: targets.hitRate,
      }),
    });
    page.legend(
      MATRIX_CLASSES.map((c) => ({
        color: TONE_BAR[classTone(c)],
        text: `${t(`connect.routes.class.${c}`)}: ${a.matrix!.classes[c]}`,
      })),
      10,
    );
    matrix(page, a, zones);
    page.gap();
    const reps = a.organizations.filter((o) => o.kind === "DR");
    page.table(
      { ...organizationsTable(a, "matrix", dr), full: undefined },
      { rows: reps, limit: SHOWN.matrixOrganizations, more: "" },
    );
    if (reps.length > SHOWN.matrixOrganizations) page.list(organizationsTable(a, "all", dr));
  }

  if (level === "exec" && a.ranking.length > 0) {
    page.section(t("connect.routes.ranking.title"), {
      sources: ["smartup"],
      nav: false,
      hint: t("connect.routes.ranking.hint"),
    });
    page.table({ ...zones, full: undefined }, { rows: a.ranking, limit: SHOWN.ranking, more: "" });
    page.list(zones);
  }

  if (level === "exec" && a.organizations.length > 0) {
    page.section(t("connect.routes.organizations.title"), {
      sources: ["smartup"],
      nav: false,
      hint: t("connect.routes.changeHint", { previous }),
    });
    page.table(organizationsTable(a, "all", dr), { limit: SHOWN.organizations });
  }

  if (level === "manager" && total.clients > 0) {
    page.section(t("connect.routes.zones.title"), {
      sources: ["smartup"],
      nav: false,
      hint: t("connect.routes.changeHint", { previous }),
    });
    page.table(zones, { limit: SHOWN.zones });
    page.section(t("connect.routes.missed.title"), {
      sources: ["smartup"],
      nav: false,
      hint: t("connect.routes.missed.hint"),
    });
    if (a.missed.length) page.table(missed, { limit: SHOWN.missed });
    else page.text(t("connect.routes.missed.none"));
    if (dr) {
      page.section(t("connect.routes.noOrder.title"), {
        sources: ["smartup"],
        nav: false,
        hint: t("connect.routes.noOrder.hint"),
      });
      if (a.noOrder.length) page.table(noOrder, { limit: SHOWN.noOrder });
      else page.text(t("connect.routes.noOrder.none"));
    }
  }
  zoneSalesBlock(page, block.sales, level, a, previous);
}

// The numbers of a list of zones (a level's total, or one zone).
function totals(
  total: RouteSummary &
    Pick<RouteTotals, "clients" | "neverVisited" | "noOrder" | "attendanceDelta" | "hitRateDelta">,
  options: { zones?: number; dr: boolean; drClients?: number; targets: RouteAnalysis["targets"] },
): Stat[] {
  const { targets } = options;
  const change = (value: number | null) => (value === null ? "" : ` · ${deltaText(value)}`);
  return [
    {
      label: t("connect.routes.tile.planned"),
      value: total.planned,
      note:
        options.zones === undefined
          ? t("connect.routes.tile.clientsNote", { clients: formatNumber(total.clients) })
          : t("connect.routes.tile.plannedNote", {
              zones: formatNumber(options.zones),
              clients: formatNumber(total.clients),
            }),
    },
    {
      label: t("connect.routes.tile.attendance"),
      value: total.attendance,
      format: "percent",
      note:
        t("connect.routes.tile.attendanceNote", {
          visited: formatNumber(total.visited),
          planned: formatNumber(total.planned),
        }) + change(total.attendanceDelta),
      tone: targetTone(total.attendance, targets.attendance),
    },
    {
      label: t("connect.routes.tile.missed"),
      value: total.missed,
      note: t("connect.routes.tile.missedNote", { count: formatNumber(total.neverVisited) }),
      tone: total.missed ? "warn" : null,
    },
    {
      label: t("connect.routes.tile.unplanned"),
      value: total.unplanned,
      note: total.upcoming
        ? t("connect.routes.tile.upcomingNote", { count: formatNumber(total.upcoming) })
        : null,
    },
    ...(options.dr
      ? [
          {
            label: t("connect.routes.tile.hitRate"),
            value: total.hitRate,
            format: "percent" as const,
            note:
              t("connect.routes.tile.hitRateNote", { target: targets.hitRate }) +
              change(total.hitRateDelta),
            tone: targetTone(total.hitRate, targets.hitRate),
          },
          {
            label: t("connect.routes.tile.noOrder"),
            value: total.noOrder,
            note: t("connect.routes.tile.noOrderNote", {
              clients: formatNumber(options.drClients ?? total.clients),
            }),
            tone: total.noOrder ? ("warn" as const) : null,
          },
        ]
      : []),
  ];
}

const col = (key: ColKey) => t(`connect.routes.col.${key}`);
const share = (key: ColKey) => `${col(key)}, %`;

// The zones: on the sheet every one with every number; on the page the leadership's ranking of
// the TSMs («ranking») or a manager's table of zones.
function zonesTable(a: RouteAnalysis, dr: boolean, view: "ranking" | "zones"): TableDef<RouteZone> {
  const { targets } = a;
  const all = view === "zones";
  const reps = all && dr;
  // «▲ 1.4 п.п.» against the period before: up in green, down in red, under the share's header.
  const delta = (
    key: "attendanceDelta" | "hitRateDelta",
    shown: boolean,
  ): TableColumn<RouteZone> => ({
    header: col(key),
    width: 14,
    format: "change",
    unit: t("connect.routes.pp"),
    value: (z) => (key === "hitRateDelta" && z.kind !== "DR" ? null : (z[key] as number | null)),
    tone: (z) => deltaTone(z[key]),
    paint: "text",
    page: shown ? { w: 3, join: true, blank: true } : undefined,
  });
  // Only the distributor's reps take orders (and have a hit rate and a class of the matrix).
  const rep = (z: RouteZone, value: number | null) => (z.kind === "DR" ? value : null);
  return {
    rows: a.zones,
    rowTone: (z) => zoneTone(z, targets),
    full: {
      name: t("connect.routes.sheets.zones"),
      source: "smartup",
      about: about("routes"),
      always: true,
    },
    columns: [
      {
        header: col("zone"),
        width: 26,
        value: (z) => z.zone,
        page: { w: 8, flex: true, sub: (z) => z.person },
      },
      { header: col("kind"), width: 8, value: (z) => z.kind, page: all ? { w: 2 } : undefined },
      { header: col("person"), width: 30, value: (z) => z.person },
      {
        header: col("manager"),
        width: 40,
        value: (z) => [z.manager, z.managerPerson].filter(Boolean).join(" · ") || null,
        page: all ? { w: 6, value: (z) => z.manager, sub: (z) => z.managerPerson } : undefined,
      },
      {
        header: col("organization"),
        width: 18,
        value: (z) => z.organization,
        page: { w: all ? 5 : 8 },
      },
      {
        header: col("clients"),
        width: 8,
        format: "count",
        value: (z) => z.clients,
        page: all ? { w: 2 } : undefined,
      },
      {
        header: col("planned"),
        width: 8,
        format: "count",
        value: (z) => z.planned,
        page: { w: all ? 2 : 4 },
      },
      { header: col("visited"), width: 10, format: "count", value: (z) => z.visited },
      {
        header: share("attendance"),
        width: 12,
        format: "percent",
        value: (z) => z.attendance,
        tone: (z) => targetTone(z.attendance, targets.attendance),
        page: { w: 3, header: col("attendance") },
      },
      delta("attendanceDelta", true),
      {
        header: col("missed"),
        width: 10,
        format: "count",
        value: (z) => z.missed,
        page: { w: all ? 3 : 5 },
      },
      {
        header: col("neverVisited"),
        width: 12,
        format: "count",
        value: (z) => z.neverVisited,
        page: all ? undefined : { w: 6 },
      },
      {
        header: col("unplanned"),
        width: 10,
        format: "count",
        value: (z) => z.unplanned,
        page: all ? { w: 3 } : undefined,
      },
      { header: col("upcoming"), width: 10, format: "count", value: (z) => z.upcoming },
      { header: col("visits"), width: 10, format: "count", value: (z) => z.visits },
      { header: col("orders"), width: 10, format: "count", value: (z) => rep(z, z.orders) },
      {
        header: share("hitRate"),
        width: 12,
        format: "percent",
        value: (z) => rep(z, z.hitRate),
        tone: (z) => (z.kind === "DR" ? targetTone(z.hitRate, targets.hitRate) : null),
        page: reps ? { w: 3, header: col("hitRate") } : undefined,
      },
      delta("hitRateDelta", reps),
      {
        header: col("noOrder"),
        width: 12,
        format: "count",
        value: (z) => rep(z, z.noOrder),
        page: reps ? { w: 3 } : undefined,
      },
      {
        header: col("class"),
        width: 24,
        value: (z) => (z.class ? t(`connect.routes.class.${z.class}`) : null),
        tone: (z) => (z.class ? classTone(z.class) : null),
        paint: "text",
        page: reps ? { w: 4 } : undefined,
      },
    ],
  };
}

const store = <T extends { store: string; storeCode: string }>(
  width: number,
): TableColumn<T>["page"] => ({ w: width, flex: true, at: 0, sub: (s) => s.storeCode });
const zoneOf = <T extends { zone: string; person: string | null }>(
  shown: boolean,
): TableColumn<T>["page"] => (shown ? { w: 9, at: 1, sub: (s) => s.person } : undefined);
const text = (
  header: string,
  width: number,
  format: CellFormat = "text",
): { header: string; width: number; format: CellFormat } => ({ header, width, format });

// Stores whose planned visits were not made twice or more in a row by the end of the period.
function missedTable(rows: MissedStore[], zones: boolean): TableDef<MissedStore> {
  return {
    rows,
    full: {
      name: t("connect.routes.sheets.missed"),
      source: "smartup",
      about: about("missed"),
      always: true,
    },
    columns: [
      { ...text(col("zone"), 26), value: (s) => s.zone, page: zoneOf(zones) },
      { ...text(col("kind"), 8), value: (s) => s.kind },
      { ...text(col("person"), 30), value: (s) => s.person },
      { ...text(col("organization"), 18), value: (s) => s.organization },
      { ...text(col("storeCode"), 12), value: (s) => s.storeCode },
      { ...text(col("store"), 40), value: (s) => s.store, page: store(12) },
      {
        ...text(col("misses"), 10, "count"),
        value: (s) => s.misses,
        page: { w: 4, bold: true },
      },
      {
        ...text(col("missedDays"), 40),
        value: (s) => s.days.join(", "),
        page: { w: 9, value: (s) => s.days.map((day) => formatDay(day)).join(", ") },
      },
      {
        ...text(col("lastVisit"), 14, "date"),
        value: (s) => s.lastVisit,
        page: {
          w: 5,
          value: (s) => (s.lastVisit ? formatDay(s.lastVisit) : t("connect.routes.noVisit")),
        },
      },
      { ...text(col("grade"), 8), value: (s) => s.grade, page: { w: 3 } },
      {
        ...text(col("equipment"), 30),
        value: (s) => localizeData(s.equipment),
        page: { w: 7 },
      },
    ],
  };
}

// A DR's stores visited three times or more in the period without a single order.
function noOrderTable(rows: NoOrderStore[], zones: boolean): TableDef<NoOrderStore> {
  return {
    rows,
    full: {
      name: t("connect.routes.sheets.noOrder"),
      source: "smartup",
      about: about("noOrder"),
      always: true,
    },
    columns: [
      { ...text(col("zone"), 26), value: (s) => s.zone, page: zoneOf(zones) },
      { ...text(col("person"), 30), value: (s) => s.person },
      { ...text(col("organization"), 18), value: (s) => s.organization },
      { ...text(col("storeCode"), 12), value: (s) => s.storeCode },
      { ...text(col("store"), 40), value: (s) => s.store, page: store(16) },
      {
        ...text(col("visits"), 10, "count"),
        value: (s) => s.visits,
        page: { w: 4, bold: true },
      },
      {
        ...text(col("lastVisit"), 14, "date"),
        value: (s) => s.lastVisit,
        page: { w: 6, value: (s) => (s.lastVisit ? formatDay(s.lastVisit) : null) },
      },
      { ...text(col("grade"), 8), value: (s) => s.grade, page: { w: 4 } },
      { ...text(col("equipment"), 30), value: (s) => localizeData(s.equipment) },
    ],
  };
}

// An executor's own list of stores: its heading with the count, the hint, the first of them.
function stores<T>(page: Page, table: TableDef<T>, key: "missed" | "noOrder", limit: number) {
  page.sub(`${t(`connect.routes.${key}.title`)} · ${table.rows.length}`, {
    hint: table.rows.length ? t(`connect.routes.${key}.hint`) : null,
  });
  if (table.rows.length) page.table(table, { limit });
  else page.text(t(`connect.routes.${key}.none`));
}

// The organizations (distributors): next to the matrix the reps' ones with their class, further
// down all of them with the change against the period before. One list for both; it is a sheet
// when the page cuts it.
function organizationsTable(
  a: RouteAnalysis,
  view: "matrix" | "all",
  dr: boolean,
): TableDef<RouteOrganization> {
  const { targets } = a;
  const all = view === "all";
  const count = (
    key: ColKey,
    value: (o: RouteOrganization) => number,
    shown: boolean,
  ): TableColumn<RouteOrganization> => ({
    ...text(col(key), 10, "count"),
    value,
    page: shown ? { w: 4 } : undefined,
  });
  const delta = (
    key: "attendanceDelta" | "hitRateDelta",
    shown: boolean,
  ): TableColumn<RouteOrganization> => ({
    ...text(col(key), 14, "change"),
    unit: t("connect.routes.pp"),
    value: (o) => (key === "hitRateDelta" && o.kind !== "DR" ? null : o[key]),
    tone: (o) => deltaTone(o[key]),
    paint: "text",
    page: shown ? { w: 4, join: true, blank: true } : undefined,
  });
  // Next to the matrix the shares are plain numbers: the class says how they stand.
  const plain = () => null;
  return {
    rows: a.organizations,
    full: {
      name: t("connect.routes.organizations.title"),
      source: "smartup",
      about: about("organizations"),
    },
    columns: [
      {
        ...text(col("organization"), 26),
        value: (o) => o.organization,
        page: { w: 10, flex: true },
      },
      { ...text(col("kind"), 8), value: (o) => o.kind, page: all ? { w: 3 } : undefined },
      count("zones", (o) => o.zones, true),
      count("clients", (o) => o.clients, all),
      count("planned", (o) => o.planned, all),
      {
        ...text(share("attendance"), 12, "percent"),
        value: (o) => o.attendance,
        tone: (o) => targetTone(o.attendance, targets.attendance),
        page: all
          ? { w: 4, header: col("attendance") }
          : { w: 5, header: col("attendance"), tone: plain },
      },
      delta("attendanceDelta", all),
      count("missed", (o) => o.missed, all),
      count("unplanned", (o) => o.unplanned, all),
      // Only the distributor's reps take orders.
      {
        ...text(share("hitRate"), 12, "percent"),
        value: (o) => (o.kind === "DR" ? o.hitRate : null),
        tone: (o) => (o.kind === "DR" ? targetTone(o.hitRate, targets.hitRate) : null),
        page: all
          ? dr
            ? { w: 4, header: col("hitRate") }
            : undefined
          : { w: 5, header: col("hitRate"), tone: plain },
      },
      delta("hitRateDelta", all && dr),
      {
        ...text(col("class"), 24),
        value: (o) => (o.class ? t(`connect.routes.class.${o.class}`) : null),
        tone: (o) => (o.class ? classTone(o.class) : null),
        paint: "text",
        page: all ? undefined : { w: 10 },
      },
    ],
  };
}

// Weekdays down, the period's weeks across: a Monday next to the Mondays before it.
function weekdayTable(
  table: RouteAnalysis["weekdays"],
  hitRate: boolean,
): TableDef<RouteAnalysis["weekdays"]["rows"][number]> {
  const weekday = dateFormat({ weekday: "long", timeZone: "UTC" });
  // 5 January 2026 is a Monday.
  const name = (day: number) => {
    const text = weekday.format(fromDateString(`2026-01-${String(4 + day).padStart(2, "0")}`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  return {
    rows: table.rows,
    columns: [
      { header: col("weekday"), value: (r) => name(r.weekday), page: { w: 8 } },
      ...table.weeks.map((week, i): TableColumn<RouteAnalysis["weekdays"]["rows"][number]> => ({
        header: t("connect.routes.week", { n: i + 1 }),
        value: (r) => {
          const cell = r.cells[i];
          if (!cell) return null;
          return `${percent(cell.attendance)}${
            hitRate && cell.hitRate !== null ? ` · ${percent(cell.hitRate)}` : ""
          }`;
        },
        page: {
          w: 4,
          flex: true,
          right: true,
          bold: true,
          sub: (r) => (r.cells[i] ? formatDay(r.cells[i]!.day) : null),
        },
      })),
    ],
  };
}

// A calendar of the zones given (the worst first), cut at `limit`; the rest are on the zones'
// sheet.
function calendar(
  page: Page,
  a: RouteAnalysis,
  mode: CalendarMode,
  zones: RouteZone[],
  limit?: number,
  list?: TableDef<RouteZone>,
) {
  const target = mode === "attendance" ? a.targets.attendance : a.targets.hitRate;
  const rows = zones.slice(0, limit ?? zones.length);
  const days = calendarDays(a, rows);
  if (!rows.length || !days.length) return;
  const weekday = dateFormat({ weekday: "short", timeZone: "UTC" });
  page.calendar({
    head: col("zone"),
    total: t(`connect.calendar.total.${mode}`),
    days: days.map((day) => {
      const date = fromDateString(day);
      return {
        top: weekday.format(date),
        bottom: String(date.getUTCDate()),
        weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      };
    }),
    rows: rows.map((z) => {
      const total = calendarTotal(z, mode);
      return {
        label: z.zone,
        sub: z.person,
        cells: days.map((day) => {
          const cell = calendarCell(a.calendar[z.zone]?.[day], mode, target);
          return cell && { text: cell.text, tone: cell.tone };
        }),
        share: total.share,
        tone: targetTone(total.share, target),
        of: `${formatNumber(total.part)} / ${formatNumber(total.whole)}`,
      };
    }),
    legend: [
      ...(["good", "warn", "bad"] as const).map((tone) => ({
        tone,
        text: t(`connect.calendar.legend.${tone}`, { target }),
      })),
      { tone: null, text: t(`connect.calendar.legend.none.${mode}`) },
    ],
    note: t(`connect.calendar.cell.${mode}`),
  });
  if (list && zones.length > rows.length) page.list(list);
}

// How many zones of a corner of the matrix are named (the rest are on the zones' sheet, where
// the class is a column).
const CORNER_ZONES = 60;

// The reps' «Visit × Hitting» as its four corners (the page draws a point per zone).
function matrix(page: Page, a: RouteAnalysis, zones: TableDef<RouteZone>) {
  const { targets } = a;
  const points = a.zones.filter(
    (z): z is RouteZone & { attendance: number; hitRate: number } =>
      z.class !== null && z.attendance !== null && z.hitRate !== null,
  );
  let cut = false;
  const corner = (lowAttendance: boolean, lowHitRate: boolean) => {
    const inside = points
      .filter(
        (p) =>
          p.attendance < targets.attendance === lowAttendance &&
          p.hitRate < targets.hitRate === lowHitRate,
      )
      // The furthest from the targets first.
      .sort((x, y) => x.hitRate - y.hitRate || x.attendance - y.attendance);
    const more = inside.length - CORNER_ZONES;
    if (more > 0) cut = true;
    const kind = MATRIX_CLASSES[Number(lowAttendance) + Number(lowHitRate)]!;
    return {
      title: t(`connect.routes.class.${kind}`),
      count: inside.length,
      tone: classTone(kind),
      items:
        inside
          .slice(0, CORNER_ZONES)
          .map((p) => p.zone)
          .join(", ") + (more > 0 ? ` ${t("connect.recovery.moreSkus", { count: more })}` : ""),
    };
  };
  const band = (key: "below" | "from", value: number) =>
    t(`connect.cover.band.${key}`, { value: `${decimal(value)}%` });
  page.quadrants({
    columns: [
      `${col("attendance")}: ${band("below", targets.attendance)}`,
      `${col("attendance")}: ${band("from", targets.attendance)}`,
    ],
    rows: [
      `${col("hitRate")}: ${band("from", targets.hitRate)}`,
      `${col("hitRate")}: ${band("below", targets.hitRate)}`,
    ],
    cells: [
      [corner(true, false), corner(false, false)],
      [corner(true, true), corner(false, true)],
    ],
  });
  const average = a.matrix!.average;
  page.text(
    [
      t("connect.routes.matrix.targets", {
        attendance: targets.attendance,
        hitRate: targets.hitRate,
      }),
      t("connect.routes.matrix.averages", {
        attendance: percent(average.attendance),
        hitRate: percent(average.hitRate),
      }),
    ].join(" · "),
    "small",
  );
  if (cut) page.list(zones);
}

// «Продажи по зонам»: what each rep sold (Smart Up's sales report) next to their hit rate, and
// what was sold to each TSM's stores next to their attendance; then the route stores nobody sold
// to. The biggest fall against the period before comes first.
function zoneSalesBlock(
  page: Page,
  sales: ZoneSales | null,
  level: Level,
  a: RouteAnalysis,
  previous: string,
) {
  if (!sales) return;
  const reps = sales.rows.filter((r) => r.kind === "DR");
  const tsms = sales.rows.filter((r) => r.kind === "TSM");
  if (!reps.length && !tsms.length) return;
  const total = sales.total;
  page.section(t("connect.zoneSales.title"), {
    sources: ["smartup"],
    hint: t("connect.zoneSales.hint", { previous }),
  });
  if (sales.legacy) page.callout(t("connect.zoneSales.legacy"), "warn");
  if (level !== "executor")
    page.stats([
      {
        label: t("connect.zoneSales.tile.sum"),
        value: total.sum,
        format: "money",
        note: t("connect.zoneSales.tile.sumNote", { blocks: formatNumber(total.blocks) }),
      },
      {
        label: t("connect.zoneSales.tile.change"),
        value: total.change,
        format: "change",
        tone: changeTone(total.change),
        note:
          total.change === null
            ? t("connect.zoneSales.tile.changeNone")
            : t("connect.zoneSales.tile.changeNote", { before: formatMoney(total.before) }),
      },
      ...(sales.clients > 0
        ? [
            {
              label: t("connect.zoneSales.tile.coverage"),
              value: Math.round((sales.buying / sales.clients) * 1000) / 10,
              format: "percent" as const,
              note: t("connect.zoneSales.tile.coverageNote", {
                buying: formatNumber(sales.buying),
                clients: formatNumber(sales.clients),
                idle: formatNumber(sales.clients - sales.buying),
              }),
            },
          ]
        : []),
      ...(level === "exec" && sales.outside.sum > 0
        ? [
            {
              label: t("connect.zoneSales.tile.outside"),
              value: sales.outside.share,
              format: "percent" as const,
              note: t("connect.zoneSales.tile.outsideNote", {
                sum: formatMoney(sales.outside.sum),
                staff: sales.outside.staff,
              }),
            },
          ]
        : []),
    ]);
  const limit = SHOWN.zoneSales[level];
  let cut = false;
  for (const [kind, rows] of [
    ["DR", reps],
    ["TSM", tsms],
  ] as const) {
    if (!rows.length) continue;
    page.sub(t(`connect.zoneSales.table.${kind}`), {
      hint: t(`connect.zoneSales.tableHint.${kind}`),
    });
    page.table({ ...zoneSalesTable(sales, a, kind), full: undefined }, { rows, limit, more: "" });
    if (rows.length > limit) cut = true;
  }
  // One sheet has the reps and the TSMs; an executor's own zone is all on the page.
  if (level !== "executor" || cut) page.list(zoneSalesTable(sales, a, "DR"));
  if (sales.idle.length > 0) {
    const idle = idleSummary(sales.idle);
    page.sub(`${t("connect.zoneSales.idle.title")} · ${formatNumber(idle.stores)}`, {
      rule: true,
      hint: t("connect.zoneSales.idle.hint"),
    });
    page.text(
      t("connect.zoneSales.idle.summary", {
        orders: formatNumber(idle.orders),
        unvisited: formatNumber(idle.unvisited),
        never: formatNumber(idle.never),
      }),
    );
    page.table(idleTable(sales.idle), { limit: SHOWN.idle });
  }
}

// Every shown zone with its sales; on the page the reps (with their hit rate) and the TSMs (with
// their attendance) are two tables.
function zoneSalesTable(
  sales: ZoneSales,
  a: RouteAnalysis,
  kind: "DR" | "TSM",
): TableDef<ZoneSalesRow> {
  const { targets } = a;
  const head = (key: keyof typeof ru.connect.zoneSales.col) => t(`connect.zoneSales.col.${key}`);
  return {
    rows: sales.rows,
    rowTone: (r) => changeTone(r.change),
    full: {
      name: t("connect.zoneSales.sheet"),
      source: "smartup",
      about: about("zoneSales"),
      always: true,
    },
    columns: [
      {
        ...text(col("zone"), 26),
        value: (r) => r.zone,
        page: { w: 9, flex: true, sub: (r) => r.person },
      },
      { ...text(t("connect.zoneSales.kind"), 8), value: (r) => r.kind },
      { ...text(col("person"), 30), value: (r) => r.person },
      { ...text(col("organization"), 18), value: (r) => r.organization, page: { w: 6 } },
      {
        ...text(head("sum"), 16, "money"),
        value: (r) => Math.round(r.sum),
        page: { w: 6 },
      },
      // «▼ 16.7%»: a fall is amber, a tenth and more red, growth green.
      {
        ...text(`${head("change")}, %`, 14, "change"),
        value: (r) => r.change,
        tone: (r) => changeTone(r.change),
        page: { w: 4, header: head("change") },
      },
      { ...text(head("blocks"), 10, "count"), value: (r) => r.blocks, page: { w: 4 } },
      { ...text(head("days"), 10, "count"), value: (r) => r.days, page: { w: 4 } },
      { ...text(col("clients"), 8, "count"), value: (r) => r.clients },
      { ...text(head("coverage"), 16, "count"), value: (r) => r.buying },
      {
        ...text(`${head("coverage")}, %`, 16, "percent"),
        value: (r) => r.coverage,
        page: { w: 4, header: head("coverage"), bar: (r) => r.coverage },
      },
      // Of how many (the page writes it next to the share, and draws the share as a bar under
      // them).
      {
        header: head("coverage"),
        sheet: false,
        value: (r) =>
          r.coverage === null
            ? null
            : t("connect.worst.of", {
                part: formatNumber(r.buying),
                whole: formatNumber(r.clients),
              }),
        page: { w: 4, join: true, blank: true, muted: () => true },
      },
      {
        ...text(share("hitRate"), 12, "percent"),
        value: (r) => r.hitRate,
        tone: (r) => targetTone(r.hitRate, targets.hitRate),
        page: kind === "DR" ? { w: 4, header: col("hitRate") } : undefined,
      },
      {
        ...text(share("attendance"), 12, "percent"),
        value: (r) => r.attendance,
        tone: (r) => targetTone(r.attendance, targets.attendance),
        page: kind === "TSM" ? { w: 4, header: col("attendance") } : undefined,
      },
    ],
  };
}

// «Точки маршрута без продаж»: the route stores nobody sold to in the period.
function idleTable(rows: IdleStore[]): TableDef<IdleStore> {
  const head = (key: "visits" | "orders" | "lastSale") => t(`connect.zoneSales.idle.${key}`);
  return {
    rows,
    // An order marked on the route and nothing delivered is what to look into (amber, not red:
    // an order of the period's last days may be delivered after it).
    rowTone: idleTone,
    full: {
      name: t("connect.zoneSales.idle.sheet"),
      source: "smartup",
      about: about("idle"),
      always: true,
    },
    columns: [
      { ...text(col("zone"), 26), value: (s) => s.zone, page: zoneOf(true) },
      { ...text(col("person"), 30), value: (s) => s.person },
      { ...text(col("organization"), 18), value: (s) => s.organization, page: { w: 7, at: 2 } },
      { ...text(col("storeCode"), 12), value: (s) => s.storeCode },
      { ...text(col("store"), 40), value: (s) => s.store, page: store(12) },
      { ...text(col("grade"), 8), value: (s) => s.grade, page: { w: 3, at: 3 } },
      { ...text(col("equipment"), 30), value: (s) => localizeData(s.equipment) },
      { ...text(head("visits"), 10, "count"), value: (s) => s.visits, page: { w: 4, at: 4 } },
      {
        ...text(head("orders"), 12, "count"),
        value: (s) => s.orders,
        tone: idleTone,
        page: { w: 4, at: 5 },
      },
      {
        ...text(head("lastSale"), 18, "date"),
        value: (s) => s.lastSale,
        page: {
          w: 6,
          at: 6,
          value: (s) => (s.lastSale ? formatDay(s.lastSale) : t("connect.zoneSales.idle.never")),
          muted: (s) => !s.lastSale,
        },
      },
    ],
  };
}
