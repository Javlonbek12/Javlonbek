import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt } from "@/components/distribution/parts";
import { EquipmentSketch, rowsOf } from "@/components/distribution/sketch";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { equipmentOverview } from "@/modules/distribution/equipment";
import { describeGeometry, parseGeometry } from "@/modules/planograms/geometry";
import { DIST_TYPES } from "@/modules/distribution/types";

type TypeInfo = (typeof DIST_TYPES)[number];

// Every equipment type: a to-scale model, its dimensions and slots, how many are installed, in
// warehouses and in how many outlets, and where most of them are.
export default async function EquipmentTypesPage() {
  const [o, models] = await Promise.all([
    equipmentOverview(),
    // The planogram model of each type: the same equipment in the planogram library.
    db.equipment.findMany({
      where: { distTypes: { isEmpty: false } },
      select: {
        id: true,
        name: true,
        distTypes: true,
        geometry: true,
        _count: { select: { planograms: { where: { isTemplate: false } } } },
      },
    }),
  ]);
  const groups = [...new Set(DIST_TYPES.map((x) => x.group))];
  // Types with nothing installed or stored fold away under «ещё N типов», so the used ones read
  // first.
  const used = (type: TypeInfo) =>
    (o.installedByType[type.code] ?? 0) + (o.stockByType[type.code] ?? 0) > 0;
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      {groups.map((group) => {
        const types = DIST_TYPES.filter((x) => x.group === group);
        const empty = types.filter((x) => !used(x));
        return (
          <Section key={group} title={group}>
            <div className={grid}>{types.filter(used).map((type) => card(type))}</div>
            {empty.length > 0 && (
              <details>
                <summary className="text-primary cursor-pointer text-sm">
                  {t("equip.unusedTypes", { count: empty.length })}
                </summary>
                <div className={cn(grid, "mt-3")}>{empty.map((type) => card(type))}</div>
              </details>
            )}
          </Section>
        );
      })}
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        {t("equip.sizesHint")}
        <Button asChild size="sm" variant="outline">
          <Link href="/equipment/sizes">{t("equip.sizesLink")}</Link>
        </Button>
      </p>
    </div>
  );

  function card(type: TypeInfo) {
    const size = o.sizes.find((s) => s.type === type.code);
    const installed = o.installedByType[type.code] ?? 0;
    const stock = o.stockByType[type.code] ?? 0;
    const top = o.regions
      .map((r) => ({ region: r.region, n: r.installed[type.code] ?? 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...top.map((r) => r.n));
    return (
      <div key={type.code} className="flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{type.label}</span>
          {type.slots > 0 && (
            <span className="text-muted-foreground text-xs">
              {t("equip.slots", { count: type.slots })}
            </span>
          )}
        </div>
        <div className="flex items-end gap-3">
          <div className="w-28 shrink-0">
            <EquipmentSketch
              heightMm={size?.heightMm ?? null}
              widthMm={size?.widthMm ?? null}
              rows={rowsOf(type.label)}
              items={[]}
              height={140}
            />
          </div>
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("equip.size")}</dt>
            <dd className="min-w-0 text-right text-xs tabular-nums">
              {/* A line may break after "×", never inside a number. */}
              {size?.heightMm && size.widthMm
                ? [size.heightMm, size.widthMm, size.depthMm].filter(Boolean).join("×\u200b")
                : "—"}
            </dd>
            <dt className="text-muted-foreground">{t("equip.metric.installed")}</dt>
            <dd className="text-right text-base font-semibold tabular-nums">{fmt(installed)}</dd>
            <dt className="text-muted-foreground">{t("equip.metric.stock")}</dt>
            <dd className="text-right tabular-nums">{fmt(stock)}</dd>
            <dt className="text-muted-foreground">{t("equip.metric.outlets")}</dt>
            <dd className="text-right tabular-nums">{fmt(o.outletsByType[type.code] ?? 0)}</dd>
          </dl>
        </div>
        {size?.note && <p className="text-muted-foreground text-xs">{size.note}</p>}
        {(() => {
          const model = models.find((m) => m.distTypes.includes(type.code));
          return model ? (
            <Link
              href={`/equipment/models/${model.id}`}
              className="text-primary text-xs hover:underline"
            >
              {t("equip.model", {
                name: model.name,
                shelves: describeGeometry(parseGeometry(model.geometry)),
                count: model._count.planograms,
              })}
            </Link>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("equip.noModel")}</span>
              <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
                <Link href="/equipment/models">{t("equip.linkModel")}</Link>
              </Button>
            </span>
          );
        })()}
        {top.length > 0 && (
          <ul className="flex flex-col gap-1 border-t pt-2">
            {top.slice(0, 5).map((r) => (
              <li key={r.region}>
                <Link
                  href={`/equipment/region/${encodeURIComponent(r.region)}`}
                  className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-xs hover:underline"
                >
                  <span className="truncate">{r.region}</span>
                  <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <span
                      className="block h-full rounded-full bg-[#2a78d6]"
                      style={{ width: `${(r.n / max) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{fmt(r.n)}</span>
                </Link>
              </li>
            ))}
            {top.length > 5 && (
              <li className="text-muted-foreground text-xs">
                {t("equip.moreRegions", { count: top.length - 5 })}
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
}
