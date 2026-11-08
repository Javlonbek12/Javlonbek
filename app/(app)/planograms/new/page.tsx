import { notFound } from "next/navigation";

import { NewPlanogramForm } from "@/components/planograms/new-planogram-form";
import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { getUserToday } from "@/modules/core/settings/service";
import { canManagePlanograms } from "@/modules/planograms/access";
import { describeGeometry, parseGeometry } from "@/modules/planograms/geometry";
import { priceListDate } from "@/modules/planograms/price-status";
import { listPriceLists } from "@/modules/planograms/pricing";
import { currentPriceList } from "@/modules/planograms/service";

const FIELDS = [
  "equipmentId",
  "title",
  "channel",
  "project",
  "priceListId",
  "validFrom",
  "validTo",
  "templateId",
  "fill",
];

export default async function NewPlanogramPage({ searchParams }: PageProps<"/planograms/new">) {
  const user = await requireUser();
  if (!canManagePlanograms(user.role)) notFound();
  const query = await searchParams;
  const [equipment, templates, priceLists, current] = await Promise.all([
    db.equipment.findMany({ orderBy: { name: "asc" } }),
    db.planogram.findMany({
      where: { isTemplate: true },
      select: { id: true, title: true, equipmentId: true },
      orderBy: { title: "asc" },
    }),
    getUserToday(user.id).then((today) => listPriceLists(today)),
    getUserToday(user.id).then((today) => currentPriceList(today)),
  ]);
  // Back from an error: what was typed; otherwise the prices in force today.
  const values: Record<string, string> = Object.fromEntries(
    FIELDS.flatMap((key) => (typeof query[key] === "string" ? [[key, query[key]]] : [])),
  );
  if (typeof query.error !== "string") values.priceListId = current?.id ?? "";

  return (
    <div className="flex flex-col gap-4">
      <PlanogramErrorNote error={query.error} />
      <NewPlanogramForm
        equipment={equipment.map((e) => ({
          id: e.id,
          label: `${e.name} (${e.channel}, ${describeGeometry(parseGeometry(e.geometry))})`,
        }))}
        templates={templates.map((tpl) => ({
          id: tpl.id,
          label: tpl.title,
          equipmentId: tpl.equipmentId,
        }))}
        priceLists={priceLists.map((p) => ({
          id: p.id,
          label: `${p.name} · ${priceListDate(p.effectiveFrom)} · ${t(`planograms.library.prices.status.${p.status}`).toLowerCase()}`,
        }))}
        values={values}
      />
    </div>
  );
}
