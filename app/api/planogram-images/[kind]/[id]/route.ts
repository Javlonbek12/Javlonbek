import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { PlanogramError } from "@/modules/planograms/errors";
import { requireRequestUser } from "@/modules/planograms/http";
import { readImage, saveImage } from "@/modules/planograms/library";
import { pictureResponse } from "@/modules/planograms/picture-response";

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
  const image = k ? await readImage(await imagePath(k, id)) : null;
  if (!image) return new Response(null, { status: 404 });
  return pictureResponse(image, request.url);
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
