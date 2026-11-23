import Link from "next/link";

import { t } from "@/lib/i18n";
import { formatMoney, formatNumber, type ConnectReport } from "@/modules/connect/report";
import type { TsmRow } from "@/modules/connect/visits";

import { AttentionSection } from "./attention";
import { IsmSection } from "./ism";
import { ManagerTreeView } from "./manager-tree";
import { DataTable, Section } from "./parts";
import { FollowUpBlock, RecoveryBlock } from "./recovery-section";
import { RoutesSection } from "./routes-section";
import { MvSection, OosSection, statusLabel, TsmName, VisitsSection } from "./sections";

const pct = (value: number) => `${value}%`;

// Managers: the positions of the employee info as a tree with the numbers of the TSMs under each
// (or, without it, one row per TSM they see by the org chart), then the sections for those TSMs.
export function ManagerView({
  data,
  months,
  sales,
  personHref,
  link,
  insights,
  href,
  rulesHref,
}: {
  // Where the owner changes the lines the blocks are counted against (others have no link).
  rulesHref?: string;
  data: NonNullable<ConnectReport["manager"]>;
  months: string;
  // Recovery of stock, the distributor's orders and who needs attention, for the TSMs they see.
  insights?: ConnectReport["insights"];
  // The page with something changed (the recovery baseline).
  href?: (change: Record<string, string | null>) => string;
  // Sales are loaded: the cross-check column.
  sales: boolean;
  personHref: (code: string) => string;
  // Linking positions to people in the app (owner and managers).
  link?: {
    action: (form: FormData) => Promise<void>;
    users: { id: string; name: string }[];
    links: Record<string, string>;
    back: string;
  };
}) {
  return (
    <div className="flex flex-col gap-4 [&>*]:min-w-0">
      {insights?.attention && (
        <AttentionSection
          rows={insights.attention}
          attendance={insights.attendance}
          rules={insights.rules}
          rulesHref={rulesHref}
          personHref={personHref}
        />
      )}
      {data.tree ? (
        <>
          <Section title={t("connect.manager.tree")} hint={t("connect.manager.treeHint")}>
            {data.tree.roots.length || data.tree.idle.length ? (
              <ManagerTreeView tree={data.tree} sales={sales} personHref={personHref} link={link} />
            ) : (
              <p className="text-muted-foreground text-sm">{t("connect.manager.noRows")}</p>
            )}
          </Section>
          {data.tree.outside.length > 0 && (
            <Section title={t("connect.manager.outside")} hint={t("connect.manager.outsideHint")}>
              <PeopleTable rows={data.tree.outside} sales={sales} personHref={personHref} />
            </Section>
          )}
        </>
      ) : (
        <Section title={t("connect.manager.people")} hint={t("connect.manager.peopleHint")}>
          <PeopleTable rows={data.people} sales={sales} personHref={personHref} />
        </Section>
      )}

      <RoutesSection block={data.routes} rulesHref={rulesHref} />
      <VisitsSection data={data.sections.visits} />
      <OosSection data={data.sections.oos}>
        {insights && href && data.sections.oos.checked > 0 && (
          <RecoveryBlock
            data={insights.recovery}
            baseHref={(base) => href({ base: base === "month" ? base : null })}
          />
        )}
        {insights?.followUp && <FollowUpBlock data={insights.followUp} />}
      </OosSection>
      <MvSection data={data.sections.mv} />
      <IsmSection level="manager" months={months} block={data.ism} />
    </div>
  );
}

// One row per TSM, those with more visits needing attention first.
function PeopleTable({
  rows,
  sales,
  personHref,
}: {
  rows: TsmRow[];
  sales: boolean;
  personHref: (code: string) => string;
}) {
  const people = [...rows].sort(
    (a, b) => b.attention - a.attention || b.planned - a.planned || a.code.localeCompare(b.code),
  );
  return (
    <DataTable
      rows={people}
      rowKey={(r) => r.code}
      limit={100}
      columns={[
        {
          key: "tsm",
          header: t("connect.col.tsm"),
          cell: (r) => (
            <Link href={personHref(r.code)} className="text-primary underline underline-offset-2">
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
          cell: (r) => (r.timed ? pct(r.inTimeRate) : "—"),
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
        ...(sales
          ? [
              {
                key: "sales",
                header: t("connect.col.salesRate"),
                numeric: true,
                cell: (r: TsmRow) => (r.sales.checked ? pct(r.salesRate) : "—"),
              },
            ]
          : []),
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
  );
}
