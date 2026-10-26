import { t } from "@/lib/i18n";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { catalogXlsx, loadCatalog } from "@/modules/distribution/catalog";
import { canSeeDistribution } from "@/modules/distribution/service";

// GET /api/distribution/sizes[?missing=1] — the sizes catalog (or just what to fill in) as Excel;
// the same file, filled in, is uploaded back on the sizes page.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const onlyMissing = new URL(request.url).searchParams.get("missing") === "1";
  const file = await catalogXlsx(await loadCatalog(), onlyMissing);
  const name = `${onlyMissing ? t("dist.sizes.fileMissing") : t("dist.sizes.fileAll")} — ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
