import { EquipmentTabs } from "@/components/equipment/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { outletReview, reviewCount } from "@/modules/distribution/control";
import { canManageDistribution } from "@/modules/distribution/service";

// The equipment section: one place for the equipment of the planograms and the POSM
// distribution (models, sizes, quantities, uploads), so whoever has either sees it.
export default async function EquipmentLayout({ children }: LayoutProps<"/equipment">) {
  const user = await requireModule("distribution", "planograms");
  const toCheck = reviewCount(await outletReview());
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <PageHeader
        title={t("equip.title")}
        hint={t("equip.intro")}
        hintClassName="max-w-3xl"
        className="print:hidden"
      />
      <EquipmentTabs manage={canManageDistribution(user)} toCheck={toCheck} />
      {children}
    </div>
  );
}
