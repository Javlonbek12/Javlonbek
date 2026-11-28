import { t } from "@/lib/i18n";
import { withLocale } from "@/lib/i18n/server";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getUserToday } from "@/modules/core/settings/service";
import { loadSopDataFor } from "@/modules/sop/load";
import { canUseSop, SOP_UPLOAD_COOKIE } from "@/modules/sop/service";
import { monthLabel } from "@/modules/sop/texts";
import { sopXlsx } from "@/modules/sop/xlsx";

// GET /api/sop/xlsx[?part=caps][&upload=<id>] — the upload on screen (the one picked on the
// pages, or the one named) as an Excel file in the user's language; `part=caps` gives the
// shipment caps alone.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canUseSop(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const search = new URL(request.url).searchParams;
  return withLocale(user.locale, async () => {
    const picked =
      search.get("upload") ??
      (request.headers.get("cookie") ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${SOP_UPLOAD_COOKIE}=`))
        ?.slice(SOP_UPLOAD_COOKIE.length + 1);
    const data = await loadSopDataFor(
      await getUserToday(user.id),
      (uploads) => uploads.find((u) => u.id === picked) ?? uploads[0] ?? null,
    );
    if (!data.report || !data.upload) return Response.json({ error: "empty" }, { status: 404 });
    const part = search.get("part") === "caps" ? "caps" : undefined;
    const body = await sopXlsx({
      report: data.report,
      settings: data.settings,
      marks: data.marks,
      part,
    });
    const name = [
      t("sop.xlsx.file", { cycle: monthLabel(data.upload.cycle) }),
      part ? t("sop.xlsx.caps") : null,
    ]
      .filter(Boolean)
      .join(" — ")
      .replace(/[\\/:*?"<>|]+/g, " ");
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // The month has an apostrophe («Nov'26»): in this header it must be escaped too.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          `${name}.xlsx`,
        ).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
