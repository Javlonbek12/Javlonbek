import { EquipmentTabs } from "@/components/equipment/tabs";
import { InfoHint } from "@/components/ui/info-hint";
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
      <div className="flex flex-wrap items-center gap-x-1 print:hidden">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("equip.title")}</h1>
        <InfoHint className="max-w-3xl">{t("equip.intro")}</InfoHint>
      </div>
      <EquipmentTabs manage={canManageDistribution(user)} toCheck={toCheck} />
      {children}
    </div>
  );
}
