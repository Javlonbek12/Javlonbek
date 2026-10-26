import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { loadCampaign } from "@/modules/distribution/campaign";
import { buildEas, easData, easHtml } from "@/modules/distribution/eas";
import { canSeeDistribution } from "@/modules/distribution/service";

// GET /api/distribution/campaigns/[id]/eas — the EAS document as a Word file (HTML that Word
// opens with its tables).
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/distribution/campaigns/[id]/eas">,
) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const campaign = await loadCampaign((await params).id);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });
  const doc = buildEas(campaign, await easData(campaign));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>EAS</title></head><body>${easHtml(doc)}</body></html>`;
  const name = `EAS — ${campaign.order.name}.doc`;
  return new Response(html, {
    headers: {
      "Content-Type": "application/msword; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
