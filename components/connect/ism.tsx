import { formatDay } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { IsmBlock, paymentIssues } from "@/modules/connect/analytics";
import { formatMoney, formatNumber } from "@/modules/connect/report";
import { plural } from "@/modules/reports/format";

import { BarList, DataTable, PersonName, Section, StageBar, STAGE_COLOR, StatGrid } from "./parts";

// «Оплаты ISM»: built from the bot's payment requests, by months, as before the visits analytics.
// Leadership sees the money by stage, managers what waits for a decision, a TSM what to see through.

function Fails({ rows }: { rows: IsmBlock["checklistFails"] }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("connect.ism.checklist")}</h3>
      <BarList
        rows={rows.map((f) => ({
          key: f.q,
          label: f.q,
          value: f.rate,
          color: "#d69e2e",
          note: `${f.no}/${f.total}`,
        }))}
        format={(n) => `${n}%`}
        stacked
      />
    </div>
  );
}

export function IsmSection({
  months,
  block,
  issues,
  level,
}: {
  months: string;
  block?: IsmBlock;
  issues?: ReturnType<typeof paymentIssues>;
  level: "exec" | "manager" | "executor";
}) {
  const hint = t("connect.section.ismHint", { months });
  const empty = level === "executor" ? !issues?.length : !block?.requests;
  if (empty)
    return (
      <Section sources={["bot"]} title={t("connect.section.ism")} hint={hint}>
        <p className="text-muted-foreground text-sm">
          {level === "executor" ? t("connect.manager.noRows") : t("connect.ism.none")}
        </p>
      </Section>
    );
  if (level === "executor")
    return (
      <Section
        sources={["bot"]}
        nav={false}
        title={t("connect.ism.issues")}
        hint={`${hint} ${t("connect.ism.issuesHint")}`}
      >
        <DataTable
          rows={issues!}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "store",
              header: t("connect.col.store"),
              cell: (r) => (
                <span className="flex flex-col">
                  <span>{r.store}</span>
                  <span className="text-muted-foreground text-xs">
                    {[formatDay(r.day), r.city].filter(Boolean).join(" · ")}
                  </span>
                </span>
              ),
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
                      {t("connect.ism.failed", { list: r.failed.join("; ") })}
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
    );
  const b = block!;
  if (level === "manager")
    return (
      <Section sources={["bot"]} title={t("connect.section.ism")} hint={hint}>
        <h3 className="text-sm font-medium">{t("connect.ism.waiting")}</h3>
        <p className="text-muted-foreground -mt-2 text-xs">{t("connect.ism.waitingHint")}</p>
        <DataTable
          rows={b.waitingList}
          rowKey={(r) => r.id}
          limit={15}
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
        <Fails rows={b.checklistFails} />
      </Section>
    );
  return (
    <Section sources={["bot"]} title={t("connect.section.ism")} hint={hint}>
      <StatGrid
        items={[
          {
            key: "contract",
            label: t("connect.kpi.contractSum"),
            value: formatMoney(b.contractSum),
            note: `${t("connect.kpi.requests")}: ${formatNumber(b.requests)}`,
          },
          {
            key: "paid",
            label: t("connect.kpi.paidSum"),
            value: formatMoney(b.paidSum),
            note: t("connect.kpi.paidRate", { rate: b.paidRate }),
          },
          {
            key: "waiting",
            label: t("connect.kpi.waitingSum"),
            value: formatMoney(b.waitingSum),
            note: plural("connect.words.requests", b.waiting),
            tone: b.waiting ? "warn" : undefined,
          },
          {
            key: "checklist",
            label: t("connect.kpi.checklist"),
            value: b.checklist === null ? "—" : `${b.checklist}%`,
            note: t("connect.kpi.roiPositive", { rate: b.roiPositive }),
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("connect.ism.stages")}</h3>
          <StageBar
            rows={b.stages.map((s) => ({
              key: s.id,
              label: t(`connect.paymentStage.${s.id}`),
              value: s.value,
              note: s.sum ? formatMoney(s.sum) : undefined,
            }))}
          />
        </div>
        <Fails rows={b.checklistFails} />
      </div>
    </Section>
  );
}
