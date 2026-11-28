import { SopEmpty } from "@/components/sop/empty";
import { StockView } from "@/components/sop/stock";
import { filterStock, parseStockView } from "@/modules/sop/filter";
import { loadSopData } from "@/modules/sop/load";

// «Запасы и прогноз»: every SKU with its stock and months of stock over the plan.
export default async function SopStockPage({ searchParams }: PageProps<"/sop/stock">) {
  const [data, params] = await Promise.all([loadSopData(), searchParams]);
  const { report } = data;
  if (!report) return <SopEmpty broken={data.broken} />;
  const view = parseStockView(params.view);
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  return (
    <StockView
      stats={filterStock(report.stats, view, q)}
      all={report.stats}
      view={view}
      q={q}
      closed={report.months.closed}
      horizon={report.months.horizon}
      settings={data.settings}
    />
  );
}
