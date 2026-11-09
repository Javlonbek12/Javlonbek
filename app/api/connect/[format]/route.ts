import { isExportLocale, t } from "@/lib/i18n";
import { withExportLocale } from "@/lib/i18n/server";
import { connectPptx } from "@/modules/connect/pptx";
import {
  buildConnectReport,
  leadScope,
  loadConnectAccess,
  parseConnectQuery,
  scopeConnectQuery,
} from "@/modules/connect/report";
import { canLeadConnect, canSeeConnect } from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getUserToday } from "@/modules/core/settings/service";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

// GET /api/connect/xlsx|pptx?view=…&preset=…|from=…&to=…&person=…&lang=ru|en|ko — what the page
// shows, in the language chosen before downloading.
export async function GET(request: Request, { params }: RouteContext<"/api/connect/[format]">) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeConnect(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const search = new URL(request.url).searchParams;
  const lang = search.get("lang");
  // The whole file (texts, numbers, dates, known data values, its name) is in the chosen
  // language; without a known one, in the user's.
  return withExportLocale(isExportLocale(lang) ? lang : user.locale, async () => {
    const { format } = await params;
    if (format !== "xlsx" && format !== "pptx")
      return Response.json({ error: "format" }, { status: 400 });
    const canLead = canLeadConnect(user);
    const access = await loadConnectAccess();
    // An employee downloads only their own list (see scopeConnectQuery), a manager their TSMs.
    const { query, own } = scopeConnectQuery(
      parseConnectQuery(Object.fromEntries(search), canLead),
      canLead,
      access.people,
      user.id,
      access.positions,
    );
    if (own && !own.length) return Response.json({ error: "empty" }, { status: 404 });
    const scope = canLead
      ? leadScope(user, access.people, access.positions)
      : own
        ? new Set(own)
        : null;
    const today = await getUserToday(user.id);
    const report = await buildConnectReport(query, today, scope, {
      hierarchy: access.positions.hierarchy,
      own: own !== null,
    });
    if (report.empty || (query.view === "executor" && !report.query.person))
      return Response.json({ error: "empty" }, { status: 404 });
    const body =
      format === "xlsx" ? await connectXlsx(report, today) : await connectPptx(report, today);
    const name = [
      t("connect.title"),
      t(`connect.views.${query.view}`),
      report.query.person,
      `${report.period.from}–${report.period.to}`,
    ]
      .filter(Boolean)
      .join(" — ")
      // A code with a slash («KA / TSM_TST_2») must not make folders.
      .replace(/[\\/:*?"<>|]+/g, " ");
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": TYPES[format],
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${format}`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
