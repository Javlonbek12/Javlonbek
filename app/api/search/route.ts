import { withLocale } from "@/lib/i18n/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { getSettings } from "@/modules/core/settings/service";
import { search } from "@/modules/search/service";

// Typing sends a request per pause: a generous limit that still stops a runaway script.
const allow = createRateLimiter({ limit: 120, windowMs: 60_000 });

// GET /api/search?q=… — the top bar's search, grouped by kind, in the person's language.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!allow(user.id)) return Response.json({ error: "too_many_requests" }, { status: 429 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const { timezone } = await getSettings(user.id);
  const groups = await withLocale(user.locale, () => search(user, q, timezone));
  return Response.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}
