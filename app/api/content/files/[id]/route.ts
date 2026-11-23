import { stat } from "node:fs/promises";

import { fileStream } from "@/lib/file-stream";
import { LONG_CACHE, THUMBABLE, thumbnail, thumbWidth } from "@/lib/thumbnails";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getPostFile } from "@/modules/content/files";

// A post's file. Photos and videos are shown inline (their type was checked by their bytes on
// upload); other files are always downloaded. Videos support Range requests, so they can be played.
// ?w=… gives a photo as a small WebP copy (thumbnails in the plan, the post preview).
export async function GET(request: Request, { params }: RouteContext<"/api/content/files/[id]">) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const found = await getPostFile(user, id);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  let size: number;
  try {
    size = (await stat(found.absolutePath)).size;
  } catch {
    return Response.json({ error: "file is missing" }, { status: 404 });
  }
  const { file } = found;
  const query = new URL(request.url).searchParams;
  const download = file.kind === "FILE" || query.has("download");

  const width = thumbWidth(query.get("w"));
  if (width && !download && file.kind === "PHOTO" && THUMBABLE.has(file.mime)) {
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

  const headers: Record<string, string> = {
    "Content-Type": file.kind === "FILE" ? "application/octet-stream" : file.mime,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Cache-Control": LONG_CACHE,
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(fileStream(found.absolutePath, { start, end }), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(fileStream(found.absolutePath), {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
