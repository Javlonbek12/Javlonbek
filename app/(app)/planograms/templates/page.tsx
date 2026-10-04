import { PlanogramList } from "@/components/planograms/planogram-list";
import { requireUser } from "@/modules/core/auth/current-user";
import { listPlanograms } from "@/modules/planograms/service";

export default async function TemplatesPage() {
  await requireUser();
  return <PlanogramList items={await listPlanograms({ templates: true })} />;
}
