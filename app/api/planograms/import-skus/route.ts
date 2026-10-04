import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { PlanogramError } from "@/modules/planograms/errors";
import { requireRequestUser } from "@/modules/planograms/http";
import { importSkus, parseSpreadsheet } from "@/modules/planograms/import";

export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return new Response(null, { status: 401 });
  const back = new URL("/planograms/skus", getEnv().APP_URL);
  const file = (await request.formData()).get("file");
  try {
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
      throw new PlanogramError("badFile");
    const result = await importSkus(user, await parseSpreadsheet(file));
    back.searchParams.set("created", String(result.created));
    back.searchParams.set("updated", String(result.updated));
    back.searchParams.set("skipped", String(result.skipped.length));
  } catch (error) {
    if (!(error instanceof PlanogramError)) throw error;
    back.searchParams.set("error", error.code);
  }
  return NextResponse.redirect(back, 303);
}
