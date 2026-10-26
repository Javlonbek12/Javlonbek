import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getCampaignFile } from "@/modules/distribution/campaign";

// A campaign's file. Pictures (their type was checked by their bytes on upload) are shown inline,
// everything else is downloaded.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/distribution/files/[id]">,
) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const found = await getCampaignFile(user, id);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  let size: number;
  try {
    size = (await stat(found.absolutePath)).size;
  } catch {
    return Response.json({ error: "file is missing" }, { status: 404 });
  }
  const { file } = found;
  const inline =
    file.mime.startsWith("image/") && !new URL(request.url).searchParams.has("download");
  const stream = Readable.toWeb(createReadStream(found.absolutePath));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
