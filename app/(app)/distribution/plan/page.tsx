import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix, N } from "@/components/distribution/parts";
import { t } from "@/lib/i18n";
import { loadDistribution } from "@/modules/distribution/service";
import { tsmDestination } from "@/modules/distribution/types";

// How many pieces of each item go to each region (as the «Разбивка» sheet), and Tashkent by TSM.
export default async function DistributionPlanPage() {
  const d = await loadDistribution();
  const regions = [...d.regions.keys()];
  const tsms = [...d.tsms.keys()];
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const waybill = (destination: string, label: string) => (
    <Link
      href={`/distribution/plan/${encodeURIComponent(destination)}`}
      className="hover:text-primary hover:underline"
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

      {tsms.length > 0 && (
        <div id="tsm" className="scroll-mt-24">
          <Section title={t("dist.plan.tsmTitle")} hint={t("dist.plan.tsmHint")}>
            <Matrix
              dense
              head={[t("dist.equipment.tsm"), ...d.plans.map((p) => p.item.name), t("dist.total")]}
              rows={tsms.map((tsm) => ({
                key: tsm,
                cells: [
                  waybill(tsmDestination(tsm), tsm),
                  ...d.plans.map((p) => <N key={p.item.id} value={p.byTsm.get(tsm) ?? 0} />),
                  <strong key="t">{fmt(sum(d.plans.map((p) => p.byTsm.get(tsm) ?? 0)))}</strong>,
                ],
              }))}
              foot={[
                t("dist.plan.tsmRest"),
                ...d.plans.map((p) => fmt(p.tsmRest)),
                fmt(sum(d.plans.map((p) => p.tsmRest))),
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
