import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { createRateLimiter } from "@/lib/rate-limit";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { addFileAttachment } from "@/modules/tasks/attachment-service";
import { TaskError } from "@/modules/tasks/errors";

const allowUpload = createRateLimiter({ limit: 20, windowMs: 60_000 });

// File upload from the task card (multipart form). Redirects back to the task.
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/tasks/[id]/attachments">,
) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!allowUpload(user.id)) return Response.json({ error: "too many requests" }, { status: 429 });

  const back = new URL(`/tasks/${encodeURIComponent(id)}`, getEnv().APP_URL);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) {
    back.searchParams.set("error", "invalid");
    return NextResponse.redirect(back, 303);
  }
  try {
    await addFileAttachment(user, id, file);
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    if (error.code === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    back.searchParams.set("error", error.code);
  }
  return NextResponse.redirect(back, 303);
}
