import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getSettings } from "@/modules/core/settings/service";
import { todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { canSeeReports } from "@/modules/reports/access";
import { buildReport } from "@/modules/reports/data";
import { parsePeriod } from "@/modules/reports/period";
import { reportPdf } from "@/modules/reports/pdf";
import { reportXlsx } from "@/modules/reports/xlsx";

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

// GET /api/reports/pdf|xlsx?preset=… or ?from=…&to=…
export async function GET(request: Request, { params }: RouteContext<"/api/reports/[format]">) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeReports(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { format } = await params;
  if (format !== "pdf" && format !== "xlsx")
    return Response.json({ error: "format" }, { status: 400 });
  const { timezone } = await getSettings(user.id);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const period = parsePeriod(query, todayInTimezone(timezone));
  const report = await buildReport(period, timezone);
  const body = format === "pdf" ? await reportPdf(report) : await reportXlsx(report);
  const name = `${t("reports.title")} ${period.from} – ${period.to}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
