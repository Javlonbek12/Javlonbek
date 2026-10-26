import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { plannedOutlets, replacementXlsx } from "@/modules/distribution/campaign";
import { canSeeDistribution } from "@/modules/distribution/service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET /api/distribution/campaigns/[id]/replacement — the outlets to replace in, with a column to
// fill in («Заменено»); the same file is uploaded back on the campaign page.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/distribution/campaigns/[id]/replacement">,
) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const outlets = await plannedOutlets((await params).id);
  if (outlets.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(await replacementXlsx(outlets)), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("Замена POSM.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}
