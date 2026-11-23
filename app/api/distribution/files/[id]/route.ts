import { stat } from "node:fs/promises";

import { fileStream } from "@/lib/file-stream";
import { LONG_CACHE, THUMBABLE, thumbnail, thumbWidth } from "@/lib/thumbnails";

import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getCampaignFile } from "@/modules/distribution/campaign";

// A campaign's file. Pictures (their type was checked by their bytes on upload) are shown inline,
// everything else is downloaded. ?w=… gives a picture as a small WebP copy (the campaign page).
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
  const query = new URL(request.url).searchParams;
  const inline = file.mime.startsWith("image/") && !query.has("download");
  const width = thumbWidth(query.get("w"));
  if (width && inline && THUMBABLE.has(file.mime)) {
    const small = await thumbnail(found.absolutePath, file.path, { width });
    if (small)
      return new Response(new Uint8Array(small), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(small.length),
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Cache-Control": LONG_CACHE,
        },
      });
  }
  return new Response(fileStream(found.absolutePath), {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": LONG_CACHE,
    },
  });
}
