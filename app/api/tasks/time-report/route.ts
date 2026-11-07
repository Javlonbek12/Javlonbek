import { todayInTimezone } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getSettings } from "@/modules/core/settings/service";
import { parsePeriod } from "@/modules/reports/period";
import { getTimeReport } from "@/modules/tasks/time-report";
import { timeReportXlsx } from "@/modules/tasks/time-report-xlsx";

// GET /api/tasks/time-report?preset=… or ?from=…&to=… — the time report in Excel.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { timezone } = await getSettings(user.id);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const period = parsePeriod(query, todayInTimezone(timezone));
  const body = await timeReportXlsx(await getTimeReport(user, period, timezone));
  const name = `${t("tasks.views.time")} ${period.from} – ${period.to}.xlsx`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
