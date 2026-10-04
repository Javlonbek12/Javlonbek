import { EquipmentForm } from "@/components/planograms/equipment-form";
import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";

export default async function NewEquipmentPage({
  searchParams,
}: PageProps<"/planograms/equipment/new">) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("planograms.library.equipment.new")}</h2>
      <PlanogramErrorNote error={error} />
      <EquipmentForm
        id={null}
        code=""
        name=""
        channel=""
        geometry={{ header: null, shelves: [{ slots: 6, offset: 0, group: 0 }] }}
        locked={false}
      />
    </div>
  );
}
