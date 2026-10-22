"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clearConnectData, ConnectError, importConnectFiles } from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";

// Uploads Connect exports; the result (or the error) is shown on the upload page.
export async function importConnectAction(form: FormData) {
  const actor = await requireUser();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let target: string;
  try {
    const results = await importConnectFiles(
      actor,
      await Promise.all(
        files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) })),
      ),
    );
    const lines = results.flatMap((r) =>
      r.sheets.map((s) => [r.name, s.kind, s.created, s.updated, s.skipped].join("|")),
    );
    target = `/connect/import?${new URLSearchParams({ done: lines.join("\n") })}`;
  } catch (error) {
    if (!(error instanceof ConnectError)) throw error;
    target = `/connect/import?error=${error.code}`;
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
