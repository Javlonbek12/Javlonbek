import { exportPdf, exportPptx, planogramIdsForProject } from "@/modules/planograms/export";
import { exportFormat, fileResponse, requireRequestUser } from "@/modules/planograms/http";

// GET /api/planograms/export?project=<name>&format=pptx|pdf — every planogram of a project in one file.
export async function GET(request: Request) {
  if (!(await requireRequestUser(request)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const project = url.searchParams.get("project") ?? "";
  const format = exportFormat(url.searchParams.get("format"));
  if (!project || (format !== "pptx" && format !== "pdf"))
    return Response.json({ error: "bad request" }, { status: 400 });
  const ids = await planogramIdsForProject(project);
  if (ids.length === 0) return Response.json({ error: "not found" }, { status: 404 });
  return fileResponse(
    format === "pptx" ? await exportPptx(ids) : await exportPdf(ids),
    format,
    project,
  );
}
