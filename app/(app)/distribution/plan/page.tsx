import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { NoList } from "@/components/distribution/no-list";
import { fmt, Matrix, N } from "@/components/distribution/parts";
import { t } from "@/lib/i18n";
import { tsmBreakdown } from "@/modules/distribution/compute";
import { loadDistribution } from "@/modules/distribution/service";

// How many pieces of each item go to each region (as the «Разбивка» sheet), and each region's
// share broken down by its TSMs.
export default async function DistributionPlanPage() {
  const d = await loadDistribution();
  if (d.items.length === 0) return <NoList order={d.order} />;
  const regions = [...d.regions.keys()];
  const breakdown = tsmBreakdown(d.plans, d.tsms);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const waybill = (destination: string, label: string) => (
    <Link
      href={`/distribution/plan/${encodeURIComponent(destination)}`}
      className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Section title={t("dist.plan.title")} hint={t("dist.plan.hint")}>
        <Matrix
          dense
          head={[
            t("dist.plan.posm"),
            t("dist.plan.base"),
            t("dist.plan.toShip"),
            ...regions.map((r) => waybill(r, r)),
            t("dist.plan.distributed"),
            t("dist.plan.central"),
          ]}
          rows={d.plans.map((p) => ({
            key: p.item.id,
            cells: [
              <Link key="n" href={`/distribution/posm/${p.item.id}`} className="hover:underline">
                {p.item.name}
              </Link>,
              <span key="b" className="text-muted-foreground text-xs">
                {t(`dist.base.${p.item.base}`)}
              </span>,
              fmt(p.toShip),
              ...regions.map((r) => <N key={r} value={p.byRegion.get(r) ?? 0} />),
              <strong key="d">{fmt(p.distributed)}</strong>,
              fmt(p.central),
            ],
          }))}
          foot={[
            t("dist.total"),
            "",
            fmt(sum(d.plans.map((p) => p.toShip))),
            ...regions.map((r) => fmt(sum(d.plans.map((p) => p.byRegion.get(r) ?? 0)))),
            fmt(sum(d.plans.map((p) => p.distributed))),
            fmt(sum(d.plans.map((p) => p.central))),
          ]}
        />
      </Section>

      {breakdown.length > 0 && (
        <div id="tsm" className="scroll-mt-24">
          <Section title={t("dist.plan.tsmTitle")} hint={t("dist.plan.tsmHint")}>
            <Matrix
              dense
              head={[t("dist.equipment.tsm"), ...d.plans.map((p) => p.item.name), t("dist.total")]}
              rows={breakdown.map((row) => ({
                key: `${row.kind}:${row.destination}`,
                muted: row.kind === "rest",
                cells: [
                  row.kind === "region" ? (
                    <strong key="l">{waybill(row.destination, row.label)}</strong>
                  ) : row.kind === "tsm" ? (
                    <span key="l" className="pl-3">
                      {waybill(row.destination, row.label)}
                    </span>
                  ) : (
                    <span key="l" className="pl-3">
                      {t("dist.plan.tsmRest", { region: row.label })}
                    </span>
                  ),
                  ...row.values.map((v, i) =>
                    row.kind === "region" ? (
                      <strong key={i}>{fmt(v)}</strong>
                    ) : (
                      <N key={i} value={v} />
                    ),
                  ),
                  <strong key="t">{fmt(sum(row.values))}</strong>,
                ],
              }))}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
