import { NextResponse } from "next/server";
import sharp from "sharp";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { PlanogramError } from "@/modules/planograms/errors";
import { requireRequestUser } from "@/modules/planograms/http";
import { readImage, saveImage } from "@/modules/planograms/library";

const kindOf = (value: string) => (value === "sku" || value === "posm" ? value : null);

async function imagePath(kind: "sku" | "posm", id: string) {
  if (kind === "sku") return (await db.sku.findUnique({ where: { id } }))?.imagePath ?? null;
  return (await db.posm.findUnique({ where: { id } }))?.imagePath ?? null;
}

// Pack / POSM picture for the editor (signed-in users only).
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/planogram-images/[kind]/[id]">,
) {
  if (!(await requireRequestUser(request))) return new Response(null, { status: 401 });
  const { kind, id } = await params;
  const k = kindOf(kind);
  let image = k ? await readImage(await imagePath(k, id)) : null;
  if (!image) return new Response(null, { status: 404 });
  // ?h=… returns a smaller copy (the 3D view loads many pictures at once).
  const height = Number(new URL(request.url).searchParams.get("h"));
  if (Number.isInteger(height) && height >= 32 && height < 600)
    image = await sharp(image).resize({ height, withoutEnlargement: true }).png().toBuffer();
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
  });
}

// Upload form posts here; redirects back to the SKU / POSM page.
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/planogram-images/[kind]/[id]">,
) {
  const user = await requireRequestUser(request);
  if (!user) return new Response(null, { status: 401 });
  const { kind, id } = await params;
  const k = kindOf(kind);
  if (!k) return new Response(null, { status: 404 });
  const back = new URL(
    `/planograms/${k === "sku" ? "skus" : "posm"}/${encodeURIComponent(id)}`,
    getEnv().APP_URL,
  );
  const file = (await request.formData()).get("file");
  try {
    if (!(file instanceof File)) throw new PlanogramError("badFile");
    await saveImage(user, k, id, file);
    back.searchParams.set("saved", "1");
  } catch (error) {
    if (!(error instanceof PlanogramError)) throw error;
    back.searchParams.set("error", error.code);
  }
  return NextResponse.redirect(back, 303);
}
