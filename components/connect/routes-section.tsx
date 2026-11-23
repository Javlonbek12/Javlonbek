import Link from "next/link";

import { Segmented } from "@/components/ui/segmented";
import { formatDay, fromDateString } from "@/lib/dates";
import { formatNumber as decimal } from "@/lib/format";
import { dateFormat, t } from "@/lib/i18n";
import { connectHref, formatNumber } from "@/modules/connect/report";
import {
  MATRIX_CLASSES,
  ROUTE_TARGETS,
  STAFF_FILTERS,
  type MatrixClass,
  type MissedStore,
  type NoOrderStore,
  type RouteSummary,
  type RouteTotals,
  type RouteZone,
} from "@/modules/connect/routes";
import type { RoutesBlock } from "@/modules/connect/routes-report";
import { formatRange } from "@/modules/reports/format";

import { DataTable, DayBars, Section, StatGrid, type Column } from "./parts";
import { CLASS_COLOR, RoutesMatrix } from "./routes-matrix";
import { TsmName } from "./sections";

// «Маршруты и дисциплина»: Smart Up's route analysis on the three levels. Leadership sees the
// whole picture (totals, days, weekdays, the DRs' matrix, organizations), managers their zones
// with the change against the period before and the stores to act on, an executor their zone.

const percent = (value: number | null) => (value === null ? "—" : `${decimal(value)}%`);

// «▲ 1,4 п.п.» / «▼ 2 п.п.»: the change against the previous period.
const deltaText = (value: number) =>
  `${value > 0 ? "▲" : value < 0 ? "▼" : ""} ${decimal(Math.abs(value))} ${t("connect.routes.pp")}`.trim();

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span
      className={
        value > 0
          ? "text-xs whitespace-nowrap text-emerald-700 dark:text-emerald-400"
          : value < 0
            ? "text-xs whitespace-nowrap text-red-600 dark:text-red-400"
            : "text-muted-foreground text-xs whitespace-nowrap"
      }
    >
      {deltaText(value)}
    </span>
  );
}

const Rate = ({ value, change }: { value: number | null; change: number | null }) => (
  <span className="inline-flex flex-col items-end">
    <span>{percent(value)}</span>
    <Delta value={change} />
  </span>
);

function ClassMark({ value }: { value: MatrixClass | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: CLASS_COLOR[value] }} />
      {t(`connect.routes.class.${value}`)}
    </span>
  );
}

const Store = ({ name, code }: { name: string; code: string }) => (
  <span className="flex flex-col">
    <span>{name}</span>
    <span className="text-muted-foreground text-xs">{code}</span>
  </span>
);

// The numbers of a list of zones (a level's total, or one zone).
function totalsItems(
  total: RouteSummary &
    Pick<RouteTotals, "clients" | "neverVisited" | "noOrder" | "attendanceDelta" | "hitRateDelta">,
  options: { zones?: number; dr: boolean; drClients?: number },
) {
  const change = (value: number | null) => (value === null ? "" : ` · ${deltaText(value)}`);
  return [
    {
      key: "planned",
      label: t("connect.routes.tile.planned"),
      value: formatNumber(total.planned),
      note:
        options.zones === undefined
          ? t("connect.routes.tile.clientsNote", { clients: formatNumber(total.clients) })
          : t("connect.routes.tile.plannedNote", {
              zones: formatNumber(options.zones),
              clients: formatNumber(total.clients),
            }),
    },
    {
      key: "attendance",
      label: t("connect.routes.tile.attendance"),
      value: percent(total.attendance),
      note:
        t("connect.routes.tile.attendanceNote", {
          visited: formatNumber(total.visited),
          planned: formatNumber(total.planned),
        }) + change(total.attendanceDelta),
      tone:
        total.attendance === null
          ? undefined
          : total.attendance >= ROUTE_TARGETS.attendance
            ? ("good" as const)
            : ("warn" as const),
    },
    {
      key: "missed",
      label: t("connect.routes.tile.missed"),
      value: formatNumber(total.missed),
      note: t("connect.routes.tile.missedNote", { count: formatNumber(total.neverVisited) }),
      tone: total.missed ? ("warn" as const) : undefined,
    },
    {
      key: "unplanned",
      label: t("connect.routes.tile.unplanned"),
      value: formatNumber(total.unplanned),
      note: total.upcoming
        ? t("connect.routes.tile.upcomingNote", { count: formatNumber(total.upcoming) })
        : undefined,
    },
    ...(options.dr
      ? [
          {
            key: "hitRate",
            label: t("connect.routes.tile.hitRate"),
            value: percent(total.hitRate),
            note:
              t("connect.routes.tile.hitRateNote", { target: ROUTE_TARGETS.hitRate }) +
              change(total.hitRateDelta),
            tone:
              total.hitRate === null
                ? undefined
                : total.hitRate >= ROUTE_TARGETS.hitRate
                  ? ("good" as const)
                  : ("warn" as const),
          },
          {
            key: "noOrder",
            label: t("connect.routes.tile.noOrder"),
            value: formatNumber(total.noOrder),
            note: t("connect.routes.tile.noOrderNote", {
              clients: formatNumber(options.drClients ?? total.clients),
            }),
            tone: total.noOrder ? ("warn" as const) : undefined,
          },
        ]
      : []),
  ];
}

