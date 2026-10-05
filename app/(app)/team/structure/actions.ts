"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import { createInvite, revokeInvite } from "@/modules/core/invites/service";
import { ForbiddenError } from "@/modules/core/errors";
import { deleteOrgNode, OrgError, saveOrgNode } from "@/modules/org/service";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

async function run(action: () => Promise<unknown>) {
  let target = "/team/structure?view=list";
  try {
    await action();
  } catch (error) {
    if (!(error instanceof OrgError)) throw error;
    target += `&error=${error.code}`;
  }
  revalidatePath("/team", "layout");
  redirect(target);
}

export async function saveOrgNodeAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "nodeId") || null;
  await run(() =>
    saveOrgNode(actor, id, {
      kind: str(form, "kind") === "UNIT" ? "UNIT" : "POSITION",
      name: str(form, "name"),
      title: str(form, "title"),
      label: str(form, "label"),
      userId: str(form, "userId"),
      personName: str(form, "personName"),
      parentId: str(form, "parentId"),
      sortOrder: Number(str(form, "sortOrder")) || 0,
    }),
  );
}

export async function deleteOrgNodeAction(form: FormData) {
  const actor = await requireUser();
  await run(() => deleteOrgNode(actor, str(form, "nodeId")));
}

// An invite to one place in the chart: the person who joins with it is placed there.
export async function invitePlaceAction(form: FormData) {
  const actor = await requireUser();
  const role = str(form, "role") === "MANAGER" ? "MANAGER" : "MEMBER";
  try {
    await createInvite(actor, role, new Date(), str(form, "nodeId"));
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    redirect("/team/structure?view=list&error=forbidden");
  }
  revalidatePath("/team", "layout");
  redirect("/team/structure?view=list");
}

export async function revokePlaceInviteAction(form: FormData) {
  const actor = await requireUser();
  await revokeInvite(actor, str(form, "inviteId"));
  revalidatePath("/team", "layout");
  redirect("/team/structure?view=list");
}
