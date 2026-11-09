import Link from "next/link";

import { t } from "@/lib/i18n";
import { formatMoney, formatNumber, type ConnectReport } from "@/modules/connect/report";

import { IsmSection } from "./ism";
import { DataTable, Section } from "./parts";
import { MvSection, OosSection, statusLabel, TsmName, VisitsSection } from "./sections";

const pct = (value: number) => `${value}%`;

// Managers: one row per TSM they see (by the org chart), then the sections for those TSMs.
export function ManagerView({
  data,
  months,
  personHref,
}: {
  data: NonNullable<ConnectReport["manager"]>;
  months: string;
  personHref: (code: string) => string;
}) {
  const people = [...data.people].sort(
    (a, b) => b.attention - a.attention || b.planned - a.planned || a.code.localeCompare(b.code),
  );
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <Section title={t("connect.manager.people")} hint={t("connect.manager.peopleHint")}>
        <DataTable
          rows={people}
          rowKey={(r) => r.code}
          limit={100}
          columns={[
            {
              key: "tsm",
              header: t("connect.col.tsm"),
              cell: (r) => (
                <Link
                  href={personHref(r.code)}
                  className="text-primary underline underline-offset-2"
                >
                  <TsmName code={r.code} name={r.name} />
                </Link>
              ),
              className: "min-w-44",
            },
            { key: "zone", header: t("connect.col.zone"), cell: (r) => r.zone ?? "—" },
            {
              key: "planned",
              header: t("connect.col.planned"),
              numeric: true,
              cell: (r) => formatNumber(r.planned),
            },
            {
              key: "visited",
              header: t("connect.col.visitedRate"),
              numeric: true,
              cell: (r) => (r.planned ? pct(r.visitedRate) : "—"),
            },
            {
              key: "mv",
              header: t("connect.col.withMvRate"),
              numeric: true,
              cell: (r) => (r.visited ? pct(r.withMvRate) : "—"),
            },
            {
              key: "oos",
              header: t("connect.col.withOosRate"),
              numeric: true,
              cell: (r) => (r.visited ? pct(r.withOosRate) : "—"),
            },
            {
              key: "inTime",
              header: t("connect.col.inTimeRate"),
              numeric: true,
              cell: (r) => (r.withConnect ? pct(r.inTimeRate) : "—"),
            },
            {
              key: "other",
              header: t("connect.col.otherEmployee"),
              numeric: true,
              cell: (r) => r.otherEmployee,
            },
            {
              key: "attention",
              header: t("connect.col.attention"),
              numeric: true,
              cell: (r) => <b>{r.attention}</b>,
            },
            {
              key: "full",
              header: t("connect.col.mvFullRate"),
              numeric: true,
              cell: (r) => (r.mvOpen ? pct(r.mvFullRate) : "—"),
            },
            {
              key: "problems",
              header: t("connect.col.problems"),
              numeric: true,
              cell: (r) => r.problems,
            },
            {
              key: "oosFound",
              header: t("connect.col.oosFound"),
              numeric: true,
              cell: (r) => r.oosFound,
            },
            {
              key: "orders",
              header: t("connect.col.orders"),
              numeric: true,
              cell: (r) => r.orders,
            },
            {
              key: "packs",
              header: t("connect.col.packs"),
              numeric: true,
              cell: (r) => formatNumber(r.packs),
            },
            {
              key: "sum",
              header: t("connect.col.sum"),
              numeric: true,
              cell: (r) => formatMoney(r.sum),
            },
            {
              key: "statuses",
              header: t("connect.col.statuses"),
              cell: (r) =>
                r.statuses.length ? (
                  <span className="flex flex-col text-xs">
                    {r.statuses.map((s) => (
                      <span key={s.status}>
                        {statusLabel(s.status)}: <b className="tabular-nums">{s.count}</b>
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              className: "min-w-52",
            },
          ]}
        />
      </Section>

      <VisitsSection data={data.sections.visits} />
      <OosSection data={data.sections.oos} />
      <MvSection data={data.sections.mv} />
      <IsmSection level="manager" months={months} block={data.ism} />
    </div>
  );
}
