import Link from "next/link";
import type { ReactNode } from "react";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PATH_STORES_SHOWN,
  type OosPath,
  type PathRow,
  type PathStage,
} from "@/modules/connect/oos-path";
import { formatNumber } from "@/modules/connect/report";
import { SHOWN as PAGE } from "@/modules/connect/shown";
import {
  pathRepTone as repTone,
  pathRowTone as rowTone,
  REASON_TONE,
} from "@/modules/connect/tone";
import { NO_VISITS_REGION } from "@/modules/connect/visits";

import {
  DataTable,
  Section,
  SourceTags,
  StatGrid,
  ToneValue,
  type Column,
  type DataSource,
} from "./parts";
import { TsmName } from "./sections";
import { TONE_TEXT, type Tone } from "./tone";

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const n = formatNumber;

// How many rows of a table each level shows; the whole lists are in the Excel file.
const SHOWN = PAGE.path;

// «Путь OOS: от проверки до продажи»: what happened after each stock check that found a product
// out — the order, the store's and the rep's answers, the delivery (Connect bot) — and whether
// Smart Up shows a sale of those products to that store within three days. Leadership sees the
// whole funnel, the regions, the managers and the worst TSMs and reps; a manager their own TSMs
// and reps and the chains to act on; an executor their own funnel and chains.
export function OosPathSection({
  data,
  level,
  href,
}: {
  data: OosPath;
  level: "exec" | "manager" | "executor";
  // A TSM's or a rep's own page (the managers' level: every row is theirs to open).
  href?: (code: string) => string;
}) {
  const r = data.totals;
  const lead = level !== "executor";
  // A TSM's own page: every chain is theirs, so the column would repeat one code.
  const oneTsm = level === "executor" && data.byDr.length === 0 && data.byTsm.length <= 1;
  return (
    <Section
      title={t("connect.oosPath.title")}
      hint={t("connect.oosPath.hint")}
      nav={t("connect.oosPath.sheet.summary")}
      sources={["bot", "smartup"]}
    >
      {r.checks === 0 ? (
        <p className="text-muted-foreground text-sm">{t("connect.oosPath.none")}</p>
      ) : (
        <>
          <Funnel data={data} />
          {data.sales ? (
            <SoldBlock data={data} />
          ) : (
            <p className="text-muted-foreground text-sm">{t("connect.oosPath.noSales")}</p>
          )}

          {lead && <CrossTable data={data} />}

          {level === "exec" && (data.byRegion.length > 1 || data.byManager.length > 0) && (
            <div className="grid gap-5 border-t pt-4 [&>*]:min-w-0">
              {data.byRegion.length > 1 && (
                <Table title={t("connect.oosPath.byRegion")} sales={Boolean(data.sales)}>
                  <DataTable
                    rows={data.byRegion}
                    rowKey={(x) => x.region}
                    rowTone={rowTone}
                    limit={PAGE.pathGroups}
                    columns={[
                      {
                        key: "region",
                        header: t("connect.col.region"),
                        cell: (x) =>
                          x.region === NO_VISITS_REGION
                            ? t("connect.section.noVisitsRegion")
                            : x.region,
                        className: "min-w-32",
                      },
                      people(),
                      ...chainColumns(Boolean(data.sales)),
                    ]}
                  />
                </Table>
              )}
              {data.byManager.length > 0 && (
                <Table title={t("connect.oosPath.byManager")} sales={Boolean(data.sales)}>
                  <DataTable
                    rows={data.byManager}
                    rowKey={(x) => x.title ?? "-"}
                    rowTone={rowTone}
                    limit={PAGE.pathGroups}
                    columns={[
                      {
                        key: "manager",
                        header: t("connect.attention.manager"),
                        cell: (x) =>
                          x.title ? (
                            // The person first, the position under them.
                            <TsmName code={x.name ?? x.title} name={x.name ? x.title : null} />
                          ) : (
                            <span className="text-muted-foreground">
                              {t("connect.oosPath.noManager")}
                            </span>
                          ),
                        className: "min-w-40",
                      },
                      people(),
                      ...chainColumns(Boolean(data.sales)),
                    ]}
                  />
                </Table>
              )}
            </div>
          )}

          {lead && (data.byTsm.length > 0 || data.byDr.length > 0) && (
            <div className="grid gap-5 border-t pt-4 [&>*]:min-w-0">
              {data.byTsm.length > 0 && (
                <Table
                  title={t("connect.oosPath.byTsm")}
                  hint={t("connect.oosPath.byTsmHint")}
                  sales={Boolean(data.sales)}
                >
                  <DataTable
                    rows={data.byTsm}
                    rowKey={(x) => x.code || "-"}
                    rowTone={rowTone}
                    limit={SHOWN[level]}
                    columns={[
                      {
                        key: "tsm",
                        header: t("connect.col.tsm"),
                        cell: (x) => (
                          <Name href={x.code ? href?.(x.code) : undefined}>
                            <TsmName code={x.code || "—"} name={x.name} />
                          </Name>
                        ),
                        className: "min-w-36",
                      },
                      ...chainColumns(Boolean(data.sales)),
                    ]}
                  />
                </Table>
              )}
              {data.byDr.length > 0 && (
                <Table
                  title={t("connect.oosPath.byDr")}
                  hint={t("connect.oosPath.byDrHint")}
                  sales={Boolean(data.sales)}
                  zone
                >
                  <DataTable
                    rows={data.byDr}
                    rowKey={(x) => x.zone ?? "-"}
                    rowTone={repTone}
                    limit={SHOWN[level]}
                    columns={repColumns(Boolean(data.sales), href)}
                  />
                </Table>
              )}
            </div>
          )}

          {level !== "exec" && data.stores.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <h3 className="text-sm font-medium">
                {t("connect.oosPath.storesTitle")} · {n(data.stores.length)}
              </h3>
              <p className="text-muted-foreground -mt-1 max-w-3xl text-xs">
                {t("connect.oosPath.storesHint")}
              </p>
              <Legend sales={Boolean(data.sales)} zone />
              <DataTable
                rows={data.stores}
                rowKey={(x) => x.id}
                rowTone={(x) => REASON_TONE[x.reason]}
                limit={PATH_STORES_SHOWN}
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
                  {
                    key: "reason",
                    header: t("connect.oosPath.col.reason"),
                    cell: (x) => (
                      <ToneValue tone={REASON_TONE[x.reason]}>
                        {t(`connect.oosPath.reason.${x.reason}`)}
                      </ToneValue>
                    ),
                    className: "min-w-40",
                  },
                  {
                    key: "check",
                    header: t("connect.oosPath.col.check"),
                    cell: (x) => (
                      <span className="flex flex-col whitespace-nowrap">
                        <span>{formatDay(x.day)}</span>
                        {!oneTsm && (
                          <span className="text-muted-foreground text-xs">{x.code ?? "—"}</span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "zone",
                    header: t("connect.oosPath.col.zone"),
                    cell: (x) =>
                      x.zones.length ? (
                        x.zones.join(", ")
                      ) : (
                        <span className="text-muted-foreground">{t("connect.oosPath.noZone")}</span>
                      ),
                  },
                  {
                    key: "out",
                    header: t("connect.oosPath.col.out"),
                    cell: (x) => <SkuList skus={x.out} />,
                    className: "min-w-44",
                  },
                  {
                    key: "step",
                    header: t("connect.oosPath.col.step"),
                    cell: (x) => (
                      <span className="flex flex-col">
                        <span>{t(`connect.oosPath.step.${x.step}`)}</span>
                        {x.orderNo && (
                          <span className="text-muted-foreground text-xs">{x.orderNo}</span>
                        )}
                      </span>
                    ),
                    className: "min-w-40",
                  },
                  ...(data.sales
                    ? [
                        {
                          key: "sale",
                          header: t("connect.oosPath.col.sale"),
                          cell: (x: OosPath["stores"][number]) =>
                            t(`connect.oosPath.sold.${x.sold}`),
                          className: "min-w-40",
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// What the chains stopped at on the way to a stage: the line under its number.
const STOPPED_TONE: Record<PathStage, Tone | null> = {
  found: null,
  order: "warn",
  store: "warn",
  agent: "warn",
  delivered: "warn",
  // Delivered in the bot and not sold in Smart Up: the two sources disagree.
  sold: "bad",
};

// The funnel: found → order → store → rep → delivered → sold, each with its share of the stage
// before and how many chains went no further.
function Funnel({ data }: { data: OosPath }) {
  const r = data.totals;
  const stages = data.funnel.filter((stage) => stage.key !== "sold" || data.sales);
  const detail = (key: PathStage) => {
    if (key === "found")
      return t("connect.oosPath.foundNote", { stores: n(r.stores), tsms: n(r.tsms) });
    if (key === "store")
      return [
        t("connect.oosPath.storeStopped", {
          silent: n(r.storeSilent),
          waiting: n(r.storeWaiting),
          refused: n(r.storeRefused),
        }),
        r.other > 0 && t("connect.oosPath.otherStopped", { count: n(r.other) }),
      ]
        .filter(Boolean)
        .join(" · ");
    if (key === "delivered" && r.delivered > 0)
      return t("connect.oosPath.confirmedNote", { count: n(r.confirmed) });
    const open = r.delivered - (data.funnel.find((s) => s.key === "sold")?.of ?? r.delivered);
    if (key === "sold" && open > 0) return t("connect.oosPath.soldOpen", { count: n(open) });
    return null;
  };
  return (
    <ol
      className={cn(
        "grid grid-cols-2 gap-2 lg:grid-cols-3",
        stages.length > 5 ? "xl:grid-cols-6" : "xl:grid-cols-5",
      )}
    >
      {stages.map((stage, i) => {
        const tone = stage.stopped > 0 ? STOPPED_TONE[stage.key] : null;
        const note = detail(stage.key);
        return (
          <li
            key={stage.key}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-xl border p-3",
              tone === "bad" && "border-red-400 ring-2 ring-red-500/40 dark:border-red-500",
            )}
          >
            <span className="text-muted-foreground text-xs">
              {i + 1}. {t(`connect.oosPath.stage.${stage.key}`)}
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              {n(stage.count)}
            </span>
            {stage.rate !== null && (
              <span className="text-xs">
                {t("connect.oosPath.ofPrevious", { rate: stage.rate })}
              </span>
            )}
            {stage.stopped > 0 && (
              <span className={cn("text-xs font-medium", tone && TONE_TEXT[tone])}>
                {t(`connect.oosPath.stopped.${stage.key as Exclude<PathStage, "found">}`, {
                  count: n(stage.stopped),
                })}
              </span>
            )}
            {note && <span className="text-muted-foreground text-xs">{note}</span>}
            <span className="mt-auto pt-1">
              <SourceTags sources={[stage.key === "sold" ? "smartup" : "bot"]} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// What Smart Up shows for the checks' products, and the two places where it disagrees with the
// bot.
function SoldBlock({ data }: { data: OosPath }) {
  const r = data.totals;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {t("connect.oosPath.soldTitle")}
          <SourceTags sources={["smartup"]} />
        </h3>
        {data.sales && (
          <p className="text-xs">
            {t("connect.oosPath.salesDate", { date: formatDay(data.sales.to) })}
          </p>
        )}
      </div>
      <StatGrid
        items={[
          {
            key: "rate",
            label: t("connect.oosPath.soldRate"),
            value: pct(r.soldRate),
            note: t("connect.oosPath.soldRateNote", { sold: n(r.anySold), closed: n(r.closed) }),
          },
          { key: "all", label: t("connect.oosPath.soldAll"), value: n(r.soldAll) },
          {
            key: "none",
            label: t("connect.oosPath.notSold"),
            value: n(r.notSold),
            note: t("connect.oosPath.notSoldNote", {
              nothing: n(r.noneNothing),
              other: n(r.noneOther),
            }),
            tone: r.notSold ? "warn" : undefined,
          },
          {
            key: "open",
            label: t("connect.oosPath.open"),
            value: n(r.open),
            note: t("connect.oosPath.openNote"),
          },
        ]}
      />
      {(r.deliveredNoSale > 0 || r.soldAnyway > 0) && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {r.deliveredNoSale > 0 && (
            <li className="rounded-lg border-l-4 border-l-red-500 bg-red-500/10 px-3 py-2">
              {t("connect.oosPath.mismatchDelivered", {
                count: n(r.deliveredNoSale),
                total: n(r.delivered),
              })}
            </li>
          )}
          {r.soldAnyway > 0 && (
            <li className="rounded-lg border-l-4 border-l-amber-400 bg-amber-400/10 px-3 py-2">
              {t("connect.oosPath.mismatchAnyway", { count: n(r.soldAnyway) })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Step × sold: where the chains stopped, and what Smart Up shows for each step.
function CrossTable({ data }: { data: OosPath }) {
  type Row = OosPath["cross"][number];
  const sales = Boolean(data.sales);
  // A delivery without a sale is red; a sale without an order or an answer is marked too.
  const unsold = (x: Row, value: number) => (
    <ToneValue tone={x.step === "delivered" && value > 0 ? "bad" : null}>{n(value)}</ToneValue>
  );
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <h3 className="text-sm font-medium">{t("connect.oosPath.crossTitle")}</h3>
      {sales && (
        <p className="text-muted-foreground -mt-1 max-w-3xl text-xs">
          {t("connect.oosPath.crossHint")}
        </p>
      )}
      <Legend sales={sales} />
      <DataTable
        rows={data.cross}
        rowKey={(x) => x.step}
        columns={[
          {
            key: "step",
            header: t("connect.oosPath.col.step"),
            cell: (x) => t(`connect.oosPath.step.${x.step}`),
            className: "min-w-52",
          },
          {
            key: "checks",
            header: t("connect.oosPath.col.checks"),
            numeric: true,
            cell: (x) => n(x.checks),
          },
          ...(sales
            ? ([
                {
                  key: "any",
                  header: t("connect.oosPath.col.anySold"),
                  numeric: true,
                  cell: (x) => (
                    <ToneValue
                      tone={
                        (x.step === "noOrder" || x.step === "storeSilent") && x.anySold > 0
                          ? "warn"
                          : null
                      }
                    >
                      {x.anyRate === null ? "—" : `${n(x.anySold)} · ${pct(x.anyRate)}`}
                    </ToneValue>
                  ),
                },
                {
                  key: "all",
                  header: t("connect.oosPath.col.soldAll"),
                  numeric: true,
                  cell: (x) => n(x.all),
                },
                {
                  key: "noneOther",
                  header: t("connect.oosPath.col.noneOther"),
                  numeric: true,
                  cell: (x) => unsold(x, x.noneOther),
                },
                {
                  key: "noneNothing",
                  header: t("connect.oosPath.col.noneNothing"),
                  numeric: true,
                  cell: (x) => unsold(x, x.noneNothing),
                },
                {
                  key: "open",
                  header: t("connect.oosPath.col.open"),
                  numeric: true,
                  cell: (x) => n(x.open),
                },
              ] satisfies Column<Row>[])
            : []),
        ]}
      />
    </div>
  );
}

// A table with its title and whose data its columns are.
function Table({
  title,
  hint,
  sales,
  zone = false,
  children,
}: {
  title: string;
  hint?: string;
  sales: boolean;
  zone?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="text-muted-foreground -mt-1 max-w-3xl text-xs">{hint}</p>}
      <Legend sales={sales} zone={zone} />
      {children}
    </div>
  );
}

// Whose data the columns of a table are: the steps are the bot's; the sales and the rep's zone
// are Smart Up's.
function Legend({ sales, zone = false }: { sales: boolean; zone?: boolean }) {
  const groups: { key: string; label: string; source: DataSource }[] = [
    { key: "steps", label: t("connect.oosPath.col.step"), source: "bot" },
    ...(sales
      ? [{ key: "sale", label: t("connect.oosPath.col.soldRate"), source: "smartup" as const }]
      : []),
    ...(zone
      ? [{ key: "zone", label: t("connect.oosPath.col.zone"), source: "smartup" as const }]
      : []),
  ];
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {groups.map((group) => (
        <li key={group.key} className="flex items-center gap-1.5">
          {group.label}
          <SourceTags sources={[group.source]} />
        </li>
      ))}
    </ul>
  );
}

// A name that opens the person's own page when there is one to open.
function Name({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className="text-primary underline underline-offset-2">
      {children}
    </Link>
  );
}

const people = <T extends { people: number }>(): Column<T> => ({
  key: "people",
  header: t("connect.oosPath.col.people"),
  numeric: true,
  cell: (x) => n(x.people),
});

// A delivery Smart Up shows no sale for: the number on red.
const noSale = (x: PathRow) => (
  <ToneValue tone={x.deliveredNoSale > 0 ? "bad" : null}>{n(x.deliveredNoSale)}</ToneValue>
);

// The chain's steps as columns, the same for a region, a manager and a TSM.
function chainColumns<T extends PathRow>(sales: boolean): Column<T>[] {
  return [
    {
      key: "checks",
      header: t("connect.oosPath.col.checks"),
      numeric: true,
      cell: (x) => n(x.checks),
    },
    {
      key: "noOrder",
      header: t("connect.oosPath.col.noOrder"),
      numeric: true,
      cell: (x) => `${n(x.noOrder)} · ${pct(x.noOrderRate)}`,
    },
    {
      key: "storeSilent",
      header: t("connect.oosPath.col.storeSilent"),
      numeric: true,
      cell: (x) => n(x.storeSilent),
    },
    {
      key: "agentWaiting",
      header: t("connect.oosPath.col.agentWaiting"),
      numeric: true,
      cell: (x) => n(x.agentWaiting),
    },
    {
      key: "agentAccepted",
      header: t("connect.oosPath.col.agentAccepted"),
      numeric: true,
      cell: (x) => n(x.agentAccepted),
    },
    {
      key: "delivered",
      header: t("connect.oosPath.col.delivered"),
      numeric: true,
      cell: (x) => n(x.delivered),
    },
    ...(sales
      ? ([
          {
            key: "soldRate",
            header: t("connect.oosPath.col.soldRate"),
            numeric: true,
            cell: (x) => pct(x.soldRate),
          },
          {
            key: "deliveredNoSale",
            header: t("connect.oosPath.col.deliveredNoSale"),
            numeric: true,
            cell: noSale,
          },
        ] satisfies Column<T>[])
      : []),
  ];
}

// A rep's zone: the orders that reached them, those they did not answer, what they delivered —
// and what of it Smart Up shows as sold.
function repColumns(
  sales: boolean,
  href?: (code: string) => string,
): Column<OosPath["byDr"][number]>[] {
  return [
    {
      key: "zone",
      header: t("connect.oosPath.col.zone"),
      cell: (x) =>
        x.zone ? (
          <Name href={href?.(x.zone)}>{x.zone}</Name>
        ) : (
          <span className="text-muted-foreground">{t("connect.oosPath.noZone")}</span>
        ),
      className: "min-w-36",
    },
    {
      key: "checks",
      header: t("connect.oosPath.col.checks"),
      numeric: true,
      cell: (x) => n(x.checks),
    },
    {
      key: "orders",
      header: t("connect.oosPath.col.orders"),
      numeric: true,
      cell: (x) => n(x.orders),
    },
    {
      key: "agentWaiting",
      header: t("connect.oosPath.col.agentWaiting"),
      numeric: true,
      cell: (x) => (
        <ToneValue tone={x.agentWaiting > 0 ? "warn" : null}>{n(x.agentWaiting)}</ToneValue>
      ),
    },
    {
      key: "agentAccepted",
      header: t("connect.oosPath.col.agentAccepted"),
      numeric: true,
      cell: (x) => n(x.agentAccepted),
    },
    {
      key: "delivered",
      header: t("connect.oosPath.col.delivered"),
      numeric: true,
      cell: (x) => n(x.delivered),
    },
    ...(sales
      ? ([
          {
            key: "deliveredNoSale",
            header: t("connect.oosPath.col.deliveredNoSale"),
            numeric: true,
            cell: noSale,
          },
          {
            key: "soldRate",
            header: t("connect.oosPath.col.soldRate"),
            numeric: true,
            cell: (x) => pct(x.soldRate),
          },
          {
            key: "notSold",
            header: t("connect.oosPath.col.notSold"),
            numeric: true,
            cell: (x) => n(x.notSold),
          },
        ] satisfies Column<OosPath["byDr"][number]>[])
      : []),
  ];
}

// The product names shown next to their number; the whole list is in the Excel file.
const SKUS_SHOWN = PAGE.pathSkus;

function SkuList({ skus }: { skus: string[] }) {
  const more = skus.length - SKUS_SHOWN;
  return (
    <span className="flex flex-col">
      <b className="tabular-nums">{t("connect.oosPath.outCount", { count: skus.length })}</b>
      <span className="text-muted-foreground text-xs">
        {skus.slice(0, SKUS_SHOWN).join(", ")}
        {more > 0 && ` ${t("connect.recovery.moreSkus", { count: more })}`}
      </span>
    </span>
  );
}
