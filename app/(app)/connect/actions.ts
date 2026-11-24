"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { readRules } from "@/modules/connect/rules";
import {
  clearConnectData,
  ConnectError,
  importConnectFiles,
  linkConnectPerson,
  linkConnectPosition,
  saveConnectRules,
} from "@/modules/connect/service";
import { requireUser } from "@/modules/core/auth/current-user";

export type ConnectUploadResult = { lines: string[]; error: string | null };

// Uploads one export (the page sends the chosen files one by one, so several big files never
// hit the request size limit together). Returns the result lines for the upload page:
// file|kind|created|updated|skipped|kept|newer|from|to|test|replaced|samples (replaced: Smart Up
// visits, positions and sales; samples: rows of the samples file that were not loaded).
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
            s.samples,
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

// Links a position of the employee info to a person in the app (owner and managers): that person
// sees every TSM under it. Back to the same view.
export async function linkConnectPositionAction(form: FormData) {
  const actor = await requireUser();
  const back = String(form.get("back") ?? "");
  let target = back.startsWith("/connect") ? back : "/connect?view=manager";
  try {
    await linkConnectPosition(
      actor,
      String(form.get("title") ?? ""),
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

// «Нормы»: the owner saves the lines the analytics is counted against, or takes the standard ones
// back. Fields that are not a value of theirs save nothing and are named on the page.
export async function saveConnectRulesAction(form: FormData) {
  const actor = await requireUser();
  let target = "/connect/rules?saved=1";
  try {
    if (form.get("reset")) {
      await saveConnectRules(actor, null);
      target = "/connect/rules?reset=1";
    } else {
      const read = readRules(Object.fromEntries(form.entries()));
      if (read.rules) await saveConnectRules(actor, read.rules);
      else target = `/connect/rules?invalid=${read.invalid.join(",")}`;
    }
  } catch (error) {
    if (!(error instanceof ConnectError)) throw error;
    target = `/connect/rules?error=${error.code}`;
  }
  revalidatePath("/connect", "layout");
  redirect(target);
}
