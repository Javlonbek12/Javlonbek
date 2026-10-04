import { notFound } from "next/navigation";

import { EquipmentForm } from "@/components/planograms/equipment-form";
import { PlanogramErrorNote, SavedNote } from "@/components/planograms/error-note";
import { db } from "@/lib/db";
import { requireUser } from "@/modules/core/auth/current-user";
import { parseGeometry } from "@/modules/planograms/geometry";

export default async function EquipmentEditPage({
  params,
  searchParams,
}: PageProps<"/planograms/equipment/[id]">) {
  await requireUser();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const item = await db.equipment.findUnique({
    where: { id },
    include: { _count: { select: { planograms: true } } },
  });
  if (!item) notFound();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{item.name}</h2>
      <PlanogramErrorNote error={error} />
      <SavedNote show={saved} />
      <EquipmentForm
        id={item.id}
        code={item.code}
        name={item.name}
        channel={item.channel}
        geometry={parseGeometry(item.geometry)}
        locked={item._count.planograms > 0}
      />
    </div>
  );
}
