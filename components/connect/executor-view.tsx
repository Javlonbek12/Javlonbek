import Link from "next/link";

import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatMoney, formatNumber, linkOf, type ConnectReport } from "@/modules/connect/report";
import type { TsmRow } from "@/modules/connect/visits";

import { FilterSelect } from "./filter-select";
import { IsmSection } from "./ism";
import { OosPathSection } from "./oos-path";
import { DataTable, Kpi, STAGE_COLOR } from "./parts";
import { RecoveryBlock } from "./recovery-section";
import { RoutesSection } from "./routes-section";
import {
  deliveryColor,
  MvSection,
  OosSection,
  statusLabel,
  TsmName,
  VisitsSection,
} from "./sections";

const pct = (value: number) => `${value}%`;

const Store = ({ name, extra }: { name: string; extra?: string | null }) => (
  <span className="flex flex-col">
    <span>{name}</span>
    {extra && <span className="text-muted-foreground text-xs">{extra}</span>}
  </span>
);

// Executors without a choice: every TSM's card, those with more visits needing attention first.
// For the owner and managers each card also links the TSM code to a person in the app, so that
// person sees their own list (and only it).
export function ExecutorsOverview({
  rows,
  personHref,
  link,
}: {
  rows: TsmRow[];
  personHref: (code: string) => string;
  link?: {
    action: (form: FormData) => Promise<void>;
    users: { id: string; name: string }[];
    links: Record<string, string>;
    back: string;
  };
}) {
  if (!rows.length)
    return <p className="text-muted-foreground text-sm">{t("connect.executor.none")}</p>;
  const sorted = [...rows].sort(
    (a, b) => b.attention - a.attention || b.planned - a.planned || a.code.localeCompare(b.code),
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((r) => (
        <div
          key={r.code}
          className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <Link
              href={personHref(r.code)}
              className="text-primary min-w-0 font-medium underline underline-offset-2"
            >
              <TsmName code={r.code} name={r.name} />
            </Link>
            <span
              className="font-display shrink-0 text-xl font-semibold tabular-nums"
              title={t("connect.executor.attentionCount", { count: r.attention })}
            >
              {r.attention}
            </span>
          </div>
          <dl className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs">
            <dt>{t("connect.col.planned")}</dt>
            <dd className="text-foreground tabular-nums">
              {r.planned ? `${r.visited} / ${r.planned} · ${pct(r.visitedRate)}` : "—"}
            </dd>
            <dt>{t("connect.col.connectRate")}</dt>
            <dd className="text-foreground tabular-nums">{r.visited ? pct(r.connectRate) : "—"}</dd>
            <dt>{t("connect.col.mvFullRate")}</dt>
            <dd className="text-foreground tabular-nums">{r.mvOpen ? pct(r.mvFullRate) : "—"}</dd>
            <dt>{t("connect.col.orders")}</dt>
            <dd className="text-foreground tabular-nums">
              {r.orders} · {formatMoney(r.sum)}
            </dd>
          </dl>
          {link && (
            <form action={link.action} className="flex flex-col gap-1 border-t pt-2 text-xs">
              <input type="hidden" name="name" value={r.code} />
              <input type="hidden" name="back" value={link.back} />
              <label className="text-muted-foreground flex flex-col gap-1">
                {t("connect.executor.linkLabel")}
                <FilterSelect
                  name="userId"
                  defaultValue={linkOf(link.links, r.code) ?? ""}
                  className="h-8 text-xs"
                >
                  <option value="">{t("connect.executor.notLinked")}</option>
                  {link.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </FilterSelect>
              </label>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

type Executor = NonNullable<ConnectReport["executor"]>;

// One TSM: the numbers, then each section with the lists to act on.
export function ExecutorView({
  data,
  months,
  insights,
  href,
}: {
  data: Executor;
  months: string;
  // The TSM's own recovery of stock and the stores where products are still out.
  insights?: ConnectReport["insights"];
  // The page with something changed (the recovery baseline).
  href?: (change: Record<string, string | null>) => string;
}) {
  const { row: r, sections: s, detail: d } = data;
  // A distributor's rep has a route and nothing in Connect Bot: the route is all there is.
  const zone = data.routes?.zone;
  if (
    zone?.kind === "DR" &&
    !(r.planned || r.unplanned || r.mvUnique || r.oosChecked || r.orders || data.payments.length)
  )
    return (
      <div className="flex flex-col gap-4 [&>*]:min-w-0">
        <div className="flex flex-col">
          <span className="text-lg font-medium">
            {zone.zone}
            {zone.person && (
              <span className="text-muted-foreground font-normal"> · {zone.person}</span>
            )}
          </span>
          {zone.organization && (
            <span className="text-muted-foreground text-xs">{zone.organization}</span>
          )}
        </div>
        <RoutesSection block={data.routes} />
        {/* The checks at the rep's stores that found a product out: what became of each. */}
        {insights && insights.oosPath.totals.checks > 0 && (
          <OosPathSection data={insights.oosPath} level="executor" />
        )}
      </div>
    );
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="flex flex-col">
        <span className="text-lg font-medium">
          {r.code}
          {r.name && <span className="text-muted-foreground font-normal"> · {r.name}</span>}
        </span>
        {(r.zone || r.region) && (
          <span className="text-muted-foreground text-xs">
            {[r.region, r.zone].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={t("connect.tile.planDone")}
          value={pct(r.visitedRate)}
          meter={r.visitedRate}
          note={t("connect.tile.planDoneNote", {
            visited: formatNumber(r.visited),
            planned: formatNumber(r.planned),
          })}
        />
        <Kpi
          label={t("connect.tile.connectUsed")}
          value={pct(r.connectRate)}
          meter={r.connectRate}
          note={t("connect.tile.connectUsedNote", { rate: s.visits.allGoodRate })}
        />
        <Kpi
          label={t("connect.col.attention")}
          value={formatNumber(r.attention)}
          tone={r.attention ? "warn" : "good"}
        />
        <Kpi
          label={t("connect.tile.mvFull")}
          value={pct(r.mvFullRate)}
          meter={r.mvFullRate}
          note={t("connect.tile.mvFullNote", { count: formatNumber(r.mvUnique) })}
        />
        <Kpi
          label={t("connect.tile.oosStores")}
          value={formatNumber(r.oosFound)}
          note={t("connect.tile.oosStoresNote", {
            rate: s.oos.gapRate,
            checked: formatNumber(r.oosChecked),
          })}
        />
        <Kpi
          label={t("connect.tile.orders")}
          value={formatNumber(r.orders)}
          note={`${t("connect.packs", { count: formatNumber(r.packs) })} · ${formatMoney(r.sum)}`}
        />
      </div>

      <RoutesSection block={data.routes} />
      <VisitsSection data={s.visits}>
        <h3 className="text-sm font-medium">
          {t("connect.executor.attention")} · {d.attention.length}
        </h3>
        <p className="text-muted-foreground -mt-2 text-xs">{t("connect.executor.attentionHint")}</p>
        {d.attention.length === 0 ? (
          <p className="text-sm">{t("connect.executor.allDone")}</p>
        ) : (
          <DataTable
            rows={d.attention}
            rowKey={(x) => x.id}
            limit={100}
            columns={[
              {
                key: "store",
                header: t("connect.col.store"),
                cell: (x) => (
                  <Store name={x.store} extra={`${formatDay(x.day)} · ${x.storeCode}`} />
                ),
                className: "min-w-44",
              },
              {
                key: "smartUp",
                header: t("connect.col.smartUp"),
                cell: (x) => x.smartUp ?? "—",
                className: "whitespace-nowrap",
              },
              {
                key: "connect",
                header: t("connect.col.connect"),
                cell: (x) => (
                  <span className="flex flex-col text-xs whitespace-nowrap">
                    <span>
                      {t("connect.col.mv")}: {x.mvAt ?? "—"}
                    </span>
                    <span>
                      {t("connect.col.oos")}: {x.oosAt ?? "—"}
                    </span>
                  </span>
                ),
              },
              {
                key: "issue",
                header: t("connect.col.issue"),
                cell: (x) => (
                  <span className="flex flex-col gap-0.5 text-xs">
                    {x.issues.map((issue) => (
                      <span key={issue} style={{ color: STAGE_COLOR[issue] }}>
                        {t(`connect.status.${issue}`)}
                      </span>
                    ))}
                    {x.result && x.result !== "full" && x.result !== "closed" && (
                      <span style={{ color: STAGE_COLOR[x.result] }}>
                        {t("connect.section.mv")}: {t(`connect.result.${x.result}`)}
                      </span>
                    )}
                    {x.closed && (
                      <span className="text-muted-foreground">{t("connect.status.closed")}</span>
                    )}
                    {x.by && (
                      <span className="text-muted-foreground">
                        {t("connect.executor.byOther", { person: x.by })}
                      </span>
                    )}
                  </span>
                ),
                className: "min-w-48",
              },
            ]}
          />
        )}
        {d.notVisited.length > 0 && (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("connect.executor.notVisited")} · {d.notVisited.length}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {d.notVisited.map((x) => (
                <li key={x.id}>
                  {x.store} <span className="text-muted-foreground">· {formatDay(x.day)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {d.withoutVisit.length > 0 && (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("connect.executor.withoutVisit")} · {d.withoutVisit.length}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {d.withoutVisit.map((x) => (
                <li key={x.id}>
                  {x.store}{" "}
                  <span className="text-muted-foreground">
                    · {formatDay(x.day)} {x.at}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {d.duplicates.length > 0 && (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("connect.executor.duplicates")} · {d.duplicates.length}
            </summary>
            <p className="text-muted-foreground mt-2 text-xs">
              {t("connect.executor.duplicatesHint")}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {d.duplicates.map((x) => (
                <li key={`${x.store}|${x.day}`}>
                  {x.store} <span className="text-muted-foreground">· {formatDay(x.day)}</span>
                  {" — "}
                  {[
                    x.mv > 1 && `${t("connect.col.mv")}: ${x.mv}`,
                    x.oos > 1 && `${t("connect.col.oos")}: ${x.oos}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </VisitsSection>

      <OosSection data={s.oos}>
        {d.orders.length > 0 && (
          <>
            <h3 className="text-sm font-medium">
              {t("connect.executor.orders")} · {d.orders.length}
            </h3>
            <DataTable
              rows={d.orders}
              rowKey={(x) => x.id}
              limit={100}
              columns={[
                {
                  key: "store",
                  header: t("connect.col.store"),
                  cell: (x) => <Store name={x.store} extra={`${formatDay(x.day)} · ${x.id}`} />,
                  className: "min-w-44",
                },
                {
                  key: "status",
                  header: t("connect.col.status"),
                  cell: (x) => (
                    <span style={{ color: deliveryColor(x.status ?? "") }}>
                      {statusLabel(x.status ?? "")}
                    </span>
                  ),
                },
                {
                  key: "packs",
                  header: t("connect.col.packs"),
                  numeric: true,
                  cell: (x) => formatNumber(x.packs),
                },
                {
                  key: "sum",
                  header: t("connect.col.sum"),
                  numeric: true,
                  cell: (x) => formatNumber(x.sum),
                },
              ]}
            />
          </>
        )}
        {d.unsold.length > 0 && (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("connect.executor.unsold")} · {d.unsold.length}
            </summary>
            <p className="text-muted-foreground mt-2 text-xs">{t("connect.executor.unsoldHint")}</p>
            <div className="mt-2">
              <DataTable
                rows={d.unsold}
                rowKey={(x) => x.id}
                limit={100}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (x) => <Store name={x.store} extra={`${formatDay(x.day)} · ${x.id}`} />,
                    className: "min-w-44",
                  },
                  {
                    key: "status",
                    header: t("connect.col.status"),
                    cell: (x) => (
                      <span style={{ color: deliveryColor(x.status ?? "") }}>
                        {statusLabel(x.status ?? "")}
                      </span>
                    ),
                  },
                  {
                    key: "skus",
                    header: t("connect.col.skus"),
                    cell: (x) => x.skus.join(", "),
                    className: "min-w-56",
                  },
                ]}
              />
            </div>
          </details>
        )}
        {insights && href && s.oos.checked > 0 && (
          <RecoveryBlock
            own
            data={insights.recovery}
            baseHref={(base) => href({ base: base === "month" ? base : null })}
          />
        )}
      </OosSection>
      {insights && insights.oosPath.totals.checks > 0 && (
        <OosPathSection data={insights.oosPath} level="executor" />
      )}

      <MvSection data={s.mv}>
        {d.problems.length > 0 && (
          <>
            <h3 className="text-sm font-medium">
              {t("connect.executor.problems")} · {d.problems.length}
            </h3>
            <DataTable
              rows={d.problems}
              rowKey={(x) => x.id}
              limit={100}
              columns={[
                {
                  key: "store",
                  header: t("connect.col.store"),
                  cell: (x) => <Store name={x.store} extra={formatDay(x.day)} />,
                  className: "min-w-44",
                },
                {
                  key: "problems",
                  header: t("connect.col.problems"),
                  cell: (x) => (
                    <span className="flex flex-col gap-0.5 text-xs">
                      {x.problems.map((p) => (
                        <span key={p}>{p}</span>
                      ))}
                    </span>
                  ),
                  className: "min-w-56",
                },
              ]}
            />
          </>
        )}
      </MvSection>

      <IsmSection level="executor" months={months} issues={data.payments} />
    </div>
  );
}
