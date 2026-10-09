import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getPostFile } from "@/modules/content/files";

// A post's file. Photos and videos are shown inline (their type was checked by their bytes on
// upload); other files are always downloaded. Videos support Range requests, so they can be played.
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
  const download = file.kind === "FILE" || new URL(request.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": file.kind === "FILE" ? "application/octet-stream" : file.mime,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(found.absolutePath, { start, end }));
    return new Response(stream as ReadableStream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(found.absolutePath));
  return new Response(stream as ReadableStream, {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
