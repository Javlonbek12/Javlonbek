import Link from "next/link";
import { notFound } from "next/navigation";

import { Planogram3D } from "@/components/planograms/planogram-3d";
import { PlanogramStatusBadge } from "@/components/planograms/status-badge";
import { t } from "@/lib/i18n";
import { requireUser } from "@/modules/core/auth/current-user";
import { buildRenderInput } from "@/modules/planograms/export";
import { loadPlanogram } from "@/modules/planograms/repository";

// The planogram on its equipment in 3D.
export default async function Planogram3DPage({ params }: PageProps<"/planograms/[id]/3d">) {
  await requireUser();
  const { id } = await params;
  const loaded = await loadPlanogram(id);
  if (!loaded) notFound();
  const r = loaded.record;
  const input = await buildRenderInput(loaded);

  return (
    <div className="flex flex-col gap-3">
      <Link href={`/planograms/${r.id}`} className="text-muted-foreground text-sm hover:underline">
        ← {r.title}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">
          {t("planograms.view3d.title")}: {r.title}
        </h2>
        <PlanogramStatusBadge status={r.status} />
        <span className="text-muted-foreground text-sm">{r.equipment.name}</span>
      </div>
      <Planogram3D input={input} />
    </div>
  );
}
