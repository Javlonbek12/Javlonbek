import { PlanogramList } from "@/components/planograms/planogram-list";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { listPlanograms } from "@/modules/planograms/service";

export default async function TemplatesPage() {
  await requireUser();
  const items = await listPlanograms({ templates: true });
  // Empty, the tab says how a template is made.
  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">{t("planograms.list.noTemplates")}</p>;
  return <PlanogramList items={items} />;
}
