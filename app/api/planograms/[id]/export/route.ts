import { exportPdf, exportPptx, planogramPng, slideTitle } from "@/modules/planograms/export";
import { exportFormat, fileResponse, requireRequestUser } from "@/modules/planograms/http";
import { loadPlanogram } from "@/modules/planograms/repository";

// GET /api/planograms/<id>/export?format=pptx|pdf|png
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/planograms/[id]/export">,
) {
  if (!(await requireRequestUser(request)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const format = exportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return Response.json({ error: "format" }, { status: 400 });
  const loaded = await loadPlanogram(id);
  if (!loaded) return Response.json({ error: "not found" }, { status: 404 });
  const name = `${slideTitle(loaded)} v${loaded.record.version}`;
  if (format === "png") return fileResponse(await planogramPng(loaded), "png", name);
  return fileResponse(
    format === "pptx" ? await exportPptx([id]) : await exportPdf([id]),
    format,
    name,
  );
}
