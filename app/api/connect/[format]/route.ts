import { t } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";
import { connectPptx } from "@/modules/connect/pptx";
import {
  buildConnectReport,
  leadScope,
  parseConnectQuery,
  scopeConnectQuery,
} from "@/modules/connect/report";
import { canLeadConnect, canSeeConnect, connectPeopleLinks } from "@/modules/connect/service";
import { connectXlsx } from "@/modules/connect/xlsx";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getUserToday } from "@/modules/core/settings/service";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

// GET /api/connect/xlsx|pptx?view=…&preset=…|from=…&to=…&person=… — what the page shows.
export async function GET(request: Request, { params }: RouteContext<"/api/connect/[format]">) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeConnect(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  // Texts in the file follow the user's language.
  return withLocale(user.locale, async () => {
    const { format } = await params;
    if (format !== "xlsx" && format !== "pptx")
      return Response.json({ error: "format" }, { status: 400 });
    const canLead = canLeadConnect(user);
    const links = await connectPeopleLinks();
    // An employee downloads only their own list (see scopeConnectQuery), a manager their TSMs.
    const { query, own } = scopeConnectQuery(
      parseConnectQuery(Object.fromEntries(new URL(request.url).searchParams), canLead),
      canLead,
      links,
      user.id,
    );
    if (own && !query.person) return Response.json({ error: "empty" }, { status: 404 });
    const scope = canLead ? leadScope(user, links) : own ? new Set(own) : null;
    const today = await getUserToday(user.id);
    const report = await buildConnectReport(query, today, scope);
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
