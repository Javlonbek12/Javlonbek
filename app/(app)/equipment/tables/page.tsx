import Link from "next/link";

import { Section } from "@/components/connect/parts";
import { fmt, Matrix, N } from "@/components/distribution/parts";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { sumUnits, type Count, type Units } from "@/modules/distribution/compute";
import { canManageDistribution, loadDistribution } from "@/modules/distribution/service";
import { DIST_TYPES, sortRegions, tsmDestination } from "@/modules/distribution/types";

import { setIncludeStockAction } from "../../distribution/actions";

function unitsBy(counts: Count[], pick: (c: Count) => string | null): Map<string, Units> {
  const out = new Map<string, Units>();
  for (const c of counts) {
    const key = pick(c);
    if (key === null) continue;
    const units = out.get(key) ?? {};
    units[c.type] = (units[c.type] ?? 0) + c.count;
    out.set(key, units);
  }
  return out;
}

function UnitsTable({
  title,
  data,
  ordered,
  muted = [],
}: {
  title: string;
  data: Map<string, Units>;
  ordered: string[];
  muted?: string[];
}) {
  const total: Units = {};
  for (const u of data.values())
    for (const [k, v] of Object.entries(u)) total[k] = (total[k] ?? 0) + v;
  return (
    <Matrix
      dense
      head={[title, ...DIST_TYPES.map((type) => type.label), t("dist.total")]}
      rows={ordered.map((key) => ({
        key,
        muted: muted.includes(key),
        cells: [
          key,
          ...DIST_TYPES.map((type) => (
            <N key={type.code} value={data.get(key)?.[type.code] ?? 0} />
          )),
          <strong key="t">{fmt(sumUnits(data.get(key)))}</strong>,
        ],
      }))}
      foot={[
        t("dist.total"),
        ...DIST_TYPES.map((type) => fmt(total[type.code] ?? 0)),
        fmt(sumUnits(total)),
      ]}
    />
  );
}

// Equipment by region (installed, in warehouses, the base), each region by TSM, and the link
// between equipment types and the planogram library.
export default async function DistributionEquipmentPage() {
  const user = await requireUser();
  const d = await loadDistribution();
  const regions = sortRegions(d.counts.map((c) => c.region));
  const installed = unitsBy(d.counts, (c) => (c.kind === "INSTALLED" && !c.tsm ? c.region : null));
  const stock = unitsBy(d.counts, (c) => (c.kind === "STOCK" && !c.tsm ? c.region : null));
  // Each region by TSM; what no TSM answers for is a row of its own.
  const tsm = new Map<string, Units>();
  const noTsm: string[] = [];
  for (const [region, people] of d.tsms) {
    const rest: Units = { ...installed.get(region) };
    for (const [name, units] of people) {
      tsm.set(tsmDestination(region, name), units);
      for (const [type, n] of Object.entries(units)) rest[type] = (rest[type] ?? 0) - n;
    }
    for (const type of Object.keys(rest)) if (Math.abs(rest[type]!) < 0.01) delete rest[type];
    if (Object.keys(rest).length) {
      const key = tsmDestination(region, t("dist.equipment.noTsm"));
      tsm.set(key, rest);
      noTsm.push(key);
    }
  }

  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <Section title={t("dist.equipment.installed")}>
        <UnitsTable title={t("dist.equipment.region")} data={installed} ordered={regions} />
      </Section>
      <Section title={t("dist.equipment.stock")}>
        <UnitsTable title={t("dist.equipment.region")} data={stock} ordered={regions} />
      </Section>
      <Section title={t("dist.equipment.base")}>
        {canManageDistribution(user) && (
          <form
            action={setIncludeStockAction}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span>{t("dist.equipment.includeStock")}:</span>
            <NativeSelect name="includeStock" defaultValue={d.includeStock ? "1" : "0"}>
              <option value="1">{t("dist.equipment.includeStockOn")}</option>
              <option value="0">{t("dist.equipment.includeStockOff")}</option>
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              {t("dist.equipment.save")}
            </Button>
          </form>
        )}
        <UnitsTable
          title={t("dist.equipment.region")}
          data={d.regions}
          ordered={[...d.regions.keys()]}
        />
      </Section>
      {tsm.size > 0 && (
        <Section title={t("dist.equipment.tsmTitle")} hint={t("dist.equipment.tsmHint")}>
          <UnitsTable
            title={t("dist.equipment.tsm")}
            data={tsm}
            ordered={[...tsm.keys()]}
            muted={noTsm}
          />
        </Section>
      )}
      <Section title={t("dist.equipment.planograms")} hint={t("dist.equipment.planogramsHint")}>
        <Matrix
          head={[
            t("dist.equipment.type"),
            t("dist.equipment.equipmentCode"),
            t("dist.equipment.planogram"),
            t("dist.equipment.slotsFile"),
            t("dist.equipment.slotsPlanogram"),
            t("dist.equipment.prices"),
          ]}
          rows={d.links.map((link) => {
            const type = DIST_TYPES.find((x) => x.code === link.type)!;
            const prices = Object.entries(link.facings).sort((a, b) => Number(a[0]) - Number(b[0]));
            return {
              key: link.type,
              cells: [
                type.label,
                <span key="e" className="text-muted-foreground text-xs">
                  {link.equipmentCode ?? "—"}
                </span>,
                link.planogramId ? (
                  <Link
                    key="p"
                    href={`/planograms/${link.planogramId}`}
                    className="text-primary whitespace-normal hover:underline"
                  >
                    {link.title}
                  </Link>
                ) : (
                  <span key="p" className="text-muted-foreground text-xs">
                    {t("dist.equipment.noPlanogram")}
                  </span>
                ),
                type.slots,
                link.slots ?? "—",
                <span key="c" className="text-xs whitespace-normal">
                  {prices.length
                    ? prices.map(([price, n]) => `${fmt(Number(price))} × ${n}`).join(", ")
                    : t("dist.equipment.noPrices")}
                </span>,
              ],
            };
          })}
        />
      </Section>
    </div>
  );
}
