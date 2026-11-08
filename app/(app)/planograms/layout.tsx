import { requireModule } from "@/modules/core/access/guard";
import { PlanogramTabs } from "@/components/planograms/planogram-tabs";
import { t } from "@/lib/i18n";

export default async function PlanogramsLayout({ children }: LayoutProps<"/planograms">) {
  await requireModule("planograms");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-medium md:text-2xl print:hidden">{t("planograms.title")}</h1>
      <PlanogramTabs />
      {children}
    </div>
  );
}
