import Link from "next/link";

import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { canManagePlanograms } from "@/modules/planograms/access";
import { describeGeometry, parseGeometry } from "@/modules/planograms/geometry";
import { listEquipment } from "@/modules/planograms/library";

export default async function EquipmentPage({ searchParams }: PageProps<"/planograms/equipment">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const items = await listEquipment();
  return (
    <div className="flex flex-col gap-3">
      <PlanogramErrorNote error={error} />
      {canManagePlanograms(user.role) && (
        <Button asChild size="sm" className="self-start">
          <Link href="/planograms/equipment/new">{t("planograms.library.equipment.new")}</Link>
        </Button>
      )}
      {items.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("planograms.library.empty")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((e) => (
          <Link key={e.id} href={`/planograms/equipment/${e.id}`}>
            <Card className="hover:bg-accent/50 gap-1">
              <CardTitle>{e.name}</CardTitle>
              <CardDescription>
                {e.code} · {e.channel} · {describeGeometry(parseGeometry(e.geometry))}
              </CardDescription>
              <CardDescription>
                {t("planograms.library.equipment.used", { count: String(e._count.planograms) })}
              </CardDescription>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
