import Link from "next/link";

import { t } from "@/lib/i18n";
import type { managerView } from "@/modules/connect/analytics";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import { plural } from "@/modules/reports/format";

import { BarList, DataTable, PersonName, Section, STAGE_COLOR } from "./parts";

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

// Orders without an answer: fresh ones are worth a call; after a month they are history to
// close in the bot.
const FRESH_DAYS = 14;
const OLD_DAYS = 30;
type Stuck = ReturnType<typeof managerView>["stuckOrders"][number];

function StuckOrders({ rows }: { rows: Stuck[] }) {
  // The agent's answer is mostly empty in the exports: the column shows only when there is one.
  const withAgent = rows.some((r) => r.agentAnswer);
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      limit={10}
      columns={[
        {
          key: "store",
          header: t("connect.col.store"),
          cell: (r) => (
            <span className="flex flex-col">
              <span>{r.store}</span>
              <span className="text-muted-foreground text-xs">
                {r.id} · {r.city}
              </span>
            </span>
          ),
          className: "min-w-40",
        },
        { key: "status", header: t("connect.col.status"), cell: (r) => r.status ?? "—" },
        ...(withAgent
          ? [
              {
                key: "agent",
                header: t("connect.col.agent"),
                cell: (r: Stuck) => r.agentAnswer ?? "—",
              },
            ]
          : []),
        {
          key: "sum",
          header: t("connect.col.sum"),
          numeric: true,
          cell: (r) => formatNumber(r.sum),
        },
        { key: "days", header: t("connect.col.days"), numeric: true, cell: (r) => r.days },
      ]}
    />
  );
}

