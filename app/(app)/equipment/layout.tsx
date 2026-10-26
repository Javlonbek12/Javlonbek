import { EquipmentTabs } from "@/components/equipment/tabs";
import { t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";

// The equipment section: the same data as the POSM distribution (equipment file), so the same
// access.
export default async function EquipmentLayout({ children }: LayoutProps<"/equipment">) {
  await requireModule("distribution");
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("equip.title")}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t("equip.intro")}</p>
      </div>
      <EquipmentTabs />
      {children}
    </div>
  );
}
