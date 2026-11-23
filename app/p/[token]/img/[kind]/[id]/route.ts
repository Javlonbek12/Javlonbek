import { db } from "@/lib/db";
import { readImage } from "@/modules/planograms/library";
import { pictureResponse } from "@/modules/planograms/picture-response";
import { findByShareToken } from "@/modules/planograms/service";

// Pictures for the public planogram page: only those used on the planogram behind this link (packs,
// POSM on the shelves, the header and the shelftalkers).
export async function GET(
  request: Request,
  { params }: RouteContext<"/p/[token]/img/[kind]/[id]">,
) {
  const { token, kind, id } = await params;
  const loaded = token.length >= 16 ? await findByShareToken(token) : null;
  if (!loaded) return new Response(null, { status: 404 });
  let relative: string | null = null;
  if (kind === "sku") {
    const used = Object.values(loaded.layout).some((c) => c.kind === "SKU" && c.skuId === id);
    relative = used ? ((await db.sku.findUnique({ where: { id } }))?.imagePath ?? null) : null;
  } else if (kind === "posm") {
    const header = loaded.record.headerPosm;
    const used =
      Object.values(loaded.layout).some((c) => c.kind === "POSM" && c.posmId === id) ||
      Object.values(loaded.shelftalkers).includes(id);
    if (header?.id === id) relative = header.imagePath;
    else if (used) relative = (await db.posm.findUnique({ where: { id } }))?.imagePath ?? null;
  }
  const image = await readImage(relative);
  if (!image || !relative) return new Response(null, { status: 404 });
  return pictureResponse(image, request.url, relative);
}
