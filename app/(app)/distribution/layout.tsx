import { DistributionTabs } from "@/components/distribution/tabs";
import { t } from "@/lib/i18n";
import { requireModule } from "@/modules/core/access/guard";
import { canManageDistribution } from "@/modules/distribution/service";

export default async function DistributionLayout({ children }: LayoutProps<"/distribution">) {
  const user = await requireModule("distribution");
  return (
    <div className="flex flex-col gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-1 print:hidden">
        <h1 className="text-[22px] font-medium md:text-2xl">{t("dist.title")}</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">{t("dist.intro")}</p>
      </div>
      <DistributionTabs manage={canManageDistribution(user)} />
      {children}
    </div>
  );
}
