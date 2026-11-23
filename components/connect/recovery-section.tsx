import { Segmented } from "@/components/ui/segmented";
import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import {
  RECOVERY_BASES,
  RECOVERY_STORES_SHOWN,
  type FollowUps,
  type Recovery,
  type RecoveryBase,
} from "@/modules/connect/recovery";
import { formatNumber } from "@/modules/connect/report";

import { DataTable, StatGrid } from "./parts";
import { SECTION_ATTRIBUTE } from "./section-anchor";
import { TsmName } from "./sections";

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

// The block's place on the page: switching the baseline comes back to it.
export const RECOVERY_ANCHOR = "recovery";

// «Восстановление наличия» inside the «Автосток (OOS) и заказы» section: did the products that
// were out come back by the store's last check of the period. Leadership and managers see it by
// employee and by product; an executor their own share and stores.
export function RecoveryBlock({
  data,
  baseHref,
  own = false,
}: {
  data: Recovery;
  // The page with the other baseline chosen.
  baseHref: (base: RecoveryBase) => string;
  // The executors' level: one TSM's own numbers, without the tables by employee and product.
  own?: boolean;
}) {
  const r = data.totals;
  return (
    <div
      id={RECOVERY_ANCHOR}
      className="flex scroll-mt-20 flex-col gap-3 border-t pt-4"
      {...{ [SECTION_ATTRIBUTE]: t("connect.recovery.title") }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-medium">{t("connect.recovery.title")}</h3>
          <p className="text-muted-foreground max-w-3xl text-xs">{t("connect.recovery.hint")}</p>
          <p className="text-xs">{t(`connect.recovery.baseNote.${data.baseline}`)}</p>
        </div>
        <Segmented
          label={t("connect.recovery.baseLabel")}
          items={RECOVERY_BASES.map((base) => ({
            key: base,
            label: t(`connect.recovery.base.${base}`),
            href: `${baseHref(base)}#${RECOVERY_ANCHOR}`,
            active: base === data.baseline,
          }))}
        />
      </div>
      {r.stores === 0 ? (
        <p className="text-muted-foreground text-sm">{t("connect.recovery.none")}</p>
      ) : (
        <>
          <StatGrid
            items={[
              {
                key: "compared",
                label: t("connect.recovery.compared"),
                value: formatNumber(r.stores),
                note: t("connect.recovery.comparedNote"),
              },
              {
                key: "rate",
                label: t("connect.recovery.rate"),
                value: pct(r.rate),
                note: t("connect.recovery.rateNote", {
                  restored: formatNumber(r.restored),
                  total: formatNumber(r.wasOut),
                }),
              },
              {
                key: "stillOut",
                label: t("connect.recovery.stillOut"),
                value: formatNumber(r.stillOut),
                note: t("connect.recovery.stillOutNote"),
                tone: r.stillOut ? "warn" : undefined,
              },
              {
                key: "newlyOut",
                label: t("connect.recovery.newlyOut"),
                value: formatNumber(r.newlyOut),
                note: t("connect.recovery.newlyOutNote"),
              },
              {
                key: "worse",
                label: t("connect.recovery.worse"),
                value: formatNumber(r.worse),
                note: t("connect.recovery.worseNote"),
              },
            ]}
          />
          {!own && (
            <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">{t("connect.recovery.byTsm")}</h4>
                <DataTable
                  rows={data.byTsm}
                  rowKey={(x) => x.code}
                  limit={15}
                  columns={[
                    {
                      key: "tsm",
                      header: t("connect.col.tsm"),
                      cell: (x) => <TsmName code={x.code || "—"} name={x.name} />,
                      className: "min-w-36",
                    },
                    {
                      key: "stores",
                      header: t("connect.recovery.col.stores"),
                      numeric: true,
                      cell: (x) => formatNumber(x.stores),
                    },
                    {
                      key: "rate",
                      header: t("connect.recovery.col.rate"),
                      numeric: true,
                      cell: (x) => pct(x.rate),
                    },
                    {
                      key: "stillOut",
                      header: t("connect.recovery.col.stillOut"),
                      numeric: true,
                      cell: (x) => formatNumber(x.stillOut),
                    },
                    {
                      key: "newlyOut",
                      header: t("connect.recovery.col.newlyOut"),
                      numeric: true,
                      cell: (x) => formatNumber(x.newlyOut),
                    },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">{t("connect.recovery.bySku")}</h4>
                <p className="text-muted-foreground -mt-1 text-xs">
                  {t("connect.recovery.bySkuHint")}
                </p>
                <DataTable
                  rows={data.bySku}
                  rowKey={(x) => x.sku}
                  limit={15}
                  columns={[
                    {
                      key: "sku",
                      header: t("connect.col.sku"),
                      cell: (x) => x.sku,
                      className: "min-w-36",
                    },
                    {
                      key: "wasOut",
                      header: t("connect.recovery.col.wasOut"),
                      numeric: true,
                      cell: (x) => formatNumber(x.wasOut),
                    },
                    {
                      key: "restored",
                      header: t("connect.recovery.col.restored"),
                      numeric: true,
                      cell: (x) => formatNumber(x.restored),
                    },
                    {
                      key: "rate",
                      header: t("connect.recovery.col.rate"),
                      numeric: true,
                      cell: (x) => pct(x.rate),
                    },
                  ]}
                />
              </div>
            </div>
          )}
          {data.stores.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">
                {t("connect.recovery.storesTitle")} · {formatNumber(data.stores.length)}
              </h4>
              <p className="text-muted-foreground -mt-1 text-xs">
                {t("connect.recovery.storesHint")}
              </p>
              <DataTable
                rows={data.stores}
                rowKey={(x) => x.storeCode}
                limit={RECOVERY_STORES_SHOWN}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (x) => (
                      <span className="flex flex-col">
                        <span>{x.store}</span>
                        <span className="text-muted-foreground text-xs">{x.storeCode}</span>
                      </span>
                    ),
                    className: "min-w-44",
                  },
                  ...(own
                    ? []
                    : [
                        {
                          key: "tsm",
                          header: t("connect.col.tsm"),
                          cell: (x: Recovery["stores"][number]) => x.code ?? "—",
                        },
                      ]),
                  {
                    key: "checks",
                    header: t("connect.recovery.col.checks"),
                    cell: (x) => (
                      <span className="flex flex-col whitespace-nowrap">
                        <span>
                          {formatDay(x.baseDay)} → {formatDay(x.lastDay)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("connect.recovery.daysShort", { count: x.days })}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "stillOut",
                    header: t("connect.recovery.col.stillOut"),
                    cell: (x) => <SkuList skus={x.stillOut} />,
                    className: "min-w-48",
                  },
                  {
                    key: "newlyOut",
                    header: t("connect.recovery.col.newlyOut"),
                    cell: (x) => <SkuList skus={x.newlyOut} />,
                    className: "min-w-40",
                  },
                ]}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The product names shown next to their number; the whole list is in the Excel file.
const SKUS_SHOWN = 6;

// How many products and which: «8 · A, B, C… и ещё 5».
function SkuList({ skus }: { skus: string[] }) {
  if (!skus.length) return <span className="text-muted-foreground">—</span>;
  const more = skus.length - SKUS_SHOWN;
  return (
    <span className="flex flex-col">
      <b className="tabular-nums">{skus.length}</b>
      <span className="text-muted-foreground text-xs">
        {skus.slice(0, SKUS_SHOWN).join(", ")}
        {more > 0 && ` ${t("connect.recovery.moreSkus", { count: more })}`}
      </span>
    </span>
  );
}

// «Заказ дистрибьютора после OOS (3 дня)»: after a check found a product out, did a distributor's
// rep visit the store with an order on that day or within the next three.
export function FollowUpBlock({ data }: { data: FollowUps }) {
  const f = data.totals;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{t("connect.recovery.followTitle")}</h3>
        {data.routesTo && (
          <p className="text-xs">
            {t("connect.recovery.routesDate", { date: formatDay(data.routesTo) })}
          </p>
        )}
        <p className="text-muted-foreground max-w-3xl text-xs">
          {t("connect.recovery.followHint")}
        </p>
      </div>
      {f.checks + f.open === 0 ? (
        <p className="text-muted-foreground text-sm">{t("connect.recovery.followEmpty")}</p>
      ) : (
        <>
          <StatGrid
            items={[
              {
                key: "checks",
                label: t("connect.recovery.followChecks"),
                value: formatNumber(f.checks),
                note: f.open
                  ? t("connect.recovery.followOpen", { count: formatNumber(f.open) })
                  : undefined,
              },
              {
                key: "rate",
                label: t("connect.recovery.followRate"),
                value: pct(f.rate),
                note: t("connect.recovery.followRateNote", {
                  followed: formatNumber(f.followed),
                  checks: formatNumber(f.checks),
                }),
              },
              {
                key: "missed",
                label: t("connect.recovery.followMissed"),
                value: formatNumber(f.checks - f.followed),
                tone: f.checks - f.followed ? "warn" : undefined,
              },
            ]}
          />
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            {data.byDr.length > 0 && (
              <FollowTable
                title={t("connect.recovery.byDr")}
                head={t("connect.recovery.col.zone")}
                rows={data.byDr.map((x) => ({ ...x, code: x.zone, name: null }))}
              />
            )}
            {data.byTsm.length > 0 && (
              <FollowTable
                title={t("connect.recovery.byTsmFollow")}
                head={t("connect.col.tsm")}
                rows={data.byTsm}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FollowTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: string;
  rows: {
    code: string;
    name: string | null;
    checks: number;
    followed: number;
    rate: number | null;
  }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">{title}</h4>
      <DataTable
        rows={rows}
        rowKey={(x) => x.code}
        limit={15}
        columns={[
          {
            key: "code",
            header: head,
            cell: (x) => <TsmName code={x.code} name={x.name} />,
            className: "min-w-36",
          },
          {
            key: "checks",
            header: t("connect.recovery.col.counted"),
            numeric: true,
            cell: (x) => formatNumber(x.checks),
          },
          {
            key: "followed",
            header: t("connect.recovery.col.followed"),
            numeric: true,
            cell: (x) => formatNumber(x.followed),
          },
          {
            key: "rate",
            header: t("connect.recovery.col.followRate"),
            numeric: true,
            cell: (x) => pct(x.rate),
          },
        ]}
      />
    </div>
  );
}
