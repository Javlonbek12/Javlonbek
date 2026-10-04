import { PlanogramErrorNote } from "@/components/planograms/error-note";
import { SkuForm } from "@/components/planograms/sku-form";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";

export default async function NewSkuPage({ searchParams }: PageProps<"/planograms/skus/new">) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("planograms.library.skus.new")}</h2>
      <PlanogramErrorNote error={error} />
      <SkuForm sku={null} />
    </div>
  );
}
