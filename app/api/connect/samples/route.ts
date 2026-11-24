import type { ConnectKind } from "@/lib/generated/prisma/enums";
import { t } from "@/lib/i18n";
import { withExportLocale } from "@/lib/i18n/server";
import { sampleGuide } from "@/modules/connect/sample-guide";
import { CONNECT_SAMPLES, connectSampleWorkbook } from "@/modules/connect/samples";
import { canLeadConnect } from "@/modules/connect/service";
import { getUserFromRequest } from "@/modules/core/auth/request-user";

// GET /api/connect/samples[?kind=ROUTE] — an Excel file with a sample sheet for every kind of
// data the upload page takes (or for one kind), and a first sheet that says what each one is and
// where it is exported from. For those who upload. The rows are made up; the importer leaves
// them out (see SAMPLE_MARK), so the file itself can be uploaded and changes nothing.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canLeadConnect(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  const asked = new URL(request.url).searchParams.get("kind");
  const sample = asked === null ? null : CONNECT_SAMPLES.find((s) => s.kind === asked);
  if (asked !== null && !sample) return Response.json({ error: "kind" }, { status: 400 });
  const kinds: ConnectKind[] | undefined = sample ? [sample.kind] : undefined;
  return withExportLocale(user.locale, async () => {
    const body = await connectSampleWorkbook({ kinds, guide: sampleGuide(kinds) });
    const name = (
      sample
        ? `${t("connect.samples.fileOne")} — ${t(`connect.kinds.${sample.kind}`)}`
        : t("connect.samples.fileAll")
    ).replace(/[\\/:*?"<>|]+/g, " ");
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.xlsx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
