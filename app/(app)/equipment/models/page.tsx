import Link from "next/link";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { describeGeometry, parseGeometry } from "@/modules/planograms/geometry";
import { db } from "@/lib/db";
import { canSeeDistribution } from "@/modules/distribution/service";
import { typeInfo } from "@/modules/distribution/types";
import { listEquipment } from "@/modules/planograms/library";

// Installed (equipment file) and in warehouses, by type: for those who see the distribution.
async function countsByType() {
  const [installed, stock] = await Promise.all([
    db.distUnit.groupBy({ by: ["type"], _sum: { units: true } }),
    db.distEquipmentCount.groupBy({
      by: ["type"],
      where: { kind: "STOCK", tsm: "" },
      _sum: { count: true },
    }),
  ]);
  return {
    installed: new Map(installed.map((r) => [r.type, r._sum.units ?? 0])),
    stock: new Map(stock.map((r) => [r.type, r._sum.count ?? 0])),
  };
}

const n = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);

export default async function EquipmentPage({ searchParams }: PageProps<"/equipment/models">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const items = await listEquipment();
  const counts = canSeeDistribution(user) ? await countsByType() : null;
  const sum = (map: Map<string, number>, types: string[]) =>
    types.reduce((s, type) => s + (map.get(type) ?? 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <PlanogramErrorNote error={error} />
      {canManagePlanograms(user.role) && (
        <Button asChild size="sm" className="self-start">
          <Link href="/equipment/models/new">{t("planograms.library.equipment.new")}</Link>
        </Button>
      )}
      {items.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.empty")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((e) => (
          <Link key={e.id} href={`/equipment/models/${e.id}`}>
            <Card className="hover:bg-accent/50 gap-1">
              <CardTitle>{e.name}</CardTitle>
              <CardDescription>
                {e.code} · {e.channel} · {describeGeometry(parseGeometry(e.geometry))}
              </CardDescription>
              <CardDescription>
                {t("planograms.library.equipment.used", { count: String(e._count.planograms) })}
              </CardDescription>
              <CardDescription className="text-xs">
                {e.distTypes.length
                  ? `${t("planograms.library.equipment.types")}: ${e.distTypes
                      .map((type) => typeInfo(type)?.label ?? type)
                      .join(", ")}`
                  : t("planograms.library.equipment.noTypes")}
              </CardDescription>
              {counts && e.distTypes.length > 0 && (
                <CardDescription className="text-foreground text-xs font-medium">
                  {t("planograms.library.equipment.installed", {
                    installed: n(sum(counts.installed, e.distTypes)),
                    stock: n(sum(counts.stock, e.distTypes)),
                  })}
                </CardDescription>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
