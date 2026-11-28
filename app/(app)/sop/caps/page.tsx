import { CapsView } from "@/components/sop/caps";
import { SopEmpty } from "@/components/sop/empty";
import { loadSopData } from "@/modules/sop/load";

// «Лимиты отгрузки»: what to tell the sales team after S&OP.
export default async function SopCapsPage() {
  const data = await loadSopData();
  if (!data.report) return <SopEmpty broken={data.broken} />;
  return (
    <CapsView rows={data.report.caps} settings={data.settings} download="/api/sop/xlsx?part=caps" />
  );
}
