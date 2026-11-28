import { SopEmpty } from "@/components/sop/empty";
import { MaterialsView } from "@/components/sop/materials";
import { loadSopData } from "@/modules/sop/load";

// «Материалы»: the packaging bought for our SKUs against the production plan.
export default async function SopMaterialsPage({ searchParams }: PageProps<"/sop/materials">) {
  const [data, params] = await Promise.all([loadSopData(), searchParams]);
  const { report } = data;
  if (!report) return <SopEmpty broken={data.broken} />;
  return (
    <MaterialsView
      rows={report.materials}
      sheet={report.ctx.model.materials?.sheet ?? null}
      onlyFlagged={params.risk === "1"}
    />
  );
}
