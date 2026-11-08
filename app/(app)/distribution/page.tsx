import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";

import { Kpi, Section } from "@/components/connect/parts";
import { NoList } from "@/components/distribution/no-list";
import { Findings, fmt, Matrix, N, pct, Balance } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { dateFormat, t } from "@/lib/i18n";
import { coverage, sumUnits } from "@/modules/distribution/compute";
import { loadDistribution } from "@/modules/distribution/service";
import { DIST_TYPES, tagPrice } from "@/modules/distribution/types";

// The analysis on one page: the numbers, what needs attention, regions, coverage and checks.
export default async function DistributionPage() {
  const d = await loadDistribution();

  if (d.items.length === 0) return <NoList order={d.order} />;

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const installed = sum(
    d.counts.filter((c) => c.kind === "INSTALLED" && !c.tsm).map((c) => c.count),
  );
  const stockUnits = sum(d.counts.filter((c) => c.kind === "STOCK" && !c.tsm).map((c) => c.count));
  const baseUnits = sumUnits(d.total);
  const available = sum(d.plans.map((p) => p.available));
  const distributed = sum(d.plans.map((p) => p.distributed));
  const central = sum(d.plans.map((p) => p.central));
  const shipped = sum(d.shipments.map((s) => s.quantity));
  const regionShipped = (region: string) =>
    sum(
      d.shipments
        .filter((s) => s.destination === region || s.destination.startsWith(`${region} · `))
        .map((s) => s.quantity),
    );
  const cover = coverage(d.items);
  const tags = d.tags.filter((tag) => tag.need > 0 || tag.available > 0);
  const hasPlanogramPrices = d.tags.some((tag) => tag.need > 0);

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {d.importedAt &&
            t("dist.updated", {
              date: dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(d.importedAt),
            })}
        </span>
        <Button asChild variant="outline" size="sm">
          <a href="/api/distribution/xlsx">
            <FileSpreadsheet />
            {t("dist.excel")}
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          label={t("dist.kpi.equipment")}
          value={fmt(baseUnits)}
          note={
            d.includeStock
              ? t("dist.kpi.equipmentNote", { installed: fmt(installed), stock: fmt(stockUnits) })
              : t("dist.kpi.equipmentNoteNoStock")
          }
        />
        <Kpi
          label={t("dist.kpi.items")}
          value={d.items.length}
          note={t("dist.kpi.itemsNote", {
            categories: new Set(d.items.map((i) => i.category)).size,
          })}
        />
        <Kpi
          label={t("dist.kpi.available")}
          value={fmt(available)}
          note={t("dist.kpi.availableNote", {
            inStock: fmt(sum(d.items.map((i) => i.inStock))),
            ordered: fmt(sum(d.items.map((i) => i.ordered))),
          })}
        />
        <Kpi
          label={t("dist.kpi.toRegions")}
          value={fmt(distributed)}
          meter={available ? (distributed / available) * 100 : 0}
          note={t("dist.kpi.toRegionsNote", {
            share: pct(available ? distributed / available : 0),
          })}
        />
        <Kpi label={t("dist.kpi.central")} value={fmt(central)} note={t("dist.kpi.centralNote")} />
        <Kpi
          label={t("dist.kpi.shipped")}
          value={fmt(shipped)}
          meter={distributed ? (shipped / distributed) * 100 : 0}
          tone={shipped === 0 ? undefined : shipped >= distributed ? "good" : undefined}
          note={t("dist.kpi.shippedNote", { share: pct(distributed ? shipped / distributed : 0) })}
        />
      </div>

      <Section title={t("dist.findings.title")}>
        <Findings items={d.findings} />
      </Section>

      <Section title={t("dist.regions.title")} hint={t("dist.regions.hint")}>
        <Matrix
          head={[
            t("dist.regions.region"),
            t("dist.regions.units"),
            t("dist.regions.share"),
            t("dist.regions.pieces"),
            t("dist.regions.shipped"),
            "",
          ]}
          rows={[...d.regions].map(([region, units]) => {
            const pieces = sum(d.plans.map((p) => p.byRegion.get(region) ?? 0));
            return {
              key: region,
              cells: [
                d.tsms.has(region) ? (
                  <Link href="/distribution/plan#tsm" className="hover:underline">
                    {region} · TSM {d.tsms.get(region)!.size}
                  </Link>
                ) : (
                  region
                ),
                fmt(sumUnits(units)),
                pct(baseUnits ? sumUnits(units) / baseUnits : 0),
                fmt(pieces),
                <N key="s" value={regionShipped(region)} />,
                <Link
                  key="w"
                  href={`/distribution/plan/${encodeURIComponent(region)}`}
                  className="text-primary text-xs hover:underline"
                >
                  {t("dist.regions.waybill")}
                </Link>,
              ],
            };
          })}
          foot={[t("dist.total"), fmt(baseUnits), "100%", fmt(distributed), fmt(shipped), ""]}
        />
      </Section>

      <Section title={t("dist.coverage.title")} hint={t("dist.coverage.hint")}>
        <Matrix
          dense
          head={[t("dist.coverage.category"), ...DIST_TYPES.map((type) => type.label)]}
          rows={[
            {
              key: "base",
              muted: true,
              cells: [
                t("dist.coverage.base"),
                ...DIST_TYPES.map((type) => fmt(d.total[type.code] ?? 0)),
              ],
            },
            ...cover.map((c) => ({
              key: c.category,
              cells: [
                c.category,
                ...DIST_TYPES.map((type) =>
                  c.byType[type.code] === 0 && (d.total[type.code] ?? 0) > 0 ? (
                    <span key={type.code} className="font-semibold text-red-600 dark:text-red-400">
                      0
                    </span>
                  ) : (
                    c.byType[type.code]
                  ),
                ),
              ],
            })),
          ]}
        />
      </Section>

      <Section title={t("dist.control.title")} hint={t("dist.control.hint")}>
        <Matrix
          head={[
            t("dist.control.posm"),
            t("dist.control.types"),
            t("dist.control.covered"),
            t("dist.control.available"),
            t("dist.control.need"),
            t("dist.control.balance"),
            t("dist.control.perUnit"),
          ]}
          rows={d.controls
            .filter((c) => tagPrice(c.item.name) === null || !hasPlanogramPrices)
            .map((c) => ({
              key: c.item.id,
              cells: [
                <Link key="n" href={`/distribution/posm/${c.item.id}`} className="hover:underline">
                  {c.item.name}
                </Link>,
                c.typesMarked,
                fmt(c.covered),
                fmt(c.available),
                c.need === null ? (
                  <span key="x" className="text-muted-foreground text-xs">
                    {t("dist.control.noNorm")}
                  </span>
                ) : (
                  fmt(c.need)
                ),
                <Balance key="b" value={c.balance} />,
                <span
                  key="p"
                  className={c.perUnit < 0.9 ? "text-amber-600 dark:text-amber-400" : ""}
                >
                  {c.perUnit.toFixed(2)}
                </span>,
              ],
            }))}
        />
      </Section>

      <Section title={t("dist.tags.title")} hint={t("dist.tags.hint")}>
        {hasPlanogramPrices ? (
          <Matrix
            head={[
              t("dist.tags.price"),
              t("dist.tags.need"),
              t("dist.tags.available"),
              t("dist.tags.balance"),
              t("dist.tags.items"),
            ]}
            rows={tags.map((tag) => ({
              key: String(tag.price),
              cells: [
                fmt(tag.price),
                fmt(tag.need),
                fmt(tag.available),
                <Balance key="b" value={tag.available - tag.need} />,
                <span key="i" className="text-muted-foreground text-xs whitespace-normal">
                  {tag.items.join(", ") || "—"}
                </span>,
              ],
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("dist.tags.none")}</p>
        )}
      </Section>
    </div>
  );
}
