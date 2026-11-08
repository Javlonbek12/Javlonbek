"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createRateLimiter } from "@/lib/rate-limit";
import { parseTimeOfDay } from "@/lib/time";
import { syncBotCommands } from "@/modules/bot/commands";
import { requireUser } from "@/modules/core/auth/current-user";
import { createInvite, revokeInvite } from "@/modules/core/invites/service";
import {
  markAllRead,
  markRead,
  openNotification,
  sendTestNotification,
} from "@/modules/core/notifications/service";
import { OPTIONAL_NOTIFICATION_TYPES } from "@/modules/core/notifications/types";
import { getSettings, settingsInputSchema, updateSettings } from "@/modules/core/settings/service";
import { changeRole } from "@/modules/core/users/service";

// Server actions are reachable by direct POST, so every action checks the user
// and passes it to a service, which checks permissions.
const allowAction = createRateLimiter({ limit: 30, windowMs: 60_000 });

async function actor() {
  const user = await requireUser();
  if (!allowAction(user.id)) throw new Error("Too many requests");
  return user;
}

const roleSchema = z.enum(["OWNER", "MANAGER", "MEMBER", "LAWYER"]);
const idSchema = z.string().min(1).max(64);

// Invites live on /team and on /settings/invites (managers without the Team section).
export async function createInviteAction(formData: FormData) {
  const user = await actor();
  await createInvite(user, roleSchema.parse(formData.get("role")));
  revalidatePath("/team");
  revalidatePath("/settings/invites");
}

export async function revokeInviteAction(formData: FormData) {
  const user = await actor();
  await revokeInvite(user, idSchema.parse(formData.get("inviteId")));
  revalidatePath("/team");
  revalidatePath("/settings/invites");
}

export async function changeRoleAction(formData: FormData) {
  const user = await actor();
  await changeRole(
    user,
    idSchema.parse(formData.get("userId")),
    roleSchema.parse(formData.get("role")),
  );
  revalidatePath("/", "layout");
}

export async function sendTestNotificationAction(formData: FormData) {
  const user = await actor();
  const targetId = idSchema.parse(formData.get("userId"));
  await sendTestNotification(user, targetId);
  revalidatePath("/", "layout");
  const backValue = String(formData.get("back") ?? "");
  // Only our own team pages and Settings are allowed as a return address.
  const back =
    /^\/team(\/[A-Za-z0-9]{1,64})?$/.test(backValue) || backValue === "/settings"
      ? backValue
      : "/notifications";
  redirect(`${back}?notice=testSent`);
}

export async function markReadAction(formData: FormData) {
  const user = await actor();
  await markRead(user.id, idSchema.parse(formData.get("notificationId")));
  revalidatePath("/", "layout");
}

export async function openNotificationAction(formData: FormData) {
  const user = await actor();
  const target = await openNotification(user.id, idSchema.parse(formData.get("notificationId")));
  revalidatePath("/", "layout");
  redirect(target ?? "/notifications");
}

export async function markAllReadAction() {
  const user = await actor();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(formData: FormData) {
  const user = await actor();
  const current = await getSettings(user.id);
  // Settings show only the groups that concern the person; the hidden ones keep their value.
  const shown = new Set(formData.getAll("shownTypes"));
  const quietHoursStart = parseTimeOfDay(String(formData.get("quietFrom") ?? ""));
  const quietHoursEnd = parseTimeOfDay(String(formData.get("quietTo") ?? ""));
  if ((quietHoursStart === null) !== (quietHoursEnd === null)) redirect("/settings?error=quiet");
  const parsed = settingsInputSchema.safeParse({
    timezone: String(formData.get("timezone") ?? ""),
    telegramEnabled: formData.get("telegramEnabled") === "on",
    quietHoursStart,
    quietHoursEnd,
    disabledTypes: OPTIONAL_NOTIFICATION_TYPES.filter((type) =>
      shown.has(type)
        ? formData.get(`type_${type}`) !== "on"
        : current.disabledTypes.includes(type),
    ),
    digestTime: parseTimeOfDay(String(formData.get("digestTime") ?? "")) ?? 510,
    locale: String(formData.get("locale") ?? "ru"),
  });
  if (!parsed.success)
    redirect(
      parsed.error.issues.some((i) => i.path[0] === "timezone")
        ? "/settings?error=timezone"
        : "/settings?error=1",
    );
  await updateSettings(user.id, parsed.data);
  if (parsed.data.locale !== user.locale) await syncBotCommands(user.id, parsed.data.locale);
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}
