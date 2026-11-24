import Link from "next/link";

import { formatNumber as decimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import type { RouteTargets } from "@/modules/connect/routes";
import type { ZoneSales, ZoneSalesRow } from "@/modules/connect/zone-sales";

import { DataTable, Section, StatGrid, ToneBar, ToneValue, type Column } from "./parts";
import { TsmName } from "./sections";
import { targetTone, type Tone } from "./tone";

// «Продажи по зонам»: what each rep sold (Smart Up's sales report) next to their hit rate, and
// what was sold to each TSM's stores next to their attendance. The biggest fall against the
// period before comes first.

// A fall of sales has no norm of the owner's: a tenth and more is marked as far, any fall as
// close, growth as good.
const FAR_FALL = -10;
export const changeTone = (change: number | null): Tone | null =>
  change === null ? null : change <= FAR_FALL ? "bad" : change < 0 ? "warn" : "good";

const changeText = (change: number | null) =>
  change === null
    ? "—"
    : `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${decimal(Math.abs(change))}%`.trim();

// How many zones a table shows (the rest are in the Excel file).
const ZONES_SHOWN = { exec: 20, manager: 40, executor: 1 };

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
          limit={ZONES_SHOWN[level]}
          columns={columns(kind)}
        />
      </div>
    );

  return (
    <Section title={t("connect.zoneSales.title")} hint={t("connect.zoneSales.hint", { previous })}>
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
    </Section>
  );
}
