import { t } from "@/lib/i18n";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { canSeeDistribution, loadDistribution } from "@/modules/distribution/service";
import { distributionXlsx } from "@/modules/distribution/xlsx";

// GET /api/distribution/xlsx — the plan, TSM split, stock, shipments and waybills as Excel.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const data = await loadDistribution();
  if (data.items.length === 0) return Response.json({ error: "empty" }, { status: 404 });
  const name = `${t("dist.title")} — ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(await distributionXlsx(data)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
