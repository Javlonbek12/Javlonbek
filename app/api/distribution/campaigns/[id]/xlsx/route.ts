import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { campaignListXlsx, loadCampaign } from "@/modules/distribution/campaign";
import { canSeeDistribution } from "@/modules/distribution/service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET /api/distribution/campaigns/[id]/xlsx — the campaign's POSM list with sizes and prices.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/distribution/campaigns/[id]/xlsx">,
) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const campaign = await loadCampaign((await params).id);
  if (!campaign || campaign.items.length === 0)
    return Response.json({ error: "not found" }, { status: 404 });
  const name = `${campaign.order.name} — POSM.xlsx`;
  return new Response(new Uint8Array(await campaignListXlsx(campaign)), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