export function RoutesSection({ block }: { block: RoutesBlock | null | undefined }) {
  if (!block) return null;
  const a = block.analysis;
  const dataDate = block.dataDate && (
    <p className="text-muted-foreground text-xs">
      {t("connect.routes.dataDate", { date: formatDay(block.dataDate) })}
    </p>
  );
  // The Smart Up visits of these days come from the route analysis.
  const visitNote = block.visitDays.length > 0 && (
    <p className="text-muted-foreground text-xs">
      {t("connect.routes.visitsFromRoutes", {
        days:
          block.visitDays.length === 1
            ? formatDay(block.visitDays[0]!)
            : formatRange(block.visitDays[0]!, block.visitDays.at(-1)!, a.to),
      })}
    </p>
  );
  const previous = formatRange(a.previous.from, a.previous.to, a.to);

  if (block.level === "executor") {
    const zone = block.zone;
    if (!zone) return null;
    return (
      <Section
        title={t("connect.routes.executor.title", { zone: zone.zone })}
        hint={t("connect.routes.executor.hint", { previous })}
      >
        {dataDate}
        {visitNote}
        <StatGrid items={totalsItems(zone, { dr: zone.kind === "DR" })} />
        <MissedList rows={a.missed} zones={false} />
        {zone.kind === "DR" && <NoOrderList rows={a.noOrder} zones={false} />}
      </Section>
    );
  }

  const total = a.totals[block.staff];
  const dr = block.staff !== "TSM" && a.totals.DR.zones > 0;
  const zoneHref = (zone: string) =>
    connectHref("/connect", block.query, { view: "executor", person: zone, staff: null });
  return (
    <>
      <Section title={t("connect.routes.title")} hint={t("connect.routes.hint")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={t("connect.routes.staffLabel")}
            items={STAFF_FILTERS.map((staff) => ({
              key: staff,
              label: t(`connect.routes.staff.${staff}`),
              href: connectHref("/connect", block.query, { staff: staff === "all" ? null : staff }),
              active: staff === block.staff,
            }))}
          />
          {dataDate}
        </div>
        {visitNote}
        {total.clients === 0 ? (
          <p className="text-muted-foreground text-sm">{t("connect.routes.none")}</p>
        ) : (
          <>
            <StatGrid
              items={totalsItems(total, {
                zones: total.zones,
                dr,
                drClients: a.totals.DR.clients,
              })}
            />
            {block.level === "exec" && a.days.length > 0 && (
              <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{t("connect.routes.byDay")}</h3>
                  <DayBars
                    days={a.days.map((d) => ({
                      key: d.day,
                      label: formatDay(d.day),
                      values: dr ? [d.planned, d.visited, d.orders] : [d.planned, d.visited],
                    }))}
                    series={[
                      { label: t("connect.routes.legend.planned"), color: "#c9c7bf" },
                      { label: t("connect.routes.legend.visited"), color: "#2a78d6" },
                      ...(dr
                        ? [{ label: t("connect.routes.legend.orders"), color: "#1f9d55" }]
                        : []),
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{t("connect.routes.byWeekday")}</h3>
                  <p className="text-muted-foreground -mt-1 text-xs">
                    {t(dr ? "connect.routes.byWeekdayHint" : "connect.routes.byWeekdayHintTsm")}
                  </p>
                  <WeekdayTable table={a.weekdays} hitRate={dr} />
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {block.level === "exec" && dr && a.matrix && (
        <Section
          title={t("connect.routes.matrix.title")}
          nav={false}
          hint={t("connect.routes.matrix.hint", {
            attendance: ROUTE_TARGETS.attendance,
            hitRate: ROUTE_TARGETS.hitRate,
          })}
        >
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {MATRIX_CLASSES.map((c) => (
              <li key={c} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
                {t(`connect.routes.class.${c}`)}:{" "}
                <b className="tabular-nums">{a.matrix!.classes[c]}</b>
              </li>
            ))}
          </ul>
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <RoutesMatrix zones={a.zones} average={a.matrix.average} />
            <DataTable
              rows={a.organizations.filter((o) => o.kind === "DR")}
              rowKey={(o) => o.organization ?? "—"}
              limit={30}
              columns={[
                {
                  key: "organization",
                  header: t("connect.routes.col.organization"),
                  cell: (o) => o.organization ?? "—",
                },
                {
                  key: "zones",
                  header: t("connect.routes.col.zones"),
                  numeric: true,
                  cell: (o) => o.zones,
                },
                {
                  key: "attendance",
                  header: t("connect.routes.col.attendance"),
                  numeric: true,
                  cell: (o) => percent(o.attendance),
                },
                {
                  key: "hitRate",
                  header: t("connect.routes.col.hitRate"),
                  numeric: true,
                  cell: (o) => percent(o.hitRate),
                },
                {
                  key: "class",
                  header: t("connect.routes.col.class"),
                  cell: (o) => <ClassMark value={o.class} />,
                },
              ]}
            />
          </div>
        </Section>
      )}

      {block.level === "exec" && a.ranking.length > 0 && (
        <Section
          title={t("connect.routes.ranking.title")}
          nav={false}
          hint={t("connect.routes.ranking.hint")}
        >
          <DataTable
            rows={a.ranking}
            rowKey={(z) => z.zone}
            limit={15}
            columns={[
              {
                key: "zone",
                header: t("connect.routes.col.zone"),
                cell: (z) => <TsmName code={z.zone} name={z.person} />,
                className: "min-w-44",
              },
              {
                key: "organization",
                header: t("connect.routes.col.organization"),
                cell: (z) => z.organization ?? "—",
              },
              {
                key: "planned",
                header: t("connect.routes.col.planned"),
                numeric: true,
                cell: (z) => formatNumber(z.planned),
              },
              {
                key: "attendance",
                header: t("connect.routes.col.attendance"),
                numeric: true,
                cell: (z) => <Rate value={z.attendance} change={z.attendanceDelta} />,
              },
              {
                key: "missed",
                header: t("connect.routes.col.missed"),
                numeric: true,
                cell: (z) => formatNumber(z.missed),
              },
              {
                key: "neverVisited",
                header: t("connect.routes.col.neverVisited"),
                numeric: true,
                cell: (z) => formatNumber(z.neverVisited),
              },
            ]}
          />
        </Section>
      )}

      {block.level === "exec" && a.organizations.length > 0 && (
        <Section
          title={t("connect.routes.organizations.title")}
          nav={false}
          hint={t("connect.routes.changeHint", { previous })}
        >
          <DataTable
            rows={a.organizations}
            rowKey={(o) => `${o.kind}|${o.organization ?? ""}`}
            limit={40}
            columns={[
              {
                key: "organization",
                header: t("connect.routes.col.organization"),
                cell: (o) => o.organization ?? "—",
              },
              { key: "kind", header: t("connect.routes.col.kind"), cell: (o) => o.kind },
              {
                key: "zones",
                header: t("connect.routes.col.zones"),
                numeric: true,
                cell: (o) => o.zones,
              },
              {
                key: "clients",
                header: t("connect.routes.col.clients"),
                numeric: true,
                cell: (o) => formatNumber(o.clients),
              },
              {
                key: "planned",
                header: t("connect.routes.col.planned"),
                numeric: true,
                cell: (o) => formatNumber(o.planned),
              },
              {
                key: "attendance",
                header: t("connect.routes.col.attendance"),
                numeric: true,
                cell: (o) => <Rate value={o.attendance} change={o.attendanceDelta} />,
              },
              {
                key: "missed",
                header: t("connect.routes.col.missed"),
                numeric: true,
                cell: (o) => formatNumber(o.missed),
              },
              {
                key: "unplanned",
                header: t("connect.routes.col.unplanned"),
                numeric: true,
                cell: (o) => formatNumber(o.unplanned),
              },
              ...(dr
                ? [
                    {
                      key: "hitRate",
                      header: t("connect.routes.col.hitRate"),
                      numeric: true,
                      cell: (o: (typeof a.organizations)[number]) =>
                        o.kind === "DR" ? <Rate value={o.hitRate} change={o.hitRateDelta} /> : "—",
                    },
                  ]
                : []),
            ]}
          />
        </Section>
      )}

      {block.level === "manager" && total.clients > 0 && (
        <>
          <Section
            title={t("connect.routes.zones.title")}
            nav={false}
            hint={t("connect.routes.changeHint", { previous })}
          >
            <ZonesTable rows={a.zones} dr={dr} href={zoneHref} />
          </Section>
          <Section
            title={t("connect.routes.missed.title")}
            nav={false}
            hint={t("connect.routes.missed.hint")}
          >
            <MissedList rows={a.missed} zones />
          </Section>
          {dr && (
            <Section
              title={t("connect.routes.noOrder.title")}
              nav={false}
              hint={t("connect.routes.noOrder.hint")}
            >
              <NoOrderList rows={a.noOrder} zones />
            </Section>
          )}
        </>
      )}
    </>
  );
}

// Weekdays down, the period's weeks across: a Monday next to the Mondays before it.
function WeekdayTable({
  table,
  hitRate,
}: {
  table: RoutesBlock["analysis"]["weekdays"];
  hitRate: boolean;
}) {
  const weekday = dateFormat({ weekday: "long", timeZone: "UTC" });
  // 5 January 2026 is a Monday.
  const name = (day: number) =>
    weekday.format(fromDateString(`2026-01-${String(4 + day).padStart(2, "0")}`));
  return (
    <DataTable
      rows={table.rows}
      rowKey={(r) => String(r.weekday)}
      columns={[
        {
          key: "weekday",
          header: t("connect.routes.col.weekday"),
          cell: (r) => <span className="first-letter:uppercase">{name(r.weekday)}</span>,
        },
        ...table.weeks.map((week, i): Column<(typeof table.rows)[number]> => ({
          key: week,
          header: t("connect.routes.week", { n: i + 1 }),
          numeric: true,
          cell: (r) => {
            const cell = r.cells[i];
            if (!cell) return <span className="text-muted-foreground">—</span>;
            return (
              <span className="inline-flex flex-col items-end">
                <span>
                  <b>{percent(cell.attendance)}</b>
                  {hitRate && cell.hitRate !== null && ` · ${percent(cell.hitRate)}`}
                </span>
                <span className="text-muted-foreground text-xs">{formatDay(cell.day)}</span>
              </span>
            );
          },
        })),
      ]}
    />
  );
}

// The zones a manager sees: TSMs, then the distributor's reps, the lowest attendance first.
function ZonesTable({
  rows,
  dr,
  href,
}: {
  rows: RouteZone[];
  dr: boolean;
  href: (zone: string) => string;
}) {
  return (
    <DataTable
      rows={rows}
      rowKey={(z) => z.zone}
      limit={100}
      columns={[
        {
          key: "zone",
          header: t("connect.routes.col.zone"),
          cell: (z) => (
            <Link href={href(z.zone)} className="text-primary underline underline-offset-2">
              <TsmName code={z.zone} name={z.person} />
            </Link>
          ),
          className: "min-w-44",
        },
        { key: "kind", header: t("connect.routes.col.kind"), cell: (z) => z.kind },
        {
          key: "manager",
          header: t("connect.routes.col.manager"),
          cell: (z) => (z.manager ? <TsmName code={z.manager} name={z.managerPerson} /> : "—"),
          className: "min-w-40",
        },
        {
          key: "organization",
          header: t("connect.routes.col.organization"),
          cell: (z) => z.organization ?? "—",
        },
        {
          key: "clients",
          header: t("connect.routes.col.clients"),
          numeric: true,
          cell: (z) => formatNumber(z.clients),
        },
        {
          key: "planned",
          header: t("connect.routes.col.planned"),
          numeric: true,
          cell: (z) => formatNumber(z.planned),
        },
        {
          key: "attendance",
          header: t("connect.routes.col.attendance"),
          numeric: true,
          cell: (z) => <Rate value={z.attendance} change={z.attendanceDelta} />,
        },
        {
          key: "missed",
          header: t("connect.routes.col.missed"),
          numeric: true,
          cell: (z) => formatNumber(z.missed),
        },
        {
          key: "unplanned",
          header: t("connect.routes.col.unplanned"),
          numeric: true,
          cell: (z) => formatNumber(z.unplanned),
        },
        ...(dr
          ? [
              {
                key: "hitRate",
                header: t("connect.routes.col.hitRate"),
                numeric: true,
                cell: (z: RouteZone) =>
                  z.kind === "DR" ? <Rate value={z.hitRate} change={z.hitRateDelta} /> : "—",
              },
              {
                key: "noOrder",
                header: t("connect.routes.col.noOrder"),
                numeric: true,
                cell: (z: RouteZone) => (z.kind === "DR" ? formatNumber(z.noOrder) : "—"),
              },
              {
                key: "class",
                header: t("connect.routes.col.class"),
                cell: (z: RouteZone) => <ClassMark value={z.class} />,
                className: "min-w-36",
              },
            ]
          : []),
      ]}
    />
  );
}

const days = (list: string[]) => list.map((day) => formatDay(day)).join(", ");

// Stores whose planned visits were not made twice or more in a row by the end of the period.
function MissedList({ rows, zones }: { rows: MissedStore[]; zones: boolean }) {
  const title = !zones && (
    <h3 className="text-sm font-medium">
      {t("connect.routes.missed.title")} · {rows.length}
    </h3>
  );
  if (!rows.length)
    return (
      <>
        {title}
        <p className="text-sm">{t("connect.routes.missed.none")}</p>
      </>
    );
  return (
    <>
      {title}
      {!zones && (
        <p className="text-muted-foreground -mt-2 text-xs">{t("connect.routes.missed.hint")}</p>
      )}
      <DataTable
        rows={rows}
        rowKey={(s) => `${s.zone}|${s.storeCode}`}
        limit={30}
        columns={[
          {
            key: "store",
            header: t("connect.routes.col.store"),
            cell: (s) => <Store name={s.store} code={s.storeCode} />,
            className: "min-w-44",
          },
          ...(zones
            ? [
                {
                  key: "zone",
                  header: t("connect.routes.col.zone"),
                  cell: (s: MissedStore) => <TsmName code={s.zone} name={s.person} />,
                  className: "min-w-40",
                },
              ]
            : []),
          {
            key: "misses",
            header: t("connect.routes.col.misses"),
            numeric: true,
            cell: (s) => <b>{s.misses}</b>,
          },
          { key: "days", header: t("connect.routes.col.missedDays"), cell: (s) => days(s.days) },
          {
            key: "lastVisit",
            header: t("connect.routes.col.lastVisit"),
            cell: (s) => (s.lastVisit ? formatDay(s.lastVisit) : t("connect.routes.noVisit")),
            className: "whitespace-nowrap",
          },
          { key: "grade", header: t("connect.routes.col.grade"), cell: (s) => s.grade ?? "—" },
          {
            key: "equipment",
            header: t("connect.routes.col.equipment"),
            cell: (s) => s.equipment ?? "—",
          },
        ]}
      />
    </>
  );
}

// A DR's stores visited three times or more in the period without a single order.
function NoOrderList({ rows, zones }: { rows: NoOrderStore[]; zones: boolean }) {
  const title = !zones && (
    <h3 className="text-sm font-medium">
      {t("connect.routes.noOrder.title")} · {rows.length}
    </h3>
  );
  if (!rows.length)
    return (
      <>
        {title}
        <p className="text-sm">{t("connect.routes.noOrder.none")}</p>
      </>
    );
  return (
    <>
      {title}
      {!zones && (
        <p className="text-muted-foreground -mt-2 text-xs">{t("connect.routes.noOrder.hint")}</p>
      )}
      <DataTable
        rows={rows}
        rowKey={(s) => `${s.zone}|${s.storeCode}`}
        limit={30}
        columns={[
          {
            key: "store",
            header: t("connect.routes.col.store"),
            cell: (s) => <Store name={s.store} code={s.storeCode} />,
            className: "min-w-44",
          },
          ...(zones
            ? [
                {
                  key: "zone",
                  header: t("connect.routes.col.zone"),
                  cell: (s: NoOrderStore) => <TsmName code={s.zone} name={s.person} />,
                  className: "min-w-40",
                },
              ]
            : []),
          {
            key: "visits",
            header: t("connect.routes.col.visits"),
            numeric: true,
            cell: (s) => <b>{s.visits}</b>,
          },
          {
            key: "lastVisit",
            header: t("connect.routes.col.lastVisit"),
            cell: (s) => (s.lastVisit ? formatDay(s.lastVisit) : "—"),
            className: "whitespace-nowrap",
          },
          { key: "grade", header: t("connect.routes.col.grade"), cell: (s) => s.grade ?? "—" },
        ]}
      />
    </>
  );
}
