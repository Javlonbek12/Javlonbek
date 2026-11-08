"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/core/auth/current-user";
import { createInvite, revokeInvite } from "@/modules/core/invites/service";
import { ForbiddenError } from "@/modules/core/errors";
import {
  deleteOrgNode,
  freeOrgPlace,
  moveOrgNode,
  OrgError,
  saveOrgNode,
} from "@/modules/org/service";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

// Back to where the change was made: the chart in edit mode or the list, at the place changed.
function backTo(form: FormData, nodeId?: string | null) {
  const anchor = nodeId ? `#node-${nodeId}` : "";
  return str(form, "from") === "chart"
    ? `/team/structure?edit=1${anchor}`
    : `/team/structure?view=list${anchor}`;
}

async function run(form: FormData, action: () => Promise<{ id?: string } | void>) {
  let target: string;
  try {
    const result = await action();
    target = backTo(form, (result && result.id) || str(form, "nodeId") || null);
  } catch (error) {
    if (!(error instanceof OrgError)) throw error;
    target = `${backTo(form).split("#")[0]}&error=${error.code}`;
  }
  revalidatePath("/team", "layout");
  redirect(target);
}

export async function saveOrgNodeAction(form: FormData) {
  const actor = await requireUser();
  const id = str(form, "nodeId") || null;
  await run(form, () =>
    saveOrgNode(actor, id, {
      kind: str(form, "kind") === "UNIT" ? "UNIT" : "POSITION",
      name: str(form, "name"),
      title: str(form, "title"),
      label: str(form, "label"),
      userId: str(form, "userId"),
      personName: str(form, "personName"),
      parentId: str(form, "parentId"),
    }),
  );
}

export async function deleteOrgNodeAction(form: FormData) {
  const actor = await requireUser();
  await run(form, async () => {
    await deleteOrgNode(actor, str(form, "nodeId"));
    return { id: str(form, "parentId") || undefined };
  });
}

// «Левее» / «правее» on the chart, «выше» / «ниже» in the list.
export async function moveOrgNodeAction(form: FormData) {
  const actor = await requireUser();
  await run(form, () =>
    moveOrgNode(actor, str(form, "nodeId"), str(form, "direction") === "left" ? "left" : "right"),
  );
}

export async function freeOrgPlaceAction(form: FormData) {
  const actor = await requireUser();
  await run(form, () => freeOrgPlace(actor, str(form, "nodeId")));
}

// An invite to one place in the chart: the person who joins with it is placed there.
export async function invitePlaceAction(form: FormData) {
  const actor = await requireUser();
  const chosen = str(form, "role");
  const role = chosen === "MANAGER" || chosen === "LAWYER" ? chosen : "MEMBER";
  try {
    await createInvite(actor, role, new Date(), str(form, "nodeId"));
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    redirect("/team/structure?view=list&error=forbidden");
  }
  revalidatePath("/team", "layout");
  redirect(backTo(form, str(form, "nodeId")));
}

export async function revokePlaceInviteAction(form: FormData) {
  const actor = await requireUser();
  await revokeInvite(actor, str(form, "inviteId"));
  revalidatePath("/team", "layout");
  redirect(backTo(form, str(form, "nodeId")));
}
