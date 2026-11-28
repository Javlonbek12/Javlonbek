"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireModule } from "@/modules/core/access/guard";
import { requireUser } from "@/modules/core/auth/current-user";
import {
  checkSopUpload,
  deleteSopUpload,
  inspectSopFile,
  saveSopSettings,
  setSopMark,
  SOP_UPLOAD_COOKIE,
  SopError,
  tickSopChecklist,
  uploadSop,
  type SopInspection,
} from "@/modules/sop/service";
import { readSopSettings } from "@/modules/sop/settings";

export type SopInspectResult = ({ ok: true } & SopInspection) | { ok: false; error: string };
export type SopUploadResult =
  { ok: true; id: string; cycle: string; skus: number } | { ok: false; error: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function fileOf(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new SopError("empty");
  return { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
}

// A page of the section to go back to (never an address from outside it).
const backTo = (form: FormData, fallback: string) => {
  const back = text(form, "back");
  return back === "/sop" || back.startsWith("/sop/") || back.startsWith("/sop?") ? back : fallback;
};

async function remember(id: string) {
  (await cookies()).set(SOP_UPLOAD_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true });
}

// Reads the chosen file and says what is in it (the sheet, the months, the cycle) — nothing is
// saved yet.
export async function inspectSopFileAction(form: FormData): Promise<SopInspectResult> {
  const actor = await requireUser();
  try {
    return { ok: true, ...(await inspectSopFile(actor, await fileOf(form))) };
  } catch (error) {
    if (!(error instanceof SopError)) throw error;
    return { ok: false, error: error.code };
  }
}

export async function uploadSopAction(form: FormData): Promise<SopUploadResult> {
  const actor = await requireUser();
  try {
    const upload = await uploadSop(actor, {
      ...(await fileOf(form)),
      kind: text(form, "kind"),
      note: text(form, "note"),
      cycle: text(form, "cycle") || null,
    });
    // The new file is what the pages show next.
    await remember(upload.id);
    revalidatePath("/sop", "layout");
    return { ok: true, id: upload.id, cycle: upload.cycle, skus: upload.skuCount };
  } catch (error) {
    if (!(error instanceof SopError)) throw error;
    return { ok: false, error: error.code };
  }
}

// Runs an action; an error's code goes back to the page in its address.
async function run(back: string, action: () => Promise<string | void>) {
  let target = back;
  try {
    target = (await action()) ?? back;
  } catch (error) {
    if (!(error instanceof SopError)) throw error;
    const [path, hash] = back.split("#");
    target = `${path}${path!.includes("?") ? "&" : "?"}error=${error.code}${hash ? `#${hash}` : ""}`;
  }
  revalidatePath("/sop", "layout");
  redirect(target);
}

export async function pickSopUploadAction(form: FormData) {
  await requireModule("sop");
  await run(backTo(form, "/sop"), async () => {
    await checkSopUpload(text(form, "uploadId"));
    await remember(text(form, "uploadId"));
  });
}

export async function deleteSopUploadAction(form: FormData) {
  const actor = await requireUser();
  await run("/sop/uploads", async () => {
    await deleteSopUpload(actor, text(form, "uploadId"));
    return "/sop/uploads?deleted=1";
  });
}

// «Проверено» / «Так и задумано» on a finding, or the mark taken off (an empty status).
export async function markSopFindingAction(form: FormData) {
  const actor = await requireUser();
  await run(backTo(form, "/sop/findings"), async () => {
    await setSopMark(actor, {
      cycle: text(form, "cycle"),
      key: text(form, "key"),
      status: text(form, "status") || null,
      note: text(form, "note"),
    });
  });
}

export async function tickSopChecklistAction(form: FormData) {
  const actor = await requireUser();
  await run("/sop#checklist", async () => {
    await tickSopChecklist(actor, {
      cycle: text(form, "cycle"),
      item: Number(text(form, "item")),
      done: text(form, "done") === "1",
    });
  });
}

export async function saveSopSettingsAction(form: FormData) {
  const actor = await requireUser();
  await run("/sop/settings", async () => {
    if (form.get("reset")) {
      await saveSopSettings(actor, null);
      return "/sop/settings?reset=1";
    }
    const read = readSopSettings(Object.fromEntries(form.entries()));
    if (!read.settings) return `/sop/settings?invalid=${read.invalid.join(",")}`;
    await saveSopSettings(actor, read.settings);
    return "/sop/settings?saved=1";
  });
}
