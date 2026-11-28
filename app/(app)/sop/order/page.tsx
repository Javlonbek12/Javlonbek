import { SopEmpty } from "@/components/sop/empty";
import { OrderView } from "@/components/sop/order";
import { loadSopData } from "@/modules/sop/load";

// «Заказ»: the factories by month, the calculation hint, the excise stamps.
export default async function SopOrderPage({ searchParams }: PageProps<"/sop/order">) {
  const [data, params] = await Promise.all([loadSopData(), searchParams]);
  const { report } = data;
  if (!report) return <SopEmpty broken={data.broken} />;
  return (
    <OrderView
      factories={report.factories}
      hints={report.hints}
      stamps={report.stamps}
      settings={data.settings}
      showAll={params.all === "1"}
    />
  );
}
