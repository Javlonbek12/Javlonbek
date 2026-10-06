import { readFile } from "node:fs/promises";

import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getContentImage, imageType } from "@/modules/content/service";

// The post's visual. Only images are stored (checked by their bytes on upload), so it is shown
// inline; ?download=1 saves it with its original name.
export async function GET(request: Request, { params }: RouteContext<"/api/content/[id]/image">) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const found = await getContentImage(user, id);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  let content: Buffer;
  try {
    content = await readFile(found.absolutePath);
  } catch {
    return Response.json({ error: "file is missing" }, { status: 404 });
  }
  const type = imageType(content);
  if (!type) return Response.json({ error: "not an image" }, { status: 415 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(found.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
}
