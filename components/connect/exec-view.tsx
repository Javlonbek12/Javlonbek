import { t } from "@/lib/i18n";
import { formatMoney, formatNumber, type ConnectReport } from "@/modules/connect/report";

import { IsmSection } from "./ism";
import { DataTable, Kpi, Section } from "./parts";
import { RoutesSection } from "./routes-section";
import { MvSection, OosSection, VisitsSection } from "./sections";

const pct = (value: number) => `${value}%`;

// Leadership: the key shares as tiles, the regions, then the sections — the whole picture.
export function ExecView({
  data,
  months,
}: {
  data: NonNullable<ConnectReport["exec"]>;
  months: string;
}) {
  const { visits: v, oos: o, mv: m } = data.sections;
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={t("connect.tile.planDone")}
          value={pct(v.visitedRate)}
          meter={v.visitedRate}
          note={t("connect.tile.planDoneNote", {
            visited: formatNumber(v.visited),
            planned: formatNumber(v.planned),
          })}
        />
        <Kpi
          label={t("connect.tile.connectUsed")}
          value={pct(v.connectRate)}
          meter={v.connectRate}
          note={t("connect.tile.connectUsedNote", { rate: v.allGoodRate })}
        />
        <Kpi
          label={t("connect.tile.mvFull")}
          value={pct(m.fullRate)}
          meter={m.fullRate}
          note={t("connect.tile.mvFullNote", { count: formatNumber(m.unique) })}
        />
        <Kpi
          label={t("connect.tile.oosStores")}
          value={formatNumber(o.withGap)}
          note={t("connect.tile.oosStoresNote", {
            rate: o.gapRate,
            checked: formatNumber(o.checked),
          })}
        />
        <Kpi
          label={t("connect.tile.orders")}
          value={formatNumber(o.orders)}
          note={t("connect.packs", { count: formatNumber(o.packs) })}
        />
        <Kpi label={t("connect.tile.ordersSum")} value={formatMoney(o.sum)} />
      </div>

      {data.regions.length > 0 && (
        <Section title={t("connect.section.regions")} hint={t("connect.section.regionsHint")}>
          <DataTable
            rows={data.regions}
            rowKey={(r) => r.region}
            limit={30}
            columns={[
              { key: "region", header: t("connect.col.region"), cell: (r) => r.region },
              {
                key: "people",
                header: t("connect.col.people"),
                numeric: true,
                cell: (r) => r.people,
              },
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
                cell: (r) => pct(r.visitedRate),
              },
              {
                key: "connect",
                header: t("connect.col.connectRate"),
                numeric: true,
                cell: (r) => pct(r.connectRate),
              },
              {
                key: "mv",
                header: t("connect.col.withMvRate"),
                numeric: true,
                cell: (r) => pct(r.withMvRate),
              },
              {
                key: "oos",
                header: t("connect.col.withOosRate"),
                numeric: true,
                cell: (r) => pct(r.withOosRate),
              },
              {
                key: "inTime",
                header: t("connect.col.inTimeRate"),
                numeric: true,
                cell: (r) => (r.timed ? pct(r.inTimeRate) : "—"),
              },
              {
                key: "other",
                header: t("connect.col.otherEmployee"),
                numeric: true,
                cell: (r) => r.otherEmployee,
              },
              {
                key: "full",
                header: t("connect.col.mvFullRate"),
                numeric: true,
                cell: (r) => pct(r.mvFullRate),
              },
              {
                key: "oosFound",
                header: t("connect.col.oosFound"),
                numeric: true,
                cell: (r) => formatNumber(r.oosFound),
              },
              {
                key: "orders",
                header: t("connect.col.orders"),
                numeric: true,
                cell: (r) => formatNumber(r.orders),
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

      <RoutesSection block={data.routes} />
      <VisitsSection data={v} />
      <OosSection data={o} />
      <MvSection data={m} />
      <IsmSection level="exec" months={months} block={data.ism} />
    </div>
  );
}
