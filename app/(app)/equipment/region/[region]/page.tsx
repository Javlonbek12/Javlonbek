import Link from "next/link";
import { notFound } from "next/navigation";

import { Kpi, Section } from "@/components/connect/parts";
import { fmt, Matrix, N } from "@/components/distribution/parts";
import { EquipmentSketch, rowsOf } from "@/components/distribution/sketch";
import { UzbekistanMap } from "@/components/equipment/uz-map";
import { t } from "@/lib/i18n";
import { equipmentOverview, regionEquipment } from "@/modules/distribution/equipment";
import { DIST_TYPES } from "@/modules/distribution/types";

// One region: where it is on the map, its equipment by type (with the models), by TSM, and what
// is in its warehouse.
export default async function EquipmentRegionPage({
  params,
}: PageProps<"/equipment/region/[region]">) {
  const region = decodeURIComponent((await params).region);
  const o = await equipmentOverview();
  const r = o.regions.find((x) => x.region === region);
  if (!r) notFound();
  const detail = await regionEquipment(region);
  const types = DIST_TYPES.filter((x) => (r.installed[x.code] ?? 0) + (r.stock[x.code] ?? 0) > 0);
  const sum = (row: Record<string, number>) => Object.values(row).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Link href="/equipment" className="text-muted-foreground text-sm hover:underline">
        {t("equip.back")}
      </Link>
      <h2 className="text-xl font-semibold">{region}</h2>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <div className="grid grid-cols-2 content-start gap-3 lg:grid-cols-3">
          <Kpi label={t("equip.kpi.installed")} value={fmt(r.installedTotal)} />
          <Kpi label={t("equip.kpi.stock")} value={fmt(r.stockTotal)} />
          <Kpi label={t("equip.kpi.outlets")} value={fmt(r.outlets)} />
        </div>
        <div className="bg-card rounded-2xl border p-2">
          <UzbekistanMap
            values={Object.fromEntries(o.regions.map((x) => [x.region, x.installedTotal]))}
            format={fmt}
            href={(name) => `/equipment/region/${encodeURIComponent(name)}`}
            selected={region}
          />
        </div>
      </div>

      <Section title={t("equip.byType")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {types.map((type) => {
            const size = o.sizes.find((s) => s.type === type.code);
            return (
              <div
                key={type.code}
                className="flex flex-col items-center gap-1.5 rounded-xl border p-3"
              >
                <EquipmentSketch
                  heightMm={size?.heightMm ?? null}
                  widthMm={size?.widthMm ?? null}
                  rows={rowsOf(type.label)}
                  items={[]}
                  height={90}
                />
                <span className="text-center text-xs font-medium">{type.label}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {fmt(r.installed[type.code] ?? 0)}
                </span>
                {(r.stock[type.code] ?? 0) > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {t("equip.inStock", { count: fmt(r.stock[type.code]!) })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {detail.tsms.length > 0 && (
        <Section title={t("equip.byTsm")} hint={t("equip.byTsmHint")}>
          <Matrix
            dense
            head={["TSM", t("equip.metric.outlets"), ...types.map((x) => x.label), t("dist.total")]}
            rows={detail.tsms.map((row) => ({
              key: row.tsm || "—",
              muted: row.tsm === "",
              cells: [
                row.tsm || t("dist.equipment.noTsm"),
                fmt(row.outlets),
                ...types.map((x) => <N key={x.code} value={row.units[x.code] ?? 0} />),
                <strong key="t">{fmt(sum(row.units))}</strong>,
              ],
            }))}
          />
        </Section>
      )}
    </div>
  );
}
