"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearConnectData,
  ConnectError,
  importConnectFiles,
  linkConnectPerson,
} from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";

export type ConnectUploadResult = { lines: string[]; error: string | null };

// Uploads one export (the page sends the chosen files one by one, so several big files never
// hit the request size limit together). Returns the result lines for the upload page:
// file|kind|created|updated|skipped|kept|newer|from|to|test|replaced (replaced: Smart Up visits).
export async function importConnectFileAction(form: FormData): Promise<ConnectUploadResult> {
  const actor = await requireUser();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  try {
    const results = await importConnectFiles(
      actor,
      await Promise.all(
        files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) })),
      ),
    );
    revalidatePath("/connect", "layout");
    return {
      error: null,
      lines: results.flatMap((r) =>
        r.sheets.map((s) =>
          [
            r.name,
            s.kind,
            s.created,
            s.updated,
            s.skipped,
            s.kept,
            s.newer ?? "",
            s.from ?? "",
            s.to ?? "",
            s.test,
            s.replaced ?? "",
          ].join("|"),
        ),
      ),
    };
  } catch (error) {
    if (!(error instanceof ConnectError)) throw error;
    return { error: error.code, lines: [] };
  }
}

// Links a name from the bot to a person in the app (owner and managers); back to the same view.
export async function linkConnectPersonAction(form: FormData) {
  const actor = await requireUser();
  const back = String(form.get("back") ?? "");
  let target = back.startsWith("/connect") ? back : "/connect?view=executor";
  try {
    await linkConnectPerson(
      actor,
      String(form.get("name") ?? ""),
      String(form.get("userId") ?? "") || null,
    );
  } catch (error) {
    if (!(error instanceof ConnectError)) throw error;
    target = `${target}${target.includes("?") ? "&" : "?"}error=${error.code}`;
  }
  revalidatePath("/connect", "layout");
  redirect(target);
}

export async function clearConnectAction() {
  const actor = await requireUser();
  let target = "/connect/import?cleared=1";
  try {
    await clearConnectData(actor);
  } catch (error) {
    if (!(error instanceof ConnectError)) throw error;
    target = `/connect/import?error=${error.code}`;
  }
  revalidatePath("/connect", "layout");
  redirect(target);
}
