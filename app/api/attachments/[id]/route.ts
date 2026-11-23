import { stat } from "node:fs/promises";

import { fileStream } from "@/lib/file-stream";

import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getAttachmentFile } from "@/modules/tasks/attachment-service";

// Download of an attached file. Only people who can see the task get it.
// Always served as a download (never rendered), so an uploaded HTML file can't run scripts.
export async function GET(request: Request, { params }: RouteContext<"/api/attachments/[id]">) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const found = await getAttachmentFile(user, id);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });

  let size: number;
  try {
    size = (await stat(found.absolutePath)).size;
  } catch {
    return Response.json({ error: "file is missing" }, { status: 404 });
  }
  // Streamed, not read into memory first: a big file starts downloading at once.
  return new Response(fileStream(found.absolutePath), {
    headers: {
      "Content-Length": String(size),
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(found.attachment.title)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
