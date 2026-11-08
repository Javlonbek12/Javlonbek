import { requireModule } from "@/modules/core/access/guard";
import { PlanogramTabs } from "@/components/planograms/planogram-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";

export default async function PlanogramsLayout({ children }: LayoutProps<"/planograms">) {
  await requireModule("planograms");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("planograms.title")} className="print:hidden" />
      <PlanogramTabs />
      {children}
    </div>
  );
}
