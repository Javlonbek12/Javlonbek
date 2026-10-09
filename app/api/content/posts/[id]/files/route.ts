import { revalidatePath } from "next/cache";

import { createRateLimiter } from "@/lib/rate-limit";
import { getUserFromRequest } from "@/modules/core/auth/request-user";
import { addPostFile, LANGS, MAX_FILE_MB, MAX_FILES_PER_LANG } from "@/modules/content/files";
import { ContentError } from "@/modules/content/service";
import { t } from "@/lib/i18n";

const allowUpload = createRateLimiter({ limit: 40, windowMs: 60_000 });

// Uploads one file to a post (the page sends files one by one, so big videos fit).
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/content/posts/[id]/files">,
) {
  const { id } = await params;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!allowUpload(user.id)) return Response.json({ error: "too many requests" }, { status: 429 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: t("content.errors.invalid") }, { status: 400 });
  }
  const file = form.get("file");
  const lang = LANGS.find((l) => l === form.get("lang"));
  if (!(file instanceof File) || !lang)
    return Response.json({ error: t("content.errors.invalid") }, { status: 400 });
  try {
    const row = await addPostFile(user, id, lang, file);
    revalidatePath("/content", "layout");
    return Response.json({ id: row.id });
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return Response.json(
      { error: t(`content.errors.${error.code}`, { mb: MAX_FILE_MB, max: MAX_FILES_PER_LANG }) },
      { status: 400 },
    );
  }
}
