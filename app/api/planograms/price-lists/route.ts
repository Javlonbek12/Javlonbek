import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { PlanogramError } from "@/modules/planograms/errors";
import { requireRequestUser } from "@/modules/planograms/http";
import { parseSpreadsheet } from "@/modules/planograms/import";
import { createPriceList } from "@/modules/planograms/pricing";

// Upload of a new price list (Excel / CSV with "code" and "price" columns) → preview page.
export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return new Response(null, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const back = new URL("/planograms/prices", getEnv().APP_URL);
  try {
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
      throw new PlanogramError("badFile");
    const rows = (await parseSpreadsheet(file))
      .filter((r) => r.price !== undefined)
      .map((r) => ({ code: r.code, price: r.price! }));
    const { list, unknown } = await createPriceList(
      user,
      {
        name: String(form.get("name") ?? ""),
        effectiveFrom: String(form.get("effectiveFrom") ?? ""),
      },
      rows,
    );
    const target = new URL(`/planograms/prices/${list.id}`, getEnv().APP_URL);
    if (unknown.length) target.searchParams.set("unknown", unknown.slice(0, 20).join(", "));
    return NextResponse.redirect(target, 303);
  } catch (error) {
    if (!(error instanceof PlanogramError)) throw error;
    back.searchParams.set("error", error.code);
    return NextResponse.redirect(back, 303);
  }
}
