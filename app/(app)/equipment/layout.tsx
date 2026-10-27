import { EquipmentTabs } from "@/components/equipment/tabs";
import { t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { canManageDistribution } from "@/modules/distribution/service";

// The equipment section: one place for the equipment of the planograms and the POSM
// distribution (models, sizes, quantities, uploads), so whoever has either sees it.
export default async function EquipmentLayout({ children }: LayoutProps<"/equipment">) {
  const user = await requireModule("distribution", "planograms");
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("equip.title")}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t("equip.intro")}</p>
      </div>
      <EquipmentTabs manage={canManageDistribution(user)} />
      {children}
    </div>
  );
}
