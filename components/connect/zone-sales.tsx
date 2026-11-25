import Link from "next/link";

import { formatDay } from "@/lib/dates";
import { formatNumber as decimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import type { RouteTargets } from "@/modules/connect/routes";
import { SHOWN } from "@/modules/connect/shown";
import { changeTone, idleTone } from "@/modules/connect/tone";
import { idleSummary, type ZoneSales, type ZoneSalesRow } from "@/modules/connect/zone-sales";

import { DataTable, Section, StatGrid, ToneBar, ToneValue, type Column } from "./parts";
import { TsmName } from "./sections";
import { targetTone } from "./tone";

// «Продажи по зонам»: what each rep sold (Smart Up's sales report) next to their hit rate, and
// what was sold to each TSM's stores next to their attendance. The biggest fall against the
// period before comes first.

// A fall of sales has no norm of the owner's (see changeTone in modules/connect/tone.ts).
export { changeTone };

const changeText = (change: number | null) =>
  change === null
    ? "—"
    : `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${decimal(Math.abs(change))}%`.trim();

const IDLE_ANCHOR = "idle-stores";

export function ZoneSalesSection({
  sales,
  level,
  targets,
  previous,
  href,
}: {
  sales: ZoneSales | null;
  level: "exec" | "manager" | "executor";
  targets: RouteTargets;
  // «11 окт. – 1 нояб.»: what the change is against.
  previous: string;
  // A zone's own page (the managers' level).
  href?: (zone: string) => string;
}) {
  if (!sales) return null;
  const reps = sales.rows.filter((r) => r.kind === "DR");
  const tsms = sales.rows.filter((r) => r.kind === "TSM");
  if (!reps.length && !tsms.length) return null;
  const total = sales.total;
  const idle = idleSummary(sales.idle);

  const columns = (kind: "DR" | "TSM"): Column<ZoneSalesRow>[] => [
    {
      key: "zone",
      header: t("connect.routes.col.zone"),
      cell: (r) =>
        href ? (
          <Link href={href(r.zone)} className="text-primary underline underline-offset-2">
            <TsmName code={r.zone} name={r.person} />
          </Link>
        ) : (
          <TsmName code={r.zone} name={r.person} />
        ),
      className: "min-w-44",
    },
    {
      key: "organization",
      header: t("connect.routes.col.organization"),
      cell: (r) => r.organization ?? "—",
    },
    {
      key: "sum",
      header: t("connect.zoneSales.col.sum"),
      numeric: true,
      cell: (r) => formatMoney(r.sum),
    },
    {
      key: "change",
      header: t("connect.zoneSales.col.change"),
      numeric: true,
      cell: (r) => <ToneValue tone={changeTone(r.change)}>{changeText(r.change)}</ToneValue>,
    },
    {
      key: "blocks",
      header: t("connect.zoneSales.col.blocks"),
      numeric: true,
      cell: (r) => formatNumber(r.blocks),
    },
    {
      key: "days",
      header: t("connect.zoneSales.col.days"),
      numeric: true,
      cell: (r) => formatNumber(r.days),
    },
    {
      key: "coverage",
      header: t("connect.zoneSales.col.coverage"),
      numeric: true,
      cell: (r) =>
        r.coverage === null ? (
          "—"
        ) : (
          <span className="inline-flex min-w-24 flex-col items-end gap-1">
            <span>
              {decimal(r.coverage)}%{" "}
              <span className="text-muted-foreground text-xs">
                {t("connect.worst.of", {
                  part: formatNumber(r.buying),
                  whole: formatNumber(r.clients),
                })}
              </span>
            </span>
            <ToneBar value={r.coverage} tone={null} />
          </span>
        ),
    },
    kind === "DR"
      ? {
          key: "hitRate",
          header: t("connect.routes.col.hitRate"),
          numeric: true,
          cell: (r) => (
            <ToneValue tone={targetTone(r.hitRate, targets.hitRate)}>
              {r.hitRate === null ? "—" : `${decimal(r.hitRate)}%`}
            </ToneValue>
          ),
        }
      : {
          key: "attendance",
          header: t("connect.routes.col.attendance"),
          numeric: true,
          cell: (r) => (
            <ToneValue tone={targetTone(r.attendance, targets.attendance)}>
              {r.attendance === null ? "—" : `${decimal(r.attendance)}%`}
            </ToneValue>
          ),
        },
  ];
  const table = (kind: "DR" | "TSM", rows: ZoneSalesRow[]) =>
    rows.length > 0 && (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t(`connect.zoneSales.table.${kind}`)}</h3>
        <p className="text-muted-foreground text-xs">{t(`connect.zoneSales.tableHint.${kind}`)}</p>
        <DataTable
          rows={rows}
          rowKey={(r) => r.zone}
          rowTone={(r) => changeTone(r.change)}
          // The rest of the zones are in the Excel file.
          limit={SHOWN.zoneSales[level]}
          columns={columns(kind)}
        />
      </div>
    );

  return (
    <Section
      sources={["smartup"]}
      title={t("connect.zoneSales.title")}
      hint={t("connect.zoneSales.hint", { previous })}
    >
      {sales.legacy && (
        <p className="rounded-md bg-amber-400/15 p-3 text-sm">{t("connect.zoneSales.legacy")}</p>
      )}
      {level !== "executor" && (
        <StatGrid
          items={[
            {
              key: "sum",
              label: t("connect.zoneSales.tile.sum"),
              value: formatMoney(total.sum),
              note: t("connect.zoneSales.tile.sumNote", { blocks: formatNumber(total.blocks) }),
            },
            {
              key: "change",
              label: t("connect.zoneSales.tile.change"),
              value: changeText(total.change),
              tone: changeTone(total.change) ?? undefined,
              note:
                total.change === null
                  ? t("connect.zoneSales.tile.changeNone")
                  : t("connect.zoneSales.tile.changeNote", { before: formatMoney(total.before) }),
            },
            ...(sales.clients > 0
              ? [
                  {
                    key: "coverage",
                    label: t("connect.zoneSales.tile.coverage"),
                    value: `${decimal((sales.buying / sales.clients) * 100)}%`,
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
                    key: "outside",
                    label: t("connect.zoneSales.tile.outside"),
                    value: sales.outside.share === null ? "—" : `${decimal(sales.outside.share)}%`,
                    note: t("connect.zoneSales.tile.outsideNote", {
                      sum: formatMoney(sales.outside.sum),
                      staff: sales.outside.staff,
                    }),
                  },
                ]
              : []),
          ]}
        />
      )}
      {table("DR", reps)}
      {table("TSM", tsms)}
      {sales.idle.length > 0 && (
        <div id={IDLE_ANCHOR} className="flex scroll-mt-20 flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-medium">
            {t("connect.zoneSales.idle.title")} · {formatNumber(idle.stores)}
          </h3>
          <p className="text-muted-foreground max-w-3xl text-xs">
            {t("connect.zoneSales.idle.hint")}
          </p>
          <p className="text-sm">
            {t("connect.zoneSales.idle.summary", {
              orders: formatNumber(idle.orders),
              unvisited: formatNumber(idle.unvisited),
              never: formatNumber(idle.never),
            })}
          </p>
          <DataTable
            rows={sales.idle}
            rowKey={(s) => `${s.zone}|${s.storeCode}`}
            // An order marked on the route and nothing delivered is what to look into (amber, not
            // red: an order of the period's last days may be delivered after it).
            rowTone={idleTone}
            limit={SHOWN.idle}
            columns={[
              {
                key: "store",
                header: t("connect.routes.col.store"),
                cell: (s) => (
                  <span className="flex flex-col">
                    <span>{s.store}</span>
                    <span className="text-muted-foreground text-xs">{s.storeCode}</span>
                  </span>
                ),
                className: "min-w-48",
              },
              {
                key: "zone",
                header: t("connect.routes.col.zone"),
                cell: (s) =>
                  href ? (
                    <Link href={href(s.zone)} className="text-primary underline underline-offset-2">
                      <TsmName code={s.zone} name={s.person} />
                    </Link>
                  ) : (
                    <TsmName code={s.zone} name={s.person} />
                  ),
                className: "min-w-40",
              },
              {
                key: "organization",
                header: t("connect.routes.col.organization"),
                cell: (s) => s.organization ?? "—",
              },
              {
                key: "grade",
                header: t("connect.routes.col.grade"),
                cell: (s) => s.grade ?? "—",
              },
              {
                key: "visits",
                header: t("connect.zoneSales.idle.visits"),
                numeric: true,
                cell: (s) => formatNumber(s.visits),
              },
              {
                key: "orders",
                header: t("connect.zoneSales.idle.orders"),
                numeric: true,
                cell: (s) => <ToneValue tone={idleTone(s)}>{formatNumber(s.orders)}</ToneValue>,
              },
              {
                key: "lastSale",
                header: t("connect.zoneSales.idle.lastSale"),
                cell: (s) =>
                  s.lastSale ? (
                    formatDay(s.lastSale)
                  ) : (
                    <span className="text-muted-foreground whitespace-nowrap">
                      {t("connect.zoneSales.idle.never")}
                    </span>
                  ),
              },
            ]}
          />
        </div>
      )}
    </Section>
  );
}
