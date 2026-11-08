import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { PlanogramError } from "@/modules/planograms/errors";
import { requireRequestUser } from "@/modules/planograms/http";
import { readSpreadsheet, type UnreadRow } from "@/modules/planograms/import";
import { createPriceList } from "@/modules/planograms/pricing";

// The rows that could not be read, short: «5 (SKU-1) — не читается цена; 9 — нет кода».
const unreadText = (rows: UnreadRow[]) =>
  rows
    .slice(0, 20)
    .map(
      (r) =>
        `${r.line}${r.code ? ` (${r.code})` : ""} — ${t(`planograms.library.prices.unreadProblem.${r.problem}`)}`,
    )
    .join("; ") + (rows.length > 20 ? " …" : "");

// Upload of a new price list (Excel / CSV with "code" and "price" columns) → preview page. Rows
// whose code or price can't be read are reported, not dropped silently.
export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return new Response(null, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const back = new URL("/planograms/prices", getEnv().APP_URL);
  try {
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
      throw new PlanogramError("badFile");
    const { rows: read, unread } = await readSpreadsheet(file);
    const rows = read
      .filter((r) => r.price !== undefined)
      .map((r) => ({ code: r.code, price: r.price! }));
    if (rows.length === 0 && unread.length > 0) {
      back.searchParams.set("error", "unreadable");
      back.searchParams.set("unread", unreadText(unread));
      return NextResponse.redirect(back, 303);
    }
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
    if (unread.length) target.searchParams.set("unread", unreadText(unread));
    return NextResponse.redirect(target, 303);
  } catch (error) {
    if (!(error instanceof PlanogramError)) throw error;
    back.searchParams.set("error", error.code);
    return NextResponse.redirect(back, 303);
  }
}
