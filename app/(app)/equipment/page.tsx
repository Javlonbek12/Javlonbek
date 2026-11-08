import Link from "next/link";

import { Kpi, Section } from "@/components/connect/parts";
import { fmt, pct } from "@/components/distribution/parts";
import { DataFreshness } from "@/components/equipment/data-freshness";
import { OutletAttention } from "@/components/equipment/outlet-attention";
import { UzbekistanMap } from "@/components/equipment/uz-map";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { outletReview } from "@/modules/distribution/control";
import { equipmentOverview } from "@/modules/distribution/equipment";
import { regionLabel } from "@/modules/distribution/types";

const METRICS = ["installed", "stock", "outlets"] as const;
type Metric = (typeof METRICS)[number];

// Where the equipment is: a map of Uzbekistan by region (installed, in warehouses or outlets),
// and the regions ranked.
export default async function EquipmentMapPage({ searchParams }: PageProps<"/equipment">) {
  const query = await searchParams;
  const metric: Metric = METRICS.find((m) => m === query.m) ?? "installed";
  const [o, review] = await Promise.all([equipmentOverview(), outletReview()]);
  if (o.regions.length === 0)
    return (
      <Card className="items-start gap-2">
        <p className="text-sm">{t("equip.empty")}</p>
        <Link href="/equipment/uploads" className="text-primary text-sm hover:underline">
          {t("equip.upload")}
        </Link>
      </Card>
    );
  const value = (r: (typeof o.regions)[number]) =>
    metric === "installed" ? r.installedTotal : metric === "stock" ? r.stockTotal : r.outlets;
  const values = Object.fromEntries(o.regions.map((r) => [r.region, value(r)]));
  const total = o.regions.reduce((s, r) => s + value(r), 0);
  const ranked = [...o.regions].sort((a, b) => value(b) - value(a));
  const max = Math.max(1, ...ranked.map(value));

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3">
        <DataFreshness />
        <OutletAttention review={review} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("equip.kpi.installed")} value={fmt(o.installedTotal)} />
        <Kpi label={t("equip.kpi.stock")} value={fmt(o.stockTotal)} />
        <Kpi label={t("equip.kpi.outlets")} value={fmt(o.outlets)} />
        <Kpi
          label={t("equip.kpi.types")}
          value={Object.values(o.installedByType).filter((n) => n > 0).length}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <Section title={t("equip.mapTitle")} hint={t("equip.mapHint")}>
          <div className="flex flex-wrap gap-1.5">
            {METRICS.map((m) => (
              <Link
                key={m}
                href={m === "installed" ? "/equipment" : `/equipment?m=${m}`}
                aria-current={m === metric ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  m === metric
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent/60",
                )}
              >
                {t(`equip.metric.${m}`)}
              </Link>
            ))}
          </div>
          <UzbekistanMap
            values={values}
            format={fmt}
            href={(region) => `/equipment/region/${encodeURIComponent(region)}`}
          />
          <p className="text-muted-foreground text-xs">{t("equip.mapSource")}</p>
        </Section>

        <Section title={t(`equip.metric.${metric}`)} hint={t("equip.rankHint")}>
          <ol className="flex flex-col gap-1.5">
            {ranked.map((r) => (
              <li key={r.region}>
                <Link
                  href={`/equipment/region/${encodeURIComponent(r.region)}`}
                  className="hover:bg-accent/40 flex flex-col gap-1 rounded-lg px-2 py-1.5"
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{regionLabel(r.region)}</span>
                    <span className="tabular-nums">
                      {fmt(value(r))}{" "}
                      <span className="text-muted-foreground text-xs">
                        {pct(total ? value(r) / total : 0)}
                      </span>
                    </span>
                  </span>
                  <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <span
                      className="block h-full rounded-full bg-[#2a78d6]"
                      style={{ width: `${(value(r) / max) * 100}%` }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
