import { todayInTimezone } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { requireRequestUser } from "@/modules/planograms/http";
import { priceTemplateXlsx } from "@/modules/planograms/price-table";

// GET /api/planograms/price-lists/template — Excel with every SKU and its latest price, to fill in
// and upload back as a new price list.
export async function GET(request: Request) {
  if (!(await requireRequestUser(request)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const name = `prices-${todayInTimezone(getEnv().DEFAULT_TIMEZONE)}.xlsx`;
  return new Response(new Uint8Array(await priceTemplateXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
