import { t } from "@/lib/i18n";
import { connectPptx } from "@/modules/connect/pptx";
import { buildConnectReport, parseConnectQuery } from "@/modules/connect/report";
import { canLeadConnect, canSeeConnect } from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getUserToday } from "@/modules/core/settings/service";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

// GET /api/connect/xlsx|pptx?view=…&from=…&to=…&city=…&channel=…&person=… — what the page shows.
export async function GET(request: Request, { params }: RouteContext<"/api/connect/[format]">) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeConnect(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { format } = await params;
  if (format !== "xlsx" && format !== "pptx")
    return Response.json({ error: "format" }, { status: 400 });
  const query = parseConnectQuery(
    Object.fromEntries(new URL(request.url).searchParams),
    canLeadConnect(user),
  );
  const report = await buildConnectReport(query, await getUserToday(user.id));
  if (report.empty || (query.view === "executor" && !report.query.person))
    return Response.json({ error: "empty" }, { status: 404 });
  const body = format === "xlsx" ? await connectXlsx(report) : await connectPptx(report);
  const name = [
    t("connect.title"),
    t(`connect.views.${query.view}`),
    report.query.person?.split(" - ").at(-1),
    new Date().toISOString().slice(0, 10),
  ]
    .filter(Boolean)
    .join(" — ");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${format}`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
