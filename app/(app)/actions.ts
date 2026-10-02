"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { parseTimeOfDay } from "@/lib/time";
import { requireUser } from "@/modules/core/auth/current-user";
import { createInvite, revokeInvite } from "@/modules/core/invites/service";
import { markAllRead, markRead, sendTestNotification } from "@/modules/core/notifications/service";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";
import { settingsInputSchema, updateSettings } from "@/modules/core/settings/service";
import { changeRole } from "@/modules/core/users/service";

// Server actions are reachable by direct POST, so every action checks the user
// and passes it to a service, which checks permissions.
const allowAction = createRateLimiter({ limit: 30, windowMs: 60_000 });

async function actor() {
  const user = await requireUser();
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const roleSchema = z.enum(["OWNER", "MANAGER", "MEMBER"]);
const idSchema = z.string().min(1).max(64);

export async function createInviteAction(formData: FormData) {
  const user = await actor();
  await createInvite(user, roleSchema.parse(formData.get("role")));
  revalidatePath("/team");
}

export async function revokeInviteAction(formData: FormData) {
  const user = await actor();
  await revokeInvite(user, idSchema.parse(formData.get("inviteId")));
  revalidatePath("/team");
}

export async function changeRoleAction(formData: FormData) {
  const user = await actor();
  await changeRole(
    user,
    idSchema.parse(formData.get("userId")),
    roleSchema.parse(formData.get("role")),
  );
  revalidatePath("/team");
}

export async function sendTestNotificationAction(formData: FormData) {
  const user = await actor();
  const targetId = idSchema.parse(formData.get("userId"));
  await sendTestNotification(user, targetId);
  revalidatePath("/", "layout");
  const back = formData.get("back") === "/team" ? "/team" : "/notifications";
  redirect(`${back}?notice=testSent`);
}

export async function markReadAction(formData: FormData) {
  const user = await actor();
  await markRead(user.id, idSchema.parse(formData.get("notificationId")));
  revalidatePath("/", "layout");
}

export async function markAllReadAction() {
  const user = await actor();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(formData: FormData) {
  const user = await actor();
  const parsed = settingsInputSchema.safeParse({
    timezone: String(formData.get("timezone") ?? ""),
    telegramEnabled: formData.get("telegramEnabled") === "on",
    quietHoursStart: parseTimeOfDay(String(formData.get("quietFrom") ?? "")),
    quietHoursEnd: parseTimeOfDay(String(formData.get("quietTo") ?? "")),
    disabledTypes: OPTIONAL_NOTIFICATION_TYPES.filter(
      (type) => formData.get(`type_${type}`) !== "on",
    ),
  });
  if (!parsed.success) redirect("/settings?error=1");
  await updateSettings(user.id, parsed.data);
  redirect("/settings?saved=1");
}
