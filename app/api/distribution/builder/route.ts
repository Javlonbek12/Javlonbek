import { t } from "@/lib/i18n";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { builderOptions, builderXlsx, runBuilder } from "@/modules/distribution/catalog";
import { canSeeDistribution } from "@/modules/distribution/service";

// GET /api/distribution/builder?t=…&e=…&reserve=…&stock=…&merge=… — the builder's order as Excel.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeDistribution(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const options = builderOptions((key) => query.getAll(key));
  const { catalog, lines } = await runBuilder(options);
  if (lines.length === 0) return Response.json({ error: "empty" }, { status: 404 });
  const name = `${t("dist.builder.file")} — ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(await builderXlsx(lines, catalog, options.reservePct)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
