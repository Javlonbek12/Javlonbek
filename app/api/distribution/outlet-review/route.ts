import { canUseModule } from "@/modules/core/access/actor";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { outletReview, outletReviewXlsx } from "@/modules/distribution/control";

// GET /api/distribution/outlet-review — the outlet check (outlets the base lacks, rows without an
// ID, skipped rows, another region) as Excel, to send to whoever keeps the outlet base.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // The equipment section is open to whoever has planograms or POSM distribution.
  if (!canUseModule(user, "distribution") && !canUseModule(user, "planograms"))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const name = `Проверка точек — ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(await outletReviewXlsx(await outletReview())), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
