import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber, type ConnectReport } from "@/modules/connect/report";

import { AttentionSection } from "./attention";
import { IsmSection } from "./ism";
import { DataTable, Kpi, Section } from "./parts";
import { FollowUpBlock, RecoveryBlock } from "./recovery-section";
import { RoutesSection } from "./routes-section";
import { MvSection, OosSection, VisitsSection } from "./sections";
import { Trend } from "./trend";

const pct = (value: number) => `${value}%`;

// Leadership: the key shares as tiles, the regions, then the sections — the whole picture.
export function ExecView({
  data,
  months,
  insights,
  href,
}: {
  data: NonNullable<ConnectReport["exec"]>;
  months: string;
  // Recovery of stock, the distributor's orders, who needs attention, the change of the tiles.
  insights?: ConnectReport["insights"];
  // The page with something changed (the recovery baseline, a TSM's own page).
  href?: (change: Record<string, string | null>) => string;
}) {
  const { visits: v, oos: o, mv: m } = data.sections;
  const changes = insights?.trend?.changes;
  const previous = insights?.trend?.previous;
  const recovery = insights?.recovery.totals;
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      <div
        className={cn(
          "grid grid-cols-2 gap-3 lg:grid-cols-3",
          recovery?.stores ? "xl:grid-cols-4" : "xl:grid-cols-6",
        )}
      >
        <Kpi
          label={t("connect.tile.planDone")}
          value={pct(v.visitedRate)}
          meter={v.visitedRate}
          trend={<Trend change={changes?.planDone} />}
          note={t("connect.tile.planDoneNote", {
            visited: formatNumber(v.visited),
            planned: formatNumber(v.planned),
          })}
        />
        <Kpi
          label={t("connect.tile.connectUsed")}
          value={pct(v.connectRate)}
          meter={v.connectRate}
          trend={<Trend change={changes?.connectUsed} />}
          note={t("connect.tile.connectUsedNote", { rate: v.allGoodRate })}
        />
        <Kpi
          label={t("connect.tile.mvFull")}
          value={pct(m.fullRate)}
          meter={m.fullRate}
          trend={<Trend change={changes?.mvFull} />}
          note={t("connect.tile.mvFullNote", { count: formatNumber(m.unique) })}
        />
        <Kpi
          label={t("connect.tile.oosStores")}
          value={formatNumber(o.withGap)}
          // The change is of the share in the note; fewer stores with an OOS is better.
          trend={<Trend change={changes?.oosStores} lowerIsBetter />}
          note={t("connect.tile.oosStoresNote", {
            rate: o.gapRate,
            checked: formatNumber(o.checked),
          })}
        />
        {recovery && recovery.stores > 0 && (
          <Kpi
            label={t("connect.recovery.tile")}
            value={recovery.rate === null ? "—" : pct(recovery.rate)}
            meter={recovery.rate ?? undefined}
            trend={<Trend change={changes?.recovery} />}
            note={t("connect.recovery.tileNote", {
              restored: formatNumber(recovery.restored),
              total: formatNumber(recovery.wasOut),
            })}
          />
        )}
        <Kpi
          label={t("connect.tile.orders")}
          value={formatNumber(o.orders)}
          note={t("connect.packs", { count: formatNumber(o.packs) })}
        />
        <Kpi label={t("connect.tile.ordersSum")} value={formatMoney(o.sum)} />
      </div>
      {previous && changes && Object.values(changes).some(Boolean) && (
        <p className="text-muted-foreground -mt-2 text-xs">
          {t("connect.trend.caption", {
            dates: `${formatDay(previous.from)} – ${formatDay(previous.to)}`,
          })}
        </p>
      )}

      {insights?.attention && href && (
        <AttentionSection
          rows={insights.attention}
          attendance={insights.attendance}
          personHref={(person) => href({ view: "executor", person })}
        />
      )}

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
      <OosSection data={o}>
        {insights && href && o.checked > 0 && (
          <RecoveryBlock
            data={insights.recovery}
            baseHref={(base) => href({ base: base === "month" ? base : null })}
          />
        )}
        {insights?.followUp && <FollowUpBlock data={insights.followUp} />}
      </OosSection>
      <MvSection data={m} />
      <IsmSection level="exec" months={months} block={data.ism} />
    </div>
  );
}