// Managers: cities, people (with a link to each person's list), what is stuck, products × cities.
export function ManagerView({
  data,
  personHref,
}: {
  data: ReturnType<typeof managerView>;
  personHref: (person: string) => string;
}) {
  // Freshest first: those are the ones to call about.
  const byAge = [...data.stuckOrders].sort((a, b) => a.days - b.days);
  const fresh = byAge.filter((o) => o.days <= FRESH_DAYS);
  const middle = byAge.filter((o) => o.days > FRESH_DAYS && o.days <= OLD_DAYS);
  const old = byAge.filter((o) => o.days > OLD_DAYS);
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <Section title={t("connect.manager.people")} hint={t("connect.manager.peopleHint")}>
        <DataTable
          rows={data.people}
          rowKey={(r) => r.person}
          limit={20}
          columns={[
            {
              key: "person",
              header: t("connect.col.person"),
              cell: (r) => (
                <Link
                  href={personHref(r.person)}
                  className="text-primary underline underline-offset-2"
                >
                  <PersonName value={r.person} />
                </Link>
              ),
              className: "min-w-44",
            },
            {
              key: "open",
              header: t("connect.col.open"),
              numeric: true,
              cell: (r) => <b>{r.open}</b>,
            },
            {
              key: "checks",
              header: t("connect.col.checks"),
              numeric: true,
              cell: (r) => r.checks,
            },
            { key: "gaps", header: t("connect.col.gaps"), numeric: true, cell: (r) => r.gaps },
            {
              key: "ordersFromChecks",
              header: t("connect.col.ordersFromChecks"),
              numeric: true,
              cell: (r) => r.ordersFromChecks,
            },
            {
              key: "noAnswer",
              header: t("connect.col.noAnswer"),
              numeric: true,
              cell: (r) => r.noAnswer,
            },
            {
              key: "requests",
              header: t("connect.col.requests"),
              numeric: true,
              cell: (r) => r.requests,
            },
            { key: "paid", header: t("connect.col.paid"), numeric: true, cell: (r) => r.paid },
            {
              key: "checklist",
              header: t("connect.col.checklist"),
              numeric: true,
              cell: (r) => pct(r.checklist),
            },
            {
              key: "visits",
              header: t("connect.col.visits"),
              numeric: true,
              cell: (r) => r.visits,
            },
            {
              key: "visitScore",
              header: t("connect.col.visitScore"),
              numeric: true,
              cell: (r) => pct(r.visitScore),
            },
          ]}
        />
      </Section>

      <Section title={t("connect.manager.cities")}>
        <DataTable
          rows={data.cities}
          rowKey={(r) => r.city}
          limit={15}
          columns={[
            { key: "city", header: t("connect.col.city"), cell: (r) => r.city },
            {
              key: "stores",
              header: t("connect.col.stores"),
              numeric: true,
              cell: (r) => r.stores,
            },
            {
              key: "checks",
              header: t("connect.col.checks"),
              numeric: true,
              cell: (r) => r.checks,
            },
            {
              key: "gapRate",
              header: t("connect.col.gapRate"),
              numeric: true,
              cell: (r) => pct(r.gapRate),
            },
            {
              key: "orders",
              header: t("connect.col.orders"),
              numeric: true,
              cell: (r) => r.orders,
            },
            {
              key: "delivered",
              header: t("connect.col.delivered"),
              numeric: true,
              cell: (r) => r.delivered,
            },
            {
              key: "requests",
              header: t("connect.col.requests"),
              numeric: true,
              cell: (r) => r.requests,
            },
            {
              key: "contractSum",
              header: t("connect.col.contractSum"),
              numeric: true,
              cell: (r) => formatMoney(r.contractSum),
            },
            {
              key: "waiting",
              header: t("connect.col.waiting"),
              numeric: true,
              cell: (r) => r.waiting,
            },
            {
              key: "checklist",
              header: t("connect.col.checklist"),
              numeric: true,
              cell: (r) => pct(r.checklist),
            },
            {
              key: "visitScore",
              header: t("connect.col.visitScore"),
              numeric: true,
              cell: (r) => pct(r.visitScore),
            },
          ]}
        />
      </Section>

      <div className="grid gap-4 [&>*]:min-w-0">
        <Section title={t("connect.manager.waiting")} hint={t("connect.manager.waitingHint")}>
          <DataTable
            rows={data.waitingPayments}
            rowKey={(r) => r.id}
            limit={10}
            columns={[
              {
                key: "store",
                header: t("connect.col.store"),
                cell: (r) => (
                  <span className="flex flex-col">
                    <span>{r.store}</span>
                    <span className="text-muted-foreground text-xs">{r.city}</span>
                  </span>
                ),
                className: "min-w-40",
              },
              {
                key: "person",
                header: t("connect.col.person"),
                cell: (r) => <PersonName value={r.person} />,
                className: "min-w-36",
              },
              {
                key: "stage",
                header: t("connect.col.stage"),
                cell: (r) => (
                  <span className="whitespace-nowrap" style={{ color: STAGE_COLOR[r.stage] }}>
                    {t(`connect.paymentStage.${r.stage}`)}
                  </span>
                ),
              },
              {
                key: "decider",
                header: t("connect.col.decider"),
                cell: (r) => <PersonName value={r.decider} />,
                className: "min-w-36",
              },
              {
                key: "sum",
                header: t("connect.col.sum"),
                numeric: true,
                cell: (r) => formatMoney(r.sum),
              },
              { key: "days", header: t("connect.col.days"), numeric: true, cell: (r) => r.days },
            ]}
          />
        </Section>
        <Section title={t("connect.manager.stuck")} hint={t("connect.manager.stuckHint")}>
          <h3 className="text-sm font-medium">
            {t("connect.manager.stuckFresh", { days: FRESH_DAYS })}
          </h3>
          <StuckOrders rows={fresh} />
          {middle.length > 0 && (
            <>
              <h3 className="text-sm font-medium">
                {t("connect.manager.stuckMiddle", { from: FRESH_DAYS + 1, to: OLD_DAYS })}
              </h3>
              <StuckOrders rows={middle} />
            </>
          )}
          {old.length > 0 && (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("connect.manager.stuckOld", {
                  days: OLD_DAYS,
                  orders: plural("connect.words.orders", old.length),
                })}
              </summary>
              <div className="mt-3">
                <StuckOrders rows={old} />
              </div>
            </details>
          )}
        </Section>
      </div>

      {data.skuCity.rows.length > 0 && (
        <Section title={t("connect.manager.skuCity")} hint={t("connect.manager.skuCityHint")}>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="px-2 py-2 font-medium">{t("connect.col.sku")}</th>
                  {data.skuCity.cities.map((city) => (
                    <th key={city} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                      {city}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.skuCity.rows.map((row) => (
                  <tr key={row.sku} className="border-b last:border-b-0">
                    <td className="min-w-40 px-2 py-1.5">{row.sku}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.city} className="px-1 py-1">
                        <span
                          className="block rounded-md px-2 py-1 text-center tabular-nums"
                          style={{
                            // One hue, light to dark: the bigger the share, the darker the cell.
                            background: `color-mix(in oklch, #eb6834 ${Math.min(85, cell.rate)}%, transparent)`,
                            color: cell.rate >= 50 ? "white" : undefined,
                          }}
                          title={`${row.sku} · ${cell.city}: ${cell.rate}% (${cell.count})`}
                        >
                          {cell.rate ? `${cell.rate}%` : "·"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {data.checklistFails.length > 0 && (
          <Section title={t("connect.manager.checklistFails")}>
            <BarList
              rows={data.checklistFails.map((f) => ({
                key: f.q,
                label: f.q,
                value: f.rate,
                color: "#d64545",
                note: `${f.no}/${f.total}`,
              }))}
              format={(n) => `${n}%`}
              stacked
            />
          </Section>
        )}
        {data.visitFails.length > 0 && (
          <Section title={t("connect.manager.visitFails")}>
            <BarList
              rows={data.visitFails.map((f) => ({
                key: f.q,
                label: f.q,
                value: f.rate,
                color: "#d64545",
                note: `${f.no}/${f.total}`,
              }))}
              format={(n) => `${n}%`}
              stacked
            />
          </Section>
        )}
      </div>
    </div>
  );
}
