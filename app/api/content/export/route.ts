import { addMonths, isDateString, startOfMonth, todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import type { ContentChannel } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";
import { canUseModule } from "@/modules/core/access/actor";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getSettings } from "@/modules/core/settings/service";
import { exportPlanXlsx } from "@/modules/content/excel";
import { CHANNELS } from "@/modules/content/service";

// GET /api/content/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&bot=PARTNER] — the plan as Excel.
// ?template=1 — an empty file with the columns, to fill in and upload.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canUseModule(user, "content")) return Response.json({ error: "forbidden" }, { status: 403 });
  // Texts in the file follow the user's language.
  return withLocale(user.locale, async () => {
    const query = new URL(request.url).searchParams;
    const { timezone } = await getSettings(user.id);
    const month = startOfMonth(todayInTimezone(timezone));
    const template = query.has("template");
    const from = isDateString(query.get("from") ?? "") ? query.get("from")! : month;
    const to = isDateString(query.get("to") ?? "") ? query.get("to")! : addMonths(month, 1);
    const bot = CHANNELS.find((c) => c === query.get("bot")) as ContentChannel | undefined;
    const body = await exportPlanXlsx(
      user,
      template ? "0001-01-01" : from,
      template ? "0001-01-01" : to,
      getEnv().APP_URL,
      bot,
    );
    const name = template
      ? `${t("content.title")} — ${t("content.excel.templateFile")}.xlsx`
      : `${t("content.title")} ${from} – ${to}.xlsx`;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
