import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { executorView } from "@/modules/connect/analytics";
import { formatMoney, formatNumber } from "@/modules/connect/report";

import { DataTable, Kpi, PersonName, Section, STAGE_COLOR } from "./parts";

const Store = ({ name, city, extra }: { name: string; city: string | null; extra?: string }) => (
  <span className="flex flex-col">
    <span>{name}</span>
    <span className="text-muted-foreground text-xs">
      {[extra, city].filter(Boolean).join(" · ")}
    </span>
  </span>
);

// Executors: one person's numbers and a to-do list built from their open items.
export function ExecutorView({
  person,
  data,
}: {
  person: string;
  data: ReturnType<typeof executorView>;
}) {
  const k = data.kpis;
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="text-lg font-medium">
        <PersonName value={person} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={t("connect.kpi.checks")}
          value={formatNumber(k.checks)}
          note={`${t("connect.col.gaps")}: ${k.gaps} · ${t("connect.col.ordersFromChecks")}: ${k.ordersFromChecks}`}
        />
        <Kpi
          label={t("connect.kpi.orders")}
          value={formatNumber(k.orders)}
          note={`${t("connect.col.delivered")}: ${k.delivered} · ${t("connect.col.noAnswer")}: ${k.noAnswer}`}
        />
        <Kpi
          label={t("connect.kpi.requests")}
          value={formatNumber(k.requests)}
          note={`${formatMoney(k.contractSum)} · ${t("connect.col.paid")}: ${k.paid}`}
        />
        <Kpi
          label={t("connect.kpi.visits")}
          value={formatNumber(k.visits)}
          note={
            k.visitScore === null ? undefined : t("connect.kpi.visitScore", { score: k.visitScore })
          }
        />
      </div>

      {data.openCount === 0 ? (
        <Section title={t("connect.executor.todo")}>
          <p className="text-sm">{t("connect.executor.allDone")}</p>
        </Section>
      ) : (
        <>
          {data.gapsWithoutOrder.length > 0 && (
            <Section
              title={`${t("connect.executor.gaps")} · ${data.gapsWithoutOrder.length}`}
              hint={t("connect.executor.gapsHint")}
            >
              <DataTable
                rows={data.gapsWithoutOrder}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (r) => <Store name={r.store} city={r.city} extra={formatDay(r.day)} />,
                    className: "min-w-44",
                  },
                  {
                    key: "skus",
                    header: t("connect.col.sku"),
                    cell: (r) => <span className="text-xs">{r.skus.join(", ") || "—"}</span>,
                    className: "min-w-56",
                  },
                ]}
              />
            </Section>
          )}
          {data.openOrders.length > 0 && (
            <Section
              title={`${t("connect.executor.orders")} · ${data.openOrders.length}`}
              hint={t("connect.executor.ordersHint")}
            >
              <DataTable
                rows={data.openOrders}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (r) => <Store name={r.store} city={r.city} extra={r.id} />,
                    className: "min-w-44",
                  },
                  {
                    key: "status",
                    header: t("connect.col.status"),
                    cell: (r) => (
                      <span style={{ color: STAGE_COLOR[r.stage] }}>{r.status ?? "—"}</span>
                    ),
                  },
                  {
                    key: "sum",
                    header: t("connect.col.sum"),
                    numeric: true,
                    cell: (r) => formatNumber(r.sum),
                  },
                  {
                    key: "days",
                    header: t("connect.col.days"),
                    numeric: true,
                    cell: (r) => r.days,
                  },
                ]}
              />
            </Section>
          )}
          {data.paymentIssues.length > 0 && (
            <Section
              title={`${t("connect.executor.payments")} · ${data.paymentIssues.length}`}
              hint={t("connect.executor.paymentsHint")}
            >
              <DataTable
                rows={data.paymentIssues}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (r) => <Store name={r.store} city={r.city} extra={formatDay(r.day)} />,
                    className: "min-w-44",
                  },
                  {
                    key: "stage",
                    header: t("connect.col.stage"),
                    cell: (r) => (
                      <span className="flex flex-col">
                        <span style={{ color: STAGE_COLOR[r.stage] }}>
                          {t(`connect.paymentStage.${r.stage}`)}
                        </span>
                        {r.note && <span className="text-muted-foreground text-xs">{r.note}</span>}
                        {r.failed.length > 0 && (
                          <span className="text-muted-foreground text-xs">
                            {t("connect.executor.failed", { list: r.failed.join("; ") })}
                          </span>
                        )}
                      </span>
                    ),
                    className: "min-w-52",
                  },
                  {
                    key: "sum",
                    header: t("connect.col.sum"),
                    numeric: true,
                    cell: (r) => formatMoney(r.sum),
                  },
                ]}
              />
            </Section>
          )}
          {data.openVisits.length > 0 && (
            <Section title={`${t("connect.executor.visits")} · ${data.openVisits.length}`}>
              <DataTable
                rows={data.openVisits}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "store",
                    header: t("connect.col.store"),
                    cell: (r) => <Store name={r.store} city={r.city} extra={formatDay(r.day)} />,
                    className: "min-w-44",
                  },
                  {
                    key: "problem",
                    header: t("connect.col.problem"),
                    cell: (r) => (
                      <span className="flex flex-col gap-0.5 text-xs">
                        {!r.done && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {t("connect.executor.visitOpen")}
                          </span>
                        )}
                        {r.problems.map((p) => (
                          <span key={p}>{p}</span>
                        ))}
                      </span>
                    ),
                    className: "min-w-56",
                  },
                  {
                    key: "score",
                    header: t("connect.col.visitScore"),
                    numeric: true,
                    cell: (r) => (r.percent === null ? "—" : `${r.percent}%`),
                  },
                ]}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
