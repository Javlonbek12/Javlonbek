import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { orgTemplateXlsx } from "@/modules/org/excel";
import { canEditOrg } from "@/modules/org/service";

// GET /team/structure/template — the Excel template for loading the org chart (the owner only).
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || !canEditOrg(user)) return Response.json({ error: "forbidden" }, { status: 403 });
  return new Response(new Uint8Array(await orgTemplateXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="org-structure.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
